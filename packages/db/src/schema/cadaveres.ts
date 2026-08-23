import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import {
  colunasTempo,
  colunasTenant,
  conservacaoCadaverEnum,
  destinacaoCadaverEnum,
  embalagemCadaverEnum,
  identificacaoExternaEnum,
  integridadeCadaverEnum,
  statusCadaverEnum,
  tipoBloqueioCadaverEnum,
  tipoMovimentacaoCadaverEnum,
} from './_comum.js';
import { caso } from './caso.js';
import { usuario } from './identidade.js';
import { localFisico } from './tenancy.js';

/**
 * M15 - Controle de Cadaveres.
 *
 * O modulo responde, a qualquer momento (secao 4 do documento): qual cadaver
 * esta sob responsabilidade do laboratorio, de qual caso ele e, quando e em que
 * condicoes chegou, onde esta, quem o moveu, se pode sair e para onde vai.
 *
 * **O armazenamento nao ganha tabela aqui.** `local_fisico` (M01) ja e
 * hierarquico - unidade, sala, equipamento, compartimento, posicao - e o proprio
 * comentario dele diz que Controle de Cadaveres e Bioteca registram o que esta
 * em cada local sem duplicar o cadastro. Criar um `equipamento_cadaver` seria
 * uma segunda verdade sobre a mesma prateleira.
 */

/**
 * O cadaver sob custodia.
 *
 * `casoId` e opcional de proposito (secao 5): um corpo pode chegar antes de o
 * cadastro administrativo existir, e recusar a entrada nesse momento significa
 * um corpo sem registro nenhum na camara - exatamente o que o modulo existe
 * para impedir. A entrada provisoria nasce marcada e e reconciliada depois.
 */
export const cadaver = pgTable(
  'cadaver',
  {
    ...colunasTenant,
    /**
     * Identificador proprio, visivel na etiqueta e no QR Code (secoes 4 e 10).
     * Nao e o numero do caso: o cadaver e rastreado mesmo sem caso.
     */
    identificador: text('identificador').notNull(),
    casoId: uuid('caso_id').references(() => caso.id),

    // --- Identidade (secoes 6 e 7) -----------------------------------------
    nomeAnimal: text('nome_animal'),
    especie: text('especie').notNull(),
    sexo: text('sexo'),
    raca: text('raca'),
    pelagem: text('pelagem'),
    /**
     * Secao 8: conferido no recebimento, antes da necropsia e antes da
     * liberacao. Divergencia gera alerta do Guardian, nao bloqueio automatico -
     * quem decide o que fazer com a divergencia e a pessoa.
     */
    microchip: text('microchip'),
    /** Quem entregou o corpo: tutor, clinica, orgao. Texto livre (secao 6). */
    origemResponsavel: text('origem_responsavel'),

    // --- Recebimento (secoes 12 e 14) --------------------------------------
    recebidoEm: timestamp('recebido_em', { withTimezone: true }),
    recebidoPorId: uuid('recebido_por_id').references(() => usuario.id),
    /** Interpretacao post mortem depende disto (secao 14). */
    obitoEm: timestamp('obito_em', { withTimezone: true }),
    conservacaoRecebimento: conservacaoCadaverEnum('conservacao_recebimento'),
    embalagem: embalagemCadaverEnum('embalagem'),
    integridade: integridadeCadaverEnum('integridade'),
    identificacaoExterna: identificacaoExternaEnum('identificacao_externa'),
    observacoesRecebimento: text('observacoes_recebimento'),

    // --- Situacao atual ----------------------------------------------------
    status: statusCadaverEnum('status').notNull().default('aguardando_recebimento'),
    /**
     * Posicao atual. Nulo quando o corpo esta fora do armazenamento - e nesse
     * caso `localAnteriorId` guarda de onde saiu, porque a secao 29 e explicita:
     * nenhum cadaver desaparece do mapa quando e retirado.
     */
    localAtualId: uuid('local_atual_id').references(() => localFisico.id),
    localAnteriorId: uuid('local_anterior_id').references(() => localFisico.id),
    /** Muda ao longo do tempo; cada mudanca vira movimentacao (secoes 15-16). */
    conservacaoAtual: conservacaoCadaverEnum('conservacao_atual'),
    /** Desde quando esta fora do armazenamento (secao 30). */
    foraDesde: timestamp('fora_desde', { withTimezone: true }),

    // --- Prazo e destinacao (secoes 34, 35 e 40) ---------------------------
    prazoGuardaAte: timestamp('prazo_guarda_ate', { withTimezone: true }),
    destinacao: destinacaoCadaverEnum('destinacao'),
    destinacaoDefinidaEm: timestamp('destinacao_definida_em', { withTimezone: true }),

    // --- Liberacao e saida (secoes 42, 43 e 44) ----------------------------
    liberadoEm: timestamp('liberado_em', { withTimezone: true }),
    liberadoPorId: uuid('liberado_por_id').references(() => usuario.id),
    retiradoEm: timestamp('retirado_em', { withTimezone: true }),
    retiradoPorNome: text('retirado_por_nome'),
    retiradoPorDocumento: text('retirado_por_documento'),
    retiradoPorVinculo: text('retirado_por_vinculo'),
    /** Empresa, quando a saida e por servico funerario ou crematorio (secao 46). */
    retiradoPorEmpresa: text('retirado_por_empresa'),
    entregaRegistradaPorId: uuid('entrega_registrada_por_id').references(() => usuario.id),

    ...colunasTempo,
  },
  (t) => [
    // Secao 88: "nenhum cadaver podera existir no sistema sem identificador unico".
    unique('uq_cadaver_identificador').on(t.tenantId, t.identificador),
    index('idx_cadaver_status').on(t.tenantId, t.status),
    index('idx_cadaver_caso').on(t.tenantId, t.casoId),
    index('idx_cadaver_local').on(t.tenantId, t.localAtualId),
  ],
);

