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
  colunasTempo,
  colunasTenant,
  formaEntregaEnum,
  gravidadeNcEnum,
  modalidadeCobrancaEnum,
  lateralidadeEnum,
  prioridadeEnum,
  resultadoTriagemEnum,
} from './_comum.js';
import { cliente, paciente, veterinario } from './clientes.js';
import { servico } from './configuracao.js';
import { setor, unidade } from './tenancy.js';
import { usuario } from './identidade.js';

/**
 * M05 - Recebimento e Cadastro de Amostras + M06 - Triagem.
 *
 * DIRETRIZES secao 2: o Caso Anatomopatologico e a unidade central do sistema.
 * Tudo - amostras, imagens, solicitacoes, laudo, eventos financeiros, auditoria -
 * fica vinculado a este registro. Nao existem "fichas do paciente" paralelas em
 * areas diferentes.
 *
 * Regra estruturante do M05:
 *   Solicitado != Cadastrado != Recebido != Triado
 * Quatro momentos gravados separadamente; nenhum apaga o anterior.
 */

/** M05: agrupa varios casos numa mesma entrega fisica. */
export const remessa = pgTable(
  'remessa',
  {
    ...colunasTenant,
    identificador: text('identificador').notNull(),
    clienteId: uuid('cliente_id').references(() => cliente.id),
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => unidade.id),
    formaEntrega: formaEntregaEnum('forma_entrega').notNull(),
    recebidaEm: timestamp('recebida_em', { withTimezone: true }).notNull().defaultNow(),
    recebidaPorId: uuid('recebida_por_id').references(() => usuario.id),
    /** Condicoes de transporte importadas da Logistica (M19), quando houver. */
    condicoesTransporte: jsonb('condicoes_transporte').$type<Record<string, unknown>>(),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_remessa_identificador').on(t.tenantId, t.identificador),
    index('idx_remessa_tenant').on(t.tenantId),
  ],
);

/**
 * O Caso Anatomopatologico.
 *
 * M05: **um paciente por caso**. Uma remessa com material de tres animais gera
 * tres casos e uma remessa - nao um caso com tres pacientes.
 */
export const caso = pgTable(
  'caso',
  {
    ...colunasTenant,

    /**
     * Registro oficial (`CV-000342/26`), gerado pela sequencia do M01.
     * M01: unico, automatico e **nunca reutilizavel**; preservado mesmo em
     * cancelamento.
     */
    identificador: text('identificador').notNull(),
    /** Sequencial bruto, guardado para auditoria da numeracao. */
    sequencial: integer('sequencial').notNull(),
    ano: integer('ano').notNull(),

    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => unidade.id),
    servicoId: uuid('servico_id')
      .notNull()
      .references(() => servico.id),

    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id),
    /**
     * M14: o veterinario solicitante e OPCIONAL em necropsia - unica modalidade
     * assim. Nas demais, a obrigatoriedade e validada na aplicacao.
     */
    veterinarioId: uuid('veterinario_id').references(() => veterinario.id),
    /**
     * Convenio x particular (documento do Hugo). No particular o cliente e o
     * pseudo-cliente "Particular" da instituicao (tipo `tutor_particular`):
     * quem paga e recebe o laudo e o responsavel do paciente, e a clinica de
     * origem e o veterinario solicitante ficam aqui como texto, porque nao
     * ha parceria nem cadastro previo deles.
     */
    modalidade: modalidadeCobrancaEnum('modalidade').notNull().default('convenio'),
    clinicaOrigem: text('clinica_origem'),
    veterinarioInformado: text('veterinario_informado'),
    pacienteId: uuid('paciente_id')
      .notNull()
      .references(() => paciente.id),

    remessaId: uuid('remessa_id').references(() => remessa.id),

    prioridade: prioridadeEnum('prioridade').notNull().default('rotina'),

    // --- Os quatro momentos do M05, separados de proposito ------------------
    /** Pre-solicitacao criada no Portal (M04), antes de existir material. */
    solicitadoEm: timestamp('solicitado_em', { withTimezone: true }),
    /**
     * Quando o material CHEGOU ao laboratorio - a data de entrada.
     *
     * Segunda review (Hugo): "chegou uma quantidade muito grande de exames
     * hoje, ela nao conseguiu cadastrar todas; se entrou hoje mas ela
     * cadastrou so amanha, a gente ja vai liberar com atraso". O prazo conta
     * daqui, nao do instante do cadastro; e o fechamento do mes (Roberta: "o
     * que chegou entre o dia 1 e o dia 31") corta por aqui. Ajustavel, com
     * auditoria. `cadastradoEm` segue dizendo quando alguem digitou.
     */
    entradaEm: timestamp('entrada_em', { withTimezone: true }).notNull().defaultNow(),
    /** Caso cadastrado no sistema. */
    cadastradoEm: timestamp('cadastrado_em', { withTimezone: true }).notNull().defaultNow(),
    cadastradoPorId: uuid('cadastrado_por_id').references(() => usuario.id),
    /** Material fisicamente recebido. */
    recebidoEm: timestamp('recebido_em', { withTimezone: true }),
    recebidoPorId: uuid('recebido_por_id').references(() => usuario.id),
    /** Triagem concluida. */
    triadoEm: timestamp('triado_em', { withTimezone: true }),
    triadoPorId: uuid('triado_por_id').references(() => usuario.id),

    /**
     * M05: resultado agregado da triagem, derivado das amostras por regra
     * configuravel. Nulo enquanto a triagem nao termina.
     */
    resultadoTriagem: resultadoTriagemEnum('resultado_triagem'),

    /** M05: relacao com caso anterior (recidiva, reavaliacao, complemento). */
    casoAnteriorId: uuid('caso_anterior_id'),
    tipoRelacaoAnterior: text('tipo_relacao_anterior'),

    /** M11: patologista responsavel pelo caso. */
    patologistaResponsavelId: uuid('patologista_responsavel_id').references(() => usuario.id),

    /**
     * M24: quando true, o caso ganha a camada pericial (cadeia de custodia,
     * restricoes, documentacao ampliada). Perícia e condicao especial, nao
     * modalidade - por isso e flag no caso, nao um tipo de caso.
     */
    pericial: boolean('pericial').notNull().default(false),

    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    motivoCancelamento: text('motivo_cancelamento'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_caso_identificador').on(t.tenantId, t.identificador),
    index('idx_caso_tenant').on(t.tenantId),
    index('idx_caso_cliente').on(t.tenantId, t.clienteId),
    index('idx_caso_paciente').on(t.tenantId, t.pacienteId),
    index('idx_caso_unidade').on(t.tenantId, t.unidadeId),
    index('idx_caso_patologista').on(t.tenantId, t.patologistaResponsavelId),
    index('idx_caso_cadastrado_em').on(t.tenantId, t.cadastradoEm),
  ],
);

