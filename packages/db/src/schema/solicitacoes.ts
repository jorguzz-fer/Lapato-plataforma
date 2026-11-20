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
  colunasInativacao,
  colunasTempo,
  colunasTenant,
  etapaEnum,
  nivelBloqueioEnum,
  prioridadeEnum,
  statusPendenciaEnum,
  statusSolicitacaoEnum,
} from './_comum.js';
import { caso } from './caso.js';
import { usuario } from './identidade.js';

/**
 * M10 - Solicitacoes e Pendencias.
 *
 * Central UNICA das demandas. DIRETRIZES secao 5: a mesma pendencia e criada
 * aqui, exibida no Rastreamento, mostrada ao patologista no Laudo, parcialmente
 * visivel no Portal e notificada pelo M26 - **uma pendencia, nao cinco registros**.
 *
 * M10: "solicitacao e execucao sao conceitualmente separadas" - este modulo e
 * dono da DEMANDA; o modulo tecnico executa e devolve EXECUCAO CONCLUIDA.
 */

export const solicitacao = pgTable(
  'solicitacao',
  {
    ...colunasTenant,
    /** M10: numeracao propria (`SOL-2026-005421`), distinta do registro do caso. */
    identificador: text('identificador').notNull(),
    casoId: uuid('caso_id').references(() => caso.id, { onDelete: 'cascade' }),

    /** Ex.: 'coloracao_especial', 'ihq', 'recorte', 'reamostragem', 'nova_coleta'. */
    tipo: text('tipo').notNull(),
    /**
     * Tipo do catalogo (quarta revisao). Nulo nas solicitacoes criadas antes do
     * catalogo e nas que nascem de dentro do sistema sem passar por ele - essas
     * seguem com o `tipo` em texto e sem fluxo proprio.
     */
    tipoId: uuid('tipo_id').references(() => tipoSolicitacao.id),
    /** Quantas etapas do fluxo do tipo ja foram registradas. 0 = nenhuma. */
    etapaAtual: integer('etapa_atual').notNull().default(0),
    categoria: text('categoria'),
    /** interna | cliente | veterinario | guardian */
    origem: text('origem').notNull().default('interna'),

    descricao: text('descricao').notNull(),
    justificativa: text('justificativa'),
    prioridade: prioridadeEnum('prioridade').notNull().default('rotina'),
    status: statusSolicitacaoEnum('status').notNull().default('criada'),

    /** Objeto alvo: amostra, cassete, bloco ou lamina. */
    objetoTipo: text('objeto_tipo'),
    objetoId: uuid('objeto_id'),

    solicitantePorId: uuid('solicitante_por_id').references(() => usuario.id),
    /** M10: o proprio Guardian pode ser o solicitante. */
    solicitanteSistema: text('solicitante_sistema'),
    responsavelId: uuid('responsavel_id').references(() => usuario.id),
    setorResponsavel: text('setor_responsavel'),

    prazoEm: timestamp('prazo_em', { withTimezone: true }),

    /**
     * M10: visibilidade externa controlada, com "traducao contextual" - a
     * linguagem interna difere da exibida ao cliente, sem alterar o registro
     * tecnico. nao | parcial | sim
     */
    visibilidadePortal: text('visibilidade_portal').notNull().default('nao'),
    textoPortal: text('texto_portal'),

    /** M10: solicitacoes que exigem aprovacao previa (IHQ de alto custo etc.). */
    exigeAprovacao: boolean('exige_aprovacao').notNull().default(false),
    aprovadaPorId: uuid('aprovada_por_id').references(() => usuario.id),
    aprovadaEm: timestamp('aprovada_em', { withTimezone: true }),
    motivoRecusa: text('motivo_recusa'),

    concluidaEm: timestamp('concluida_em', { withTimezone: true }),
    concluidaPorId: uuid('concluida_por_id').references(() => usuario.id),
    /** M10: "resultado tecnico != interpretacao" - aqui so o resultado tecnico. */
    resultadoTecnico: text('resultado_tecnico'),

    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    motivoCancelamento: text('motivo_cancelamento'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_solicitacao_identificador').on(t.tenantId, t.identificador),
    index('idx_solicitacao_caso').on(t.tenantId, t.casoId),
    index('idx_solicitacao_status').on(t.tenantId, t.status),
    index('idx_solicitacao_responsavel').on(t.tenantId, t.responsavelId),
  ],
);

/**
 * M10: pendencia - o que falta para o caso avancar.
 *
 * Regra estruturante: a pendencia informa seu IMPACTO; quem decide o estado
 * global e o M07. Uma pendencia pode nao alterar, suspender, estender ou
 * bloquear o prazo.
 */
export const pendencia = pgTable(
  'pendencia',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    solicitacaoId: uuid('solicitacao_id').references(() => solicitacao.id),

    tipo: text('tipo').notNull(),
    descricao: text('descricao').notNull(),
    status: statusPendenciaEnum('status').notNull().default('aberta'),

    /** M10: bloqueia total, parcialmente ou nao bloqueia. */
    nivelBloqueio: nivelBloqueioEnum('nivel_bloqueio').notNull().default('nao'),
    /** Etapa impedida; nulo quando bloqueia o fluxo inteiro. */
    etapaBloqueada: etapaEnum('etapa_bloqueada'),
    /** Bloqueio granular: caso, amostra, cassete, bloco ou lamina. */
    objetoTipo: text('objeto_tipo'),
    objetoId: uuid('objeto_id'),

    /** M07: se true, o prazo do caso fica suspenso enquanto a pendencia existir. */
    suspendePrazo: boolean('suspende_prazo').notNull().default(false),

    responsavelId: uuid('responsavel_id').references(() => usuario.id),
    setorResponsavel: text('setor_responsavel'),
    /** M10: nem toda pendencia e visivel ao cliente. */
    visivelPortal: boolean('visivel_portal').notNull().default(false),

    criadaPorId: uuid('criada_por_id').references(() => usuario.id),
    /** Preenchido quando quem cria e o Guardian, nao uma pessoa. */
    criadaPorSistema: text('criada_por_sistema'),

    resolvidaEm: timestamp('resolvida_em', { withTimezone: true }),
    resolvidaPorId: uuid('resolvida_por_id').references(() => usuario.id),
    resolucao: text('resolucao'),

    ...colunasTempo,
  },
  (t) => [
    index('idx_pendencia_caso').on(t.tenantId, t.casoId),
    index('idx_pendencia_status').on(t.tenantId, t.status),
    index('idx_pendencia_responsavel').on(t.tenantId, t.responsavelId),
  ],
);

