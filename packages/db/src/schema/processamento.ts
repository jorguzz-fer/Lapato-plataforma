import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { colunasTempo, colunasTenant } from './_comum.js';
import { caso } from './caso.js';
import { cassete } from './macroscopia.js';
import { usuario } from './identidade.js';
import { unidade } from './tenancy.js';

/**
 * M09 - Processamento Histologico e Coloracoes.
 *
 * Nota do dono do produto no topo do documento: **"Nos nao fazemos
 * processamento. Esse e um servico terceirizado."**
 *
 * Consequencia arquitetural: este modulo e primariamente de GESTAO DE ENVIO E
 * RETORNO ao laboratorio de apoio, e o parceiro precisa de acesso ao sistema
 * para confirmar recebimento, apontar incongruencias e pedir impressao de
 * etiquetas de lamina. Por isso `unidade.tipo = 'laboratorio_apoio'` e um perfil
 * externo (PERFIS_PADRAO.LABORATORIO_APOIO) existem desde o inicio.
 *
 * Principio: "cada lamina deve possuir origem totalmente rastreavel ate o
 * fragmento macroscopico que lhe deu origem".
 */

/**
 * M09: lote de envio, identificado pela DATA de envio.
 *
 * Regra do modulo: o lote e ferramenta operacional e "nao elimina a
 * rastreabilidade individual" de cada cassete.
 */
export const loteEnvio = pgTable(
  'lote_envio',
  {
    ...colunasTenant,
    identificador: text('identificador').notNull(),
    dataEnvio: date('data_envio').notNull(),
    /** Unidade do tipo `laboratorio_apoio` que vai processar. */
    laboratorioApoioId: uuid('laboratorio_apoio_id').references(() => unidade.id),

    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
    enviadoPorId: uuid('enviado_por_id').references(() => usuario.id),

    /** M09: o parceiro confirma o recebimento clicando na listagem do dia. */
    recebidoParceiroEm: timestamp('recebido_parceiro_em', { withTimezone: true }),
    recebidoParceiroPorId: uuid('recebido_parceiro_por_id').references(() => usuario.id),

    /** aberto | enviado | recebido | com_divergencia | concluido */
    status: text('status').notNull().default('aberto'),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_lote_identificador').on(t.tenantId, t.identificador),
    index('idx_lote_data').on(t.tenantId, t.dataEnvio),
    index('idx_lote_status').on(t.tenantId, t.status),
  ],
);

/** Cassetes que compoem um lote. */
export const loteCassete = pgTable(
  'lote_cassete',
  {
    ...colunasTenant,
    loteId: uuid('lote_id')
      .notNull()
      .references(() => loteEnvio.id, { onDelete: 'cascade' }),
    casseteId: uuid('cassete_id')
      .notNull()
      .references(() => cassete.id),
    /** Conferencia do parceiro: null = nao conferido ainda. */
    confirmadoRecebimento: boolean('confirmado_recebimento'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_lote_cassete').on(t.loteId, t.casseteId),
    index('idx_lote_cassete_lote').on(t.tenantId, t.loteId),
  ],
);

/**
 * M09: divergencia apontada pelo laboratorio de apoio na conferencia.
 *
 * As tres categorias vem literalmente da nota do documento:
 * falta de cassetes, cassetes a mais nao listados, numeracoes erradas.
 */
export const divergenciaCassete = pgTable(
  'divergencia_cassete',
  {
    ...colunasTenant,
    loteId: uuid('lote_id')
      .notNull()
      .references(() => loteEnvio.id, { onDelete: 'cascade' }),
    casseteId: uuid('cassete_id').references(() => cassete.id),
    /** cassete_faltante | cassete_excedente | numeracao_errada */
    tipo: text('tipo').notNull(),
    /** Codigo lido fisicamente, quando nao bate com o esperado. */
    codigoInformado: text('codigo_informado'),
    descricao: text('descricao').notNull(),
    apontadaPorId: uuid('apontada_por_id').references(() => usuario.id),
    resolvidaEm: timestamp('resolvida_em', { withTimezone: true }),
    resolucao: text('resolucao'),
    ...colunasTempo,
  },
  (t) => [index('idx_divergencia_lote').on(t.tenantId, t.loteId)],
);

/**
 * M09: bloco de parafina.
 *
 * Regra do modulo: 1 cassete -> 1 bloco, com excecao justificada e genealogia
 * (`A1 -> A1.1 / A1.2`).
 */
export const bloco = pgTable(
  'bloco',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    casseteId: uuid('cassete_id')
      .notNull()
      .references(() => cassete.id),
    identificador: text('identificador').notNull(),
    /** Auto-referencia para desdobramento (A1 -> A1.1). */
    blocoOrigemId: uuid('bloco_origem_id'),

    /**
     * M18: "bloco esgotado deve ser claramente identificado e visivel ao
     * patologista antes de solicitar complementares" - o Guardian bloqueia
     * pedido de IHQ em bloco esgotado.
     */
    esgotado: boolean('esgotado').notNull().default(false),
    parcialmenteConsumido: boolean('parcialmente_consumido').notNull().default(false),

    localArquivoId: uuid('local_arquivo_id'),
    produzidoEm: timestamp('produzido_em', { withTimezone: true }),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_bloco_identificador').on(t.tenantId, t.identificador),
    index('idx_bloco_caso').on(t.tenantId, t.casoId),
    index('idx_bloco_cassete').on(t.tenantId, t.casseteId),
  ],
);

