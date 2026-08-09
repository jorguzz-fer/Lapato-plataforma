import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  alertaPrazoEnum,
  colunasTempo,
  colunasTenant,
  etapaEnum,
  nivelBloqueioEnum,
} from './_comum.js';
import { caso, amostra } from './caso.js';
import { servico } from './configuracao.js';
import { usuario } from './identidade.js';

/**
 * M07 - Rastreamento e Gestao de Fluxo.
 *
 * DIRETRIZES secao 12: "o estado global devera ser administrado pelo Modulo 07".
 * Nenhum outro modulo escreve status. Os modulos emitem eventos; o motor
 * interpreta a regra de fluxo e decide a transicao.
 *
 * M07: "o usuario nao devera registrar status manualmente quando outro modulo
 * pode determina-lo". Arrastar card no Kanban tambem nao altera status quando a
 * mudanca representa acao tecnica.
 */

/**
 * M07: definicao de workflow, configuravel em dados.
 *
 * Requisito explicito: "workflows configuraveis sem reprogramacao", por servico,
 * unidade, modalidade, prioridade e finalidade pericial.
 */
export const definicaoWorkflow = pgTable(
  'definicao_workflow',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    /** Nulo = workflow padrao da modalidade. */
    servicoId: uuid('servico_id').references(() => servico.id),
    modalidade: text('modalidade').notNull(),
    versao: integer('versao').notNull().default(1),
    ativo: boolean('ativo').notNull().default(true),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_workflow_nome_versao').on(t.tenantId, t.nome, t.versao),
    index('idx_workflow_servico').on(t.tenantId, t.servicoId),
  ],
);

/**
 * Etapas do workflow, na ordem.
 *
 * M07: etapas podem ser obrigatorias, condicionais, opcionais ou ignoradas.
 * Uma revisao de laminas nao passa por macroscopia, inclusao nem microtomia -
 * as etapas nao aplicaveis sao puladas automaticamente.
 */
export const etapaWorkflow = pgTable(
  'etapa_workflow',
  {
    ...colunasTenant,
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => definicaoWorkflow.id, { onDelete: 'cascade' }),
    etapa: etapaEnum('etapa').notNull(),
    ordem: integer('ordem').notNull(),
    /** obrigatoria | condicional | opcional */
    obrigatoriedade: text('obrigatoriedade').notNull().default('obrigatoria'),
    /**
     * Condicao avaliada contra as flags do servico para decidir se a etapa se
     * aplica. Ex.: `{ "servico.exigeMacroscopia": true }`.
     */
    condicao: jsonb('condicao').$type<Record<string, unknown>>().notNull().default({}),
    /** Eventos que fazem o caso ENTRAR nesta etapa. */
    eventosEntrada: jsonb('eventos_entrada').$type<string[]>().notNull().default([]),
    /** Eventos que fazem o caso SAIR desta etapa. */
    eventosSaida: jsonb('eventos_saida').$type<string[]>().notNull().default([]),
    /** Setor responsavel, usado para montar a fila. */
    setorTipo: text('setor_tipo'),
    /** Limite de permanencia na etapa, para alerta operacional. */
    limitePermanenciaHoras: integer('limite_permanencia_horas'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_etapa_workflow').on(t.workflowId, t.etapa),
    index('idx_etapa_workflow').on(t.tenantId, t.workflowId, t.ordem),
  ],
);

/**
 * Estado atual do caso. UMA linha por caso - esta e a fonte unica de status.
 *
 * O historico das transicoes nao mora aqui: mora em `evento_dominio`, que e
 * append-only e forma a linha do tempo (DIRETRIZES secao 13).
 */
export const estadoCaso = pgTable(
  'estado_caso',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' })
      .unique(),
    workflowId: uuid('workflow_id').references(() => definicaoWorkflow.id),
    etapa: etapaEnum('etapa').notNull(),
    /** Detalhe tecnico dentro da etapa, quando o modulo fornece. */
    detalhe: text('detalhe'),
    entrouNaEtapaEm: timestamp('entrou_na_etapa_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    responsavelId: uuid('responsavel_id').references(() => usuario.id),
    setorTipo: text('setor_tipo'),

    // --- Prazo (M07 + M01 secao 13) ---
    prazoDiasUteis: integer('prazo_dias_uteis'),
    /** Data-base da contagem. */
    prazoIniciadoEm: timestamp('prazo_iniciado_em', { withTimezone: true }),
    /**
     * M07: previsao ESTIMADA de liberacao. Distinta do prazo contratual/legal -
     * a documentacao exige a diferenca formal, e a previsao nunca substitui o
     * prazo oficial.
     */
    previsaoLiberacao: timestamp('previsao_liberacao', { withTimezone: true }),
    alertaPrazo: alertaPrazoEnum('alerta_prazo').notNull().default('normal'),

    /** True quando existe bloqueio total ativo. */
    bloqueado: boolean('bloqueado').notNull().default(false),

    ...colunasTempo,
  },
  (t) => [
    index('idx_estado_caso_etapa').on(t.tenantId, t.etapa),
    index('idx_estado_caso_responsavel').on(t.tenantId, t.responsavelId),
    index('idx_estado_caso_alerta').on(t.tenantId, t.alertaPrazo),
  ],
);