/**
 * M10: conversa estruturada da solicitacao ou pendencia.
 *
 * O modulo pede explicitamente que o sistema DESENCORAJE usar comentario livre
 * como tarefa ("Lembrar de fazer PAS" deve virar uma solicitacao de PAS). Por
 * isso a conversa e anexa a uma demanda, nunca um campo solto no caso.
 */
export const mensagemSolicitacao = pgTable(
  'mensagem_solicitacao',
  {
    ...colunasTenant,
    solicitacaoId: uuid('solicitacao_id').references(() => solicitacao.id, {
      onDelete: 'cascade',
    }),
    pendenciaId: uuid('pendencia_id').references(() => pendencia.id, { onDelete: 'cascade' }),
    autorId: uuid('autor_id').references(() => usuario.id),
    texto: text('texto').notNull(),
    /** Mensagem trocada com o cliente pelo Portal. */
    externa: boolean('externa').notNull().default(false),
    anexos: jsonb('anexos').$type<Record<string, unknown>[]>().notNull().default([]),
    ...colunasTempo,
  },
  (t) => [
    index('idx_mensagem_solicitacao').on(t.tenantId, t.solicitacaoId),
    index('idx_mensagem_pendencia').on(t.tenantId, t.pendenciaId),
  ],
);

export const solicitacaoRelations = relations(solicitacao, ({ one, many }) => ({
  caso: one(caso, { fields: [solicitacao.casoId], references: [caso.id] }),
  pendencias: many(pendencia),
  mensagens: many(mensagemSolicitacao),
}));

export const pendenciaRelations = relations(pendencia, ({ one, many }) => ({
  caso: one(caso, { fields: [pendencia.casoId], references: [caso.id] }),
  solicitacao: one(solicitacao, {
    fields: [pendencia.solicitacaoId],
    references: [solicitacao.id],
  }),
  mensagens: many(mensagemSolicitacao),
}));

/**
 * Catalogo de tipos de solicitacao (quarta revisao com o Hugo).
 *
 * Antes, "tipo" era texto livre gravado na solicitacao e o andamento era um
 * status generico igual para todos. A review mostrou por que isso nao serve:
 * "cada tipo de solicitacao vai ter seu fluxo" - devolucao de bloco passa por
 * separar, mandar ao laboratorio, receber de volta e devolver ao patologista;
 * uma coloracao especial nao passa por nada disso. E o catalogo tem de ser
 * editavel ("entrou funcionario novo, funcionario saiu de ferias, eu tenho que
 * tirar o nome dele dai"), porque quem configura e o laboratorio, nao o deploy.
 *
 * M01: inativa, nunca exclui - o tipo ja gravado numa solicitacao e dela.
 */