/**
 * M09: lamina.
 *
 * O identificador (`CV-000342/26-A1-HE`) carrega o do bloco, que carrega o do
 * cassete, que carrega o do caso - a cadeia exigida pelo modulo.
 */
export const lamina = pgTable(
  'lamina',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    blocoId: uuid('bloco_id').references(() => bloco.id),
    identificador: text('identificador').notNull(),
    /** Referencia a termo da tabela mestre 'coloracao' (HE, PAS, ...). */
    coloracaoId: uuid('coloracao_id'),
    coloracaoSigla: text('coloracao_sigla').notNull(),
    /** Nivel de corte adicional; 1 = corte de rotina. */
    nivel: integer('nivel').notNull().default(1),

    /** M09: repeticao exige motivo registrado. */
    repeticao: boolean('repeticao').notNull().default(false),
    motivoRepeticao: text('motivo_repeticao'),

    /**
     * M09: "lamina disponivel para microscopia" != "laudo liberado" - eventos
     * distintos. Este e o primeiro.
     */
    disponivelEm: timestamp('disponivel_em', { withTimezone: true }),
    produzidaPorId: uuid('produzida_por_id').references(() => usuario.id),

    /** M09: controle obrigatorio da coloracao; falha impede validacao tecnica. */
    controleColoracao: jsonb('controle_coloracao').$type<Record<string, unknown>>(),

    localArquivoId: uuid('local_arquivo_id'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_lamina_identificador').on(t.tenantId, t.identificador),
    index('idx_lamina_caso').on(t.tenantId, t.casoId),
    index('idx_lamina_bloco').on(t.tenantId, t.blocoId),
  ],
);

export const loteEnvioRelations = relations(loteEnvio, ({ many }) => ({
  cassetes: many(loteCassete),
  divergencias: many(divergenciaCassete),
}));

export const loteCasseteRelations = relations(loteCassete, ({ one }) => ({
  lote: one(loteEnvio, { fields: [loteCassete.loteId], references: [loteEnvio.id] }),
  cassete: one(cassete, { fields: [loteCassete.casseteId], references: [cassete.id] }),
}));

export const blocoRelations = relations(bloco, ({ one, many }) => ({
  cassete: one(cassete, { fields: [bloco.casseteId], references: [cassete.id] }),
  caso: one(caso, { fields: [bloco.casoId], references: [caso.id] }),
  laminas: many(lamina),
}));

export const laminaRelations = relations(lamina, ({ one }) => ({
  bloco: one(bloco, { fields: [lamina.blocoId], references: [bloco.id] }),
  caso: one(caso, { fields: [lamina.casoId], references: [caso.id] }),
}));
