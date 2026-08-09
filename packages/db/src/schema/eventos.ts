import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { colunasTenant, visibilidadeEventoEnum } from './_comum.js';

/**
 * Event bus e linha do tempo unica.
 *
 * DIRETRIZES secao 13: "cada caso devera possuir uma unica linha do tempo.
 * Eventos poderao ser produzidos por qualquer modulo. (...) Essa timeline
 * devera pertencer a infraestrutura de rastreamento e nao ser reproduzida
 * independentemente em cada modulo."
 *
 * DIRETRIZES secao 17: automacao orientada a eventos. Ao liberar um laudo o
 * patologista executa uma acao; atualizar status, publicar no Portal, notificar
 * e registrar auditoria sao consequencias.
 *
 * Esta tabela e APPEND-ONLY. Erro nao se apaga: gera evento de correcao.
 * A imutabilidade e imposta por trigger na migration de RLS.
 */
export const eventoDominio = pgTable(
  'evento_dominio',
  {
    ...colunasTenant,
    tipo: text('tipo').notNull(),
    /** Nulo em eventos que nao pertencem a um caso (ex.: config alterada). */
    casoId: uuid('caso_id'),
    moduloOrigem: text('modulo_origem').notNull(),
    /** Nulo quando o evento e produzido pelo sistema, nao por uma pessoa. */
    usuarioId: uuid('usuario_id'),
    unidadeId: uuid('unidade_id'),
    setorId: uuid('setor_id'),
    /** Objeto mais granular que o caso (amostra, cassete, lamina, laudo). */
    objetoTipo: text('objeto_tipo'),
    objetoId: uuid('objeto_id'),
    /**
     * M07: define o que pode aparecer no Portal do Cliente e o que fica
     * restrito. O Portal so ve `externo`.
     */
    visibilidade: visibilidadeEventoEnum('visibilidade').notNull().default('interno'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Instante do fato. A linha do tempo ordena por este campo. */
    ocorridoEm: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
    /** Instante em que o sistema gravou. Pode diferir de `ocorridoEm`. */
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_evento_caso').on(t.tenantId, t.casoId, t.ocorridoEm),
    index('idx_evento_tipo').on(t.tenantId, t.tipo),
    index('idx_evento_ocorrido').on(t.tenantId, t.ocorridoEm),
    index('idx_evento_objeto').on(t.tenantId, t.objetoTipo, t.objetoId),
  ],
);

/**
 * Outbox transacional.
 *
 * O evento e gravado na MESMA transacao que a mudanca de estado; o worker
 * publica depois. Isso evita o classico "gravou no banco mas nao publicou na
 * fila" (ou o contrario) que o Blueprint secao 3 pede para tratar com retry e
 * dead-letter.
 */
export const outboxEvento = pgTable(
  'outbox_evento',
  {
    ...colunasTenant,
    eventoId: uuid('evento_id')
      .notNull()
      .references(() => eventoDominio.id, { onDelete: 'cascade' }),
    /** pendente | processando | processado | falhou */
    status: text('status').notNull().default('pendente'),
    tentativas: integer('tentativas').notNull().default(0),
    /** Back-off exponencial: proxima tentativa so depois deste instante. */
    proximaTentativaEm: timestamp('proxima_tentativa_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ultimoErro: text('ultimo_erro'),
    processadoEm: timestamp('processado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_outbox_pendente').on(t.status, t.proximaTentativaEm),
    index('idx_outbox_evento').on(t.eventoId),
  ],
);

/**
 * M26 - Integracoes e Notificacoes: fila de saida.
 *
 * DIRETRIZES secao 8.12: "o Modulo de Laudos nao devera possuir um sistema
 * independente de envio de e-mails ou WhatsApp". Os modulos geram eventos; o
 * M26 identifica destinatarios, escolhe canal, monta e envia.
 *
 * Nesta fase existe o registro e um adaptador de log; os canais reais entram
 * com a documentacao do M26.
 */
export const notificacaoPendente = pgTable(
  'notificacao_pendente',
  {
    ...colunasTenant,
    eventoId: uuid('evento_id').references(() => eventoDominio.id),
    casoId: uuid('caso_id'),
    /** email | whatsapp | portal | webhook */
    canal: text('canal').notNull(),
    destinatarioTipo: text('destinatario_tipo').notNull(),
    destinatarioId: uuid('destinatario_id'),
    destinatarioEndereco: text('destinatario_endereco'),
    assunto: text('assunto'),
    corpo: text('corpo'),
    /** pendente | enviada | falhou | cancelada */
    status: text('status').notNull().default('pendente'),
    tentativas: integer('tentativas').notNull().default(0),
    ultimoErro: text('ultimo_erro'),
    enviadaEm: timestamp('enviada_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notificacao_status').on(t.tenantId, t.status),
    index('idx_notificacao_caso').on(t.tenantId, t.casoId),
  ],
);