export const tipoSolicitacao = pgTable(
  'tipo_solicitacao',
  {
    ...colunasTenant,
    /** Ex.: 'coloracao_especial', 'devolucao_bloco'. Estavel; o nome muda, a chave nao. */
    chave: text('chave').notNull(),
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    /** Nasce aguardando analise em vez de cair direto na fila (secao 29). */
    exigeAprovacao: boolean('exige_aprovacao').notNull().default(false),
    /**
     * Review: "ele nao faz mais solicitacao pelo WhatsApp, faz pelo login
     * deles". So os tipos marcados aqui aparecem para o cliente no Portal.
     */
    visivelPortal: boolean('visivel_portal').notNull().default(false),
    /** Setor que recebe quando quem pede nao escolhe uma pessoa. */
    setorPadrao: text('setor_padrao'),
    ordem: integer('ordem').notNull().default(0),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_tipo_solicitacao_chave').on(t.tenantId, t.chave),
    index('idx_tipo_solicitacao_ordem').on(t.tenantId, t.ordem),
  ],
);

/**
 * Uma etapa do fluxo de um tipo (review: "ela vai clicando, e isso vai
 * caminhando").
 *
 * E configuracao, nao historico: o historico vive em `andamento_solicitacao`,
 * que congela o rotulo. Mudar a etapa aqui nao reescreve o que ja aconteceu.
 */
export const etapaTipoSolicitacao = pgTable(
  'etapa_tipo_solicitacao',
  {
    ...colunasTenant,
    tipoId: uuid('tipo_id')
      .notNull()
      .references(() => tipoSolicitacao.id, { onDelete: 'cascade' }),
    /** 1 em diante; a ordem e o proprio fluxo. */
    ordem: integer('ordem').notNull(),
    rotulo: text('rotulo').notNull(),
    /** Setor que executa esta etapa. Informativo na tela de quem acompanha. */
    setor: text('setor'),
    /**
     * M10: "traducao contextual" - o cliente le "material separado para
     * envio", nao "separando o bloco". Vazio: a etapa nao aparece no Portal.
     */
    textoPortal: text('texto_portal'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_etapa_tipo_ordem').on(t.tenantId, t.tipoId, t.ordem),
    index('idx_etapa_tipo').on(t.tenantId, t.tipoId),
  ],
);

/**
 * Trilha do que de fato aconteceu com uma solicitacao.
 *
 * Review: "a Raquel deu ok e recebeu, esta separando o bloco no dia cinco, foi
 * enviado pro processamento, a Alane recebeu..., e ai foi enviado pro
 * patologista" - cada clique com data, hora e nome. O rotulo e copiado da
 * configuracao no momento do clique, pelo mesmo motivo que o item da OS copia
 * o preco: configuracao muda, historico nao.
 */
export const andamentoSolicitacao = pgTable(
  'andamento_solicitacao',
  {
    ...colunasTenant,
    solicitacaoId: uuid('solicitacao_id')
      .notNull()
      .references(() => solicitacao.id, { onDelete: 'cascade' }),
    ordem: integer('ordem').notNull(),
    rotulo: text('rotulo').notNull(),
    observacao: text('observacao'),
    registradoPorId: uuid('registrado_por_id').references(() => usuario.id),
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_andamento_ordem').on(t.tenantId, t.solicitacaoId, t.ordem),
    index('idx_andamento_solicitacao').on(t.tenantId, t.solicitacaoId),
  ],
);

export const tipoSolicitacaoRelations = relations(tipoSolicitacao, ({ many }) => ({
  etapas: many(etapaTipoSolicitacao),
}));

export const etapaTipoSolicitacaoRelations = relations(etapaTipoSolicitacao, ({ one }) => ({
  tipo: one(tipoSolicitacao, {
    fields: [etapaTipoSolicitacao.tipoId],
    references: [tipoSolicitacao.id],
  }),
}));

export const andamentoSolicitacaoRelations = relations(andamentoSolicitacao, ({ one }) => ({
  solicitacao: one(solicitacao, {
    fields: [andamentoSolicitacao.solicitacaoId],
    references: [solicitacao.id],
  }),
}));