/**
 * M07: estado por amostra, para fluxos que avancam em ritmos diferentes.
 *
 * O estado do caso e agregado a partir daqui por regra configuravel: o caso
 * inteiro aguarda, ou apenas a amostra bloqueada.
 */
export const estadoAmostra = pgTable(
  'estado_amostra',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id')
      .notNull()
      .references(() => amostra.id, { onDelete: 'cascade' })
      .unique(),
    etapa: etapaEnum('etapa').notNull(),
    entrouNaEtapaEm: timestamp('entrou_na_etapa_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    bloqueada: boolean('bloqueada').notNull().default(false),
    ...colunasTempo,
  },
  (t) => [index('idx_estado_amostra_caso').on(t.tenantId, t.casoId)],
);

/**
 * M07: bloqueio do fluxo.
 *
 * Todo bloqueio tem origem, motivo e condicao de liberacao. O desbloqueio
 * acontece por evento do modulo de origem (`pendencia.resolvida`), nao por
 * alguem editar o status a mao.
 */
export const bloqueio = pgTable(
  'bloqueio',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id').references(() => amostra.id),
    nivel: nivelBloqueioEnum('nivel').notNull(),
    /** Modulo que originou o bloqueio. */
    origem: text('origem').notNull(),
    /** Registro que originou (ex.: id da pendencia do M10). */
    origemId: uuid('origem_id'),
    motivo: text('motivo').notNull(),
    /** Etapa que fica impedida; nulo = bloqueia o fluxo inteiro. */
    etapaBloqueada: etapaEnum('etapa_bloqueada'),
    condicaoLiberacao: text('condicao_liberacao'),
    criadoPorId: uuid('criado_por_id').references(() => usuario.id),
    liberadoEm: timestamp('liberado_em', { withTimezone: true }),
    liberadoPorId: uuid('liberado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    index('idx_bloqueio_caso').on(t.tenantId, t.casoId),
    index('idx_bloqueio_ativo').on(t.tenantId, t.casoId, t.liberadoEm),
  ],
);

/**
 * M07: suspensao de prazo.
 *
 * Uma pendencia aguardando o cliente pode suspender a contagem. A documentacao
 * ressalva que alguns SLAs e prazos legais NAO podem ser suspensos - por isso a
 * flag fica na configuracao do servico, e aqui so registramos a janela.
 */
export const suspensaoPrazo = pgTable(
  'suspensao_prazo',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    motivo: text('motivo').notNull(),
    origem: text('origem').notNull(),
    origemId: uuid('origem_id'),
    inicioEm: timestamp('inicio_em', { withTimezone: true }).notNull().defaultNow(),
    /** Nulo enquanto a suspensao estiver aberta. */
    fimEm: timestamp('fim_em', { withTimezone: true }),
    ...colunasTempo,
  },
  (t) => [index('idx_suspensao_caso').on(t.tenantId, t.casoId)],
);

export const estadoCasoRelations = relations(estadoCaso, ({ one }) => ({
  caso: one(caso, { fields: [estadoCaso.casoId], references: [caso.id] }),
  responsavel: one(usuario, { fields: [estadoCaso.responsavelId], references: [usuario.id] }),
  workflow: one(definicaoWorkflow, {
    fields: [estadoCaso.workflowId],
    references: [definicaoWorkflow.id],
  }),
}));

export const definicaoWorkflowRelations = relations(definicaoWorkflow, ({ many }) => ({
  etapas: many(etapaWorkflow),
}));

export const etapaWorkflowRelations = relations(etapaWorkflow, ({ one }) => ({
  workflow: one(definicaoWorkflow, {
    fields: [etapaWorkflow.workflowId],
    references: [definicaoWorkflow.id],
  }),
}));

export const bloqueioRelations = relations(bloqueio, ({ one }) => ({
  caso: one(caso, { fields: [bloqueio.casoId], references: [caso.id] }),
}));