/**
 * Movimentacao fisica (secao 23). Append-only.
 *
 * A sequencia destes registros e o historico termico e de custodia do cadaver
 * (secoes 16 e 66). Correcao entra como novo registro do tipo `correcao`, com
 * justificativa - nunca como edicao do anterior (secoes 67 e 88).
 */
export const movimentacaoCadaver = pgTable(
  'movimentacao_cadaver',
  {
    ...colunasTenant,
    cadaverId: uuid('cadaver_id')
      .notNull()
      .references(() => cadaver.id),
    tipo: tipoMovimentacaoCadaverEnum('tipo').notNull(),
    origemLocalId: uuid('origem_local_id').references(() => localFisico.id),
    destinoLocalId: uuid('destino_local_id').references(() => localFisico.id),
    /** Destino sem posicao no mapa: "Sala de Necropsia", "Saiu do laboratório". */
    destinoDescricao: text('destino_descricao'),
    conservacao: conservacaoCadaverEnum('conservacao'),
    motivo: text('motivo'),
    observacao: text('observacao'),
    ocorridoEm: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
    usuarioId: uuid('usuario_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    index('idx_movimentacao_cadaver').on(t.tenantId, t.cadaverId, t.ocorridoEm),
  ],
);

/**
 * Bloqueio (secoes 31-33).
 *
 * Ortogonal ao status: um cadaver bloqueado continua armazenado. O bloqueio
 * impede a **saida**, e a secao 32 e categorica - nao se resolve mudando o
 * status na mao, so resolvendo o bloqueio.
 */
export const bloqueioCadaver = pgTable(
  'bloqueio_cadaver',
  {
    ...colunasTenant,
    cadaverId: uuid('cadaver_id')
      .notNull()
      .references(() => cadaver.id),
    tipo: tipoBloqueioCadaverEnum('tipo').notNull(),
    motivo: text('motivo').notNull(),
    criadoPorId: uuid('criado_por_id').references(() => usuario.id),
    resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
    resolvidoPorId: uuid('resolvido_por_id').references(() => usuario.id),
    /** Como o bloqueio foi resolvido. Fica no historico (secao 88). */
    justificativaResolucao: text('justificativa_resolucao'),
    ...colunasTempo,
  },
  (t) => [index('idx_bloqueio_cadaver').on(t.tenantId, t.cadaverId)],
);

/**
 * Historico da destinacao (secao 41).
 *
 * "Nunca devera simplesmente sobrescrever a escolha anterior." Cada alteracao
 * vira uma linha; o campo em `cadaver` guarda apenas a escolha vigente.
 */
export const destinacaoCadaverHistorico = pgTable(
  'destinacao_cadaver_historico',
  {
    ...colunasTenant,
    cadaverId: uuid('cadaver_id')
      .notNull()
      .references(() => cadaver.id),
    anterior: destinacaoCadaverEnum('anterior'),
    nova: destinacaoCadaverEnum('nova').notNull(),
    justificativa: text('justificativa'),
    definidaPorId: uuid('definida_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [index('idx_destinacao_cadaver').on(t.tenantId, t.cadaverId)],
);

export const cadaverRelations = relations(cadaver, ({ one, many }) => ({
  caso: one(caso, { fields: [cadaver.casoId], references: [caso.id] }),
  localAtual: one(localFisico, {
    fields: [cadaver.localAtualId],
    references: [localFisico.id],
  }),
  movimentacoes: many(movimentacaoCadaver),
  bloqueios: many(bloqueioCadaver),
}));

export const movimentacaoCadaverRelations = relations(movimentacaoCadaver, ({ one }) => ({
  cadaver: one(cadaver, {
    fields: [movimentacaoCadaver.cadaverId],
    references: [cadaver.id],
  }),
}));

export const bloqueioCadaverRelations = relations(bloqueioCadaver, ({ one }) => ({
  cadaver: one(cadaver, { fields: [bloqueioCadaver.cadaverId], references: [cadaver.id] }),
}));