/**
 * M05: historico clinico.
 *
 * Regra explicita: a complementacao NAO substitui o conteudo anterior. Cada
 * complemento e uma linha nova, com autor, data e origem - e o texto original
 * do solicitante nunca e sobrescrito pela interpretacao da IA (M11 secao 13).
 */
export const historicoClinico = pgTable(
  'historico_clinico',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    /** Texto exatamente como fornecido. */
    texto: text('texto').notNull(),
    /** Dados extraidos em campos, sem apagar o texto de origem. */
    estruturado: jsonb('estruturado').$type<Record<string, unknown>>().notNull().default({}),
    /** solicitante | laboratorio | portal | documento_anexado */
    origem: text('origem').notNull(),
    /** True quando e complemento posterior ao cadastro inicial. */
    complementar: boolean('complementar').notNull().default(false),
    registradoPorId: uuid('registrado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [index('idx_historico_caso').on(t.tenantId, t.casoId)],
);

/**
 * M05: recipiente fisico recebido (frasco, tubo, porta-laminas).
 *
 * Guardar `quantidadeDeclarada` e `quantidadeRecebida` em colunas distintas e
 * requisito explicito: "quantidade declarada e quantidade recebida armazenadas
 * separadamente; divergencia destacada automaticamente". A divergencia e um
 * dado do caso, nao um erro a ser corrigido silenciosamente.
 */
export const recipiente = pgTable(
  'recipiente',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    identificador: text('identificador').notNull(),
    ordem: integer('ordem').notNull(),
    /** Referencia a termo da tabela mestre 'recipiente'. */
    tipoId: uuid('tipo_id'),
    /** Referencia a termo da tabela mestre 'fixador'. */
    fixadorId: uuid('fixador_id'),
    identificacaoExterna: text('identificacao_externa'),
    quantidadeDeclarada: integer('quantidade_declarada'),
    quantidadeRecebida: integer('quantidade_recebida'),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_recipiente_identificador').on(t.tenantId, t.identificador),
    index('idx_recipiente_caso').on(t.tenantId, t.casoId),
  ],
);

/**
 * M05: a amostra e a unidade de trabalho tecnico.
 *
 * A triagem e a macroscopia acontecem POR AMOSTRA, nao por caso - por isso o
 * resultado da triagem mora aqui, e o do caso e agregado.
 */
export const amostra = pgTable(
  'amostra',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    recipienteId: uuid('recipiente_id').references(() => recipiente.id),
    identificador: text('identificador').notNull(),
    ordem: integer('ordem').notNull(),
    /**
     * Letra usada na identificacao dos cassetes (`-A1`, `-B1`). O M08 usa
     * tambem sufixos semanticos como `MA` (margem) e `L` (linfonodo).
     */
    letra: text('letra').notNull(),

    descricao: text('descricao'),
    /** Referencias a termos das tabelas mestres correspondentes. */
    orgaoId: uuid('orgao_id'),
    tecidoId: uuid('tecido_id'),
    regiaoAnatomica: text('regiao_anatomica'),
    lateralidade: lateralidadeEnum('lateralidade').notNull().default('nao_aplicavel'),

    /** M05: lesao principal, adicional, margem, linfonodo regional, controle... */
    tipoRelacao: text('tipo_relacao'),
    metodoColeta: text('metodo_coleta'),

    /** M06: resultado da triagem desta amostra. */
    resultadoTriagem: resultadoTriagemEnum('resultado_triagem'),
    triagemObservacoes: text('triagem_observacoes'),

    /**
     * M18: quando a macroscopia registra "material totalmente incluido", nao
     * pode existir tecido remanescente correspondente na Bioteca.
     */
    materialTotalmenteIncluido: boolean('material_totalmente_incluido')
      .notNull()
      .default(false),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_amostra_identificador').on(t.tenantId, t.identificador),
    index('idx_amostra_caso').on(t.tenantId, t.casoId),
  ],
);

/**
 * M06: registro da conferencia fisica.
 *
 * DIRETRIZES secao 8.1: o Cadastro registra o que foi informado; a Triagem
 * verifica o que existe fisicamente. A triagem confirma ou contradiz o
 * cadastro - nao o substitui.
 */
export const triagem = pgTable(
  'triagem',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id').references(() => amostra.id),
    resultado: resultadoTriagemEnum('resultado').notNull(),
    /** Checklist adaptativo por tipo de servico, respondido na conferencia. */
    checklist: jsonb('checklist').$type<Record<string, unknown>>().notNull().default({}),
    observacoes: text('observacoes'),
    iniciadaEm: timestamp('iniciada_em', { withTimezone: true }).notNull().defaultNow(),
    concluidaEm: timestamp('concluida_em', { withTimezone: true }),
    executadaPorId: uuid('executada_por_id')
      .notNull()
      .references(() => usuario.id),
    setorId: uuid('setor_id').references(() => setor.id),
    ...colunasTempo,
  },
  (t) => [
    index('idx_triagem_caso').on(t.tenantId, t.casoId),
    index('idx_triagem_amostra').on(t.tenantId, t.amostraId),
  ],
);

/**
 * M05: nao conformidade pre-analitica.
 *
 * Regra estruturante: **nao conformidade != pendencia**. A NC e o registro do
 * FATO (e alimenta a Qualidade, M22); a pendencia e a ACAO a resolver (e
 * pertence ao M10). Corrigir o problema nao apaga a NC: adicionar fixador as
 * 14:42 nao faz o material ter chegado fixado.
 */
export const naoConformidadePreAnalitica = pgTable(
  'nao_conformidade_pre_analitica',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id').references(() => amostra.id),
    recipienteId: uuid('recipiente_id').references(() => recipiente.id),
    /** Ex.: 'sem_fixador', 'identificacao_divergente', 'recipiente_danificado'. */
    tipo: text('tipo').notNull(),
    gravidade: gravidadeNcEnum('gravidade').notNull(),
    descricao: text('descricao').notNull(),
    impactoPotencial: text('impacto_potencial'),
    /** Acao corretiva registrada; NAO apaga a ocorrencia. */
    acaoCorretiva: text('acao_corretiva'),
    acaoCorretivaEm: timestamp('acao_corretiva_em', { withTimezone: true }),
    registradaPorId: uuid('registrada_por_id')
      .notNull()
      .references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    index('idx_nc_caso').on(t.tenantId, t.casoId),
    index('idx_nc_gravidade').on(t.tenantId, t.gravidade),
  ],
);

export const casoRelations = relations(caso, ({ one, many }) => ({
  cliente: one(cliente, { fields: [caso.clienteId], references: [cliente.id] }),
  veterinario: one(veterinario, { fields: [caso.veterinarioId], references: [veterinario.id] }),
  paciente: one(paciente, { fields: [caso.pacienteId], references: [paciente.id] }),
  servico: one(servico, { fields: [caso.servicoId], references: [servico.id] }),
  unidade: one(unidade, { fields: [caso.unidadeId], references: [unidade.id] }),
  remessa: one(remessa, { fields: [caso.remessaId], references: [remessa.id] }),
  amostras: many(amostra),
  recipientes: many(recipiente),
  historicos: many(historicoClinico),
  triagens: many(triagem),
  naoConformidades: many(naoConformidadePreAnalitica),
}));

export const amostraRelations = relations(amostra, ({ one }) => ({
  caso: one(caso, { fields: [amostra.casoId], references: [caso.id] }),
  recipiente: one(recipiente, { fields: [amostra.recipienteId], references: [recipiente.id] }),
}));

export const recipienteRelations = relations(recipiente, ({ one, many }) => ({
  caso: one(caso, { fields: [recipiente.casoId], references: [caso.id] }),
  amostras: many(amostra),
}));

export const triagemRelations = relations(triagem, ({ one }) => ({
  caso: one(caso, { fields: [triagem.casoId], references: [caso.id] }),
  amostra: one(amostra, { fields: [triagem.amostraId], references: [amostra.id] }),
}));
