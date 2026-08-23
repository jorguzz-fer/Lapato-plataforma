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
import {
  colunasTempo,
  colunasTenant,
  condicaoObjetoEnum,
  divergenciaInventarioEnum,
  finalidadeUsoEnum,
  metodoDescarteEnum,
  motivoRetencaoAmpliadaEnum,
  restricaoObjetoEnum,
  statusEmprestimoEnum,
  statusObjetoBiologicoEnum,
  tipoEmprestimoEnum,
  tipoMovimentacaoObjetoEnum,
  tipoObjetoBiologicoEnum,
} from './_comum.js';
import { amostra, caso } from './caso.js';
import { usuario } from './identidade.js';
import { bloco, lamina } from './processamento.js';
import { localFisico, unidade } from './tenancy.js';

/**
 * M18 - Bioteca e Gestao de Acervo Biologico.
 *
 * Principio fundamental (secao 20): **todo material biologico preservado devera
 * possuir identidade, origem, localizacao, condicao, finalidade e historico de
 * movimentacoes conhecidos**.
 *
 * O que este schema NAO cria, porque ja existe em outro modulo proprietario:
 * a estrutura fisica de armazenamento (`local_fisico`, M01 - hierarquica, com
 * capacidade e condicao ambiental), o bloco e a lamina (`bloco` e `lamina`, M09
 * - producao), a amostra e o caso (M05) e o arquivo de imagem (M16). O M18
 * amarra a **custodia** desses objetos, nao os reproduz.
 */

/**
 * O Objeto Biologico (secao 4).
 *
 * A tabela existe porque um bloco de parafina precisa de duas identidades
 * diferentes: a de **producao** (`bloco.identificador` = `A1`, dono: M09) e a
 * de **custodia** (`BIO-2026-000123`, dono: M18). Colapsar as duas obrigaria o
 * M09 a saber de gavetas e o M18 a saber de microtomia.
 *
 * A genealogia da secao 5 fica nas colunas de origem: caso -> amostra ->
 * bloco -> lamina, mais `objetoPaiId` para o que deriva de outro objeto
 * (o fragmento congelado que saiu do tecido fixado; a lamina que saiu do cell
 * block). A secao 65 e categorica: **nenhuma reamostragem devera quebrar a
 * cadeia de origem**.
 */
export const objetoBiologico = pgTable(
  'objeto_biologico',
  {
    ...colunasTenant,
    /** Identificador inequivoco de custodia (secao 15): `BIO-2026-000123`. */
    identificador: text('identificador').notNull(),
    tipo: tipoObjetoBiologicoEnum('tipo').notNull(),
    descricao: text('descricao'),

    // --- Genealogia (secao 5) ------------------------------------------------
    casoId: uuid('caso_id').references(() => caso.id),
    amostraId: uuid('amostra_id').references(() => amostra.id),
    /** Quando o objeto **e** um bloco produzido pelo M09. */
    blocoId: uuid('bloco_id').references(() => bloco.id),
    /** Quando o objeto **e** uma lamina produzida pelo M09. */
    laminaId: uuid('lamina_id').references(() => lamina.id),
    /** Derivacao entre objetos: tecido fixado -> fragmento congelado. */
    objetoPaiId: uuid('objeto_pai_id'),
    orgao: text('orgao'),

    // --- Custodia ------------------------------------------------------------
    status: statusObjetoBiologicoEnum('status').notNull().default('disponivel'),
    condicao: condicaoObjetoEnum('condicao').notNull().default('integro'),
    /**
     * Posicao de arquivo. `local_atual_id` diferente de `local_origem_id`
     * materializa a secao 33: retirado da Caixa 42 e em uso na histotecnica,
     * o objeto continua rastreavel e continua sabendo para onde volta.
     */
    localOrigemId: uuid('local_origem_id').references(() => localFisico.id),
    localAtualId: uuid('local_atual_id').references(() => localFisico.id),
    /** Onde esta quando nao esta num local cadastrado (secao 32: "Histotecnica"). */
    localizacaoDescritiva: text('localizacao_descritiva'),

    /** Secao 27: multiplas laminas equivalentes contam como quantidade. */
    quantidadeInicial: integer('quantidade_inicial').notNull().default(1),
    quantidadeDisponivel: integer('quantidade_disponivel').notNull().default(1),

    /** Tecidos fixados (secao 63) e congelados (secao 13). */
    recipiente: text('recipiente'),
    fixador: text('fixador'),
    temperaturaPrevista: text('temperatura_prevista'),

    /** Secao 85: ortogonais ao status; um objeto disponivel pode ser inemprestavel. */
    restricoes: restricaoObjetoEnum('restricoes').array().notNull().default([]),

    // --- Retencao (secoes 46-48, 72) ----------------------------------------
    retencaoAte: date('retencao_ate'),
    /** Secao 72: amplia a retencao e, quando marcado, dispensa data prevista. */
    preservacaoEspecial: boolean('preservacao_especial').notNull().default(false),
    motivoRetencaoAmpliada: motivoRetencaoAmpliadaEnum('motivo_retencao_ampliada'),
    justificativaRetencao: text('justificativa_retencao'),

    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    arquivadoPorId: uuid('arquivado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_objeto_identificador').on(t.tenantId, t.identificador),
    index('idx_objeto_caso').on(t.tenantId, t.casoId),
    index('idx_objeto_local').on(t.tenantId, t.localAtualId),
    index('idx_objeto_status').on(t.tenantId, t.status),
    index('idx_objeto_tipo').on(t.tenantId, t.tipo),
    index('idx_objeto_bloco').on(t.tenantId, t.blocoId),
  ],
);

/**
 * Movimentacao (secoes 30-34 e 82).
 *
 * Append-only. A secao 82 e literal: **"o historico nao devera ser apagado"**.
 * A secao 83 completa: corrigir localizacao gera evento novo com motivo, e "o
 * evento anterior permanece". E o que sustenta a linha do tempo do objeto
 * (secao 81) e a auditoria da secao 113.
 */
export const movimentacaoObjeto = pgTable(
  'movimentacao_objeto',
  {
    ...colunasTenant,
    objetoId: uuid('objeto_id')
      .notNull()
      .references(() => objetoBiologico.id),
    tipo: tipoMovimentacaoObjetoEnum('tipo').notNull(),
    origemLocalId: uuid('origem_local_id').references(() => localFisico.id),
    destinoLocalId: uuid('destino_local_id').references(() => localFisico.id),
    /** Destino livre quando nao e um local cadastrado: "Histotecnica", "UFRGS". */
    destinoDescritivo: text('destino_descritivo'),
    /** Secao 30: toda retirada devera possuir responsavel e finalidade. */
    finalidade: finalidadeUsoEnum('finalidade'),
    quantidade: integer('quantidade'),
    statusAnterior: statusObjetoBiologicoEnum('status_anterior'),
    statusNovo: statusObjetoBiologicoEnum('status_novo'),
    condicaoRegistrada: condicaoObjetoEnum('condicao_registrada'),
    /** Obrigatorio em `correcao_localizacao` (secao 83). */
    motivo: text('motivo'),
    observacao: text('observacao'),
    previsaoDevolucao: timestamp('previsao_devolucao', { withTimezone: true }),
    registradaPorId: uuid('registrada_por_id').references(() => usuario.id),
    registradaEm: timestamp('registrada_em', { withTimezone: true }).notNull().defaultNow(),
    ...colunasTempo,
  },
  (t) => [
    index('idx_movimentacao_objeto').on(t.tenantId, t.objetoId),
    index('idx_movimentacao_data').on(t.tenantId, t.registradaEm),
  ],
);

/**
 * Reserva (secoes 21, 28 e 69).
 *
 * Reserva **nao e emprestimo**: o material continua no lugar, apenas deixa de
 * estar livre. A finalidade e o campo que a secao 29 usa para a hierarquia -
 * uma reserva para pericia nao cede para um pedido de ensino, e o Guardian
 * checa isso comparando `prioridadeFinalidade()`.
 */
export const reservaObjeto = pgTable(
  'reserva_objeto',
  {
    ...colunasTenant,
    objetoId: uuid('objeto_id')
      .notNull()
      .references(() => objetoBiologico.id),
    finalidade: finalidadeUsoEnum('finalidade').notNull(),
    /** Projeto de pesquisa ou ensino (secao 69): `PRJ-0032`. */
    projeto: text('projeto'),
    justificativa: text('justificativa'),
    vigenciaAte: timestamp('vigencia_ate', { withTimezone: true }),
    ativa: boolean('ativa').notNull().default(true),
    criadaPorId: uuid('criada_por_id').references(() => usuario.id),
    criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
    encerradaEm: timestamp('encerrada_em', { withTimezone: true }),
    motivoEncerramento: text('motivo_encerramento'),
    ...colunasTempo,
  },
  (t) => [
    index('idx_reserva_objeto').on(t.tenantId, t.objetoId),
    index('idx_reserva_ativa').on(t.tenantId, t.ativa),
  ],
);

/**
 * Emprestimo (secoes 35-39).
 *
 * Um emprestimo carrega varios objetos (secao 41: o responsavel seleciona
 * `A1-HE`, `A2-HE` e o bloco `A2` e gera um pacote), por isso cabecalho e
 * itens. `status` nunca vai para `devolvido` sozinho: a secao 39 proibe
 * encerrar um emprestimo cujo material nao voltou.
 */
export const emprestimo = pgTable(
  'emprestimo',
  {
    ...colunasTenant,
    identificador: text('identificador').notNull(),
    tipo: tipoEmprestimoEnum('tipo').notNull(),
    finalidade: finalidadeUsoEnum('finalidade').notNull(),
    /** Pessoa ou instituicao responsavel pelo material fora do acervo. */
    destinatario: text('destinatario').notNull(),
    contatoDestinatario: text('contato_destinatario'),
    /** Unidade parceira, quando o destino e uma instituicao cadastrada. */
    unidadeDestinoId: uuid('unidade_destino_id').references(() => unidade.id),
    condicoes: text('condicoes'),

    status: statusEmprestimoEnum('status').notNull().default('aberto'),
    /** Secao 38: emprestimo sem prazo nao gera alerta e vira material perdido. */
    prazoDevolucao: date('prazo_devolucao').notNull(),
    emprestadoEm: timestamp('emprestado_em', { withTimezone: true }).notNull().defaultNow(),
    emprestadoPorId: uuid('emprestado_por_id').references(() => usuario.id),
    encerradoEm: timestamp('encerrado_em', { withTimezone: true }),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_emprestimo_identificador').on(t.tenantId, t.identificador),
    index('idx_emprestimo_status').on(t.tenantId, t.status),
    index('idx_emprestimo_prazo').on(t.tenantId, t.prazoDevolucao),
  ],
);

export const emprestimoItem = pgTable(
  'emprestimo_item',
  {
    ...colunasTenant,
    emprestimoId: uuid('emprestimo_id')
      .notNull()
      .references(() => emprestimo.id, { onDelete: 'cascade' }),
    objetoId: uuid('objeto_id')
      .notNull()
      .references(() => objetoBiologico.id),
    quantidade: integer('quantidade').notNull().default(1),
    devolvidoEm: timestamp('devolvido_em', { withTimezone: true }),
    /** Condicao na volta: emprestimo que devolve lamina quebrada precisa registrar. */
    condicaoDevolucao: condicaoObjetoEnum('condicao_devolucao'),
    observacaoDevolucao: text('observacao_devolucao'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_emprestimo_item').on(t.emprestimoId, t.objetoId),
    index('idx_emprestimo_item_objeto').on(t.tenantId, t.objetoId),
  ],
);

/**
 * Inventario fisico (secoes 54-57).
 *
 * O inventario e por localizacao: "Inventario de Blocos - Armario 03". O que
 * ele produz de valioso nao e a lista do que estava certo, e a **divergencia**
 * (secao 56) e a reconciliacao que preserva onde o objeto deveria estar e onde
 * foi achado (secao 57).
 */
export const inventarioBioteca = pgTable(
  'inventario_bioteca',
  {
    ...colunasTenant,
    identificador: text('identificador').notNull(),
    descricao: text('descricao'),
    /** Local raiz varrido: armario, gaveta, freezer, rack. */
    localId: uuid('local_id').references(() => localFisico.id),
    tipoFiltro: tipoObjetoBiologicoEnum('tipo_filtro'),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull().defaultNow(),
    iniciadoPorId: uuid('iniciado_por_id').references(() => usuario.id),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    /** Contagem congelada no fechamento, para o relatorio nao mudar depois. */
    resumo: jsonb('resumo').$type<Record<string, number>>(),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_inventario_identificador').on(t.tenantId, t.identificador),
    index('idx_inventario_local').on(t.tenantId, t.localId),
  ],
);

export const inventarioItem = pgTable(
  'inventario_item',
  {
    ...colunasTenant,
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => inventarioBioteca.id, { onDelete: 'cascade' }),
    objetoId: uuid('objeto_id').references(() => objetoBiologico.id),
    /** Codigo lido fisicamente quando o objeto nao esta cadastrado (secao 56). */
    codigoLido: text('codigo_lido'),
    encontrado: boolean('encontrado').notNull().default(false),
    localEsperadoId: uuid('local_esperado_id').references(() => localFisico.id),
    localEncontradoId: uuid('local_encontrado_id').references(() => localFisico.id),
    divergencia: divergenciaInventarioEnum('divergencia'),
    condicaoEncontrada: condicaoObjetoEnum('condicao_encontrada'),
    /** Reconciliacao (secao 57): quem resolveu, quando e por que. */
    reconciliadoEm: timestamp('reconciliado_em', { withTimezone: true }),
    reconciliadoPorId: uuid('reconciliado_por_id').references(() => usuario.id),
    justificativaReconciliacao: text('justificativa_reconciliacao'),
    registradoPorId: uuid('registrado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    index('idx_inventario_item_inv').on(t.tenantId, t.inventarioId),
    index('idx_inventario_item_objeto').on(t.tenantId, t.objetoId),
  ],
);

/**
 * Colecao biologica (secoes 73-74 e 67).
 *
 * A secao 74 e a regra que da forma a esta tabela: **"uma colecao e uma relacao
 * virtual. Nao significa mover fisicamente os materiais para uma nova
 * gaveta."** Por isso a colecao nao tem local, e o item nao duplica o objeto -
 * so aponta para ele (secao 67: "nao devera duplicar o registro dos objetos").
 */
export const colecaoBiologica = pgTable(
  'colecao_biologica',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    /** Kit de ensino, colecao tematica, colecao de projeto. */
    finalidade: finalidadeUsoEnum('finalidade'),
    projeto: text('projeto'),
    criadaPorId: uuid('criada_por_id').references(() => usuario.id),
    ativa: boolean('ativa').notNull().default(true),
    ...colunasTempo,
  },
  (t) => [unique('uq_colecao_nome').on(t.tenantId, t.nome)],
);

export const colecaoItem = pgTable(
  'colecao_item',
  {
    ...colunasTenant,
    colecaoId: uuid('colecao_id')
      .notNull()
      .references(() => colecaoBiologica.id, { onDelete: 'cascade' }),
    objetoId: uuid('objeto_id')
      .notNull()
      .references(() => objetoBiologico.id),
    nota: text('nota'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_colecao_item').on(t.colecaoId, t.objetoId),
    index('idx_colecao_item_objeto').on(t.tenantId, t.objetoId),
  ],
);

/**
 * Lote de destinacao (secoes 51-53).
 *
 * O lote e agrupamento operacional: "cada item continuara individualmente
 * registrado" (secao 51). E a secao 53 fecha: descartar muda o status para
 * `descartado`, **nao apaga o objeto** - a genealogia e o historico
 * permanecem consultaveis para sempre.
 */
export const loteDescarte = pgTable(
  'lote_descarte',
  {
    ...colunasTenant,
    identificador: text('identificador').notNull(),
    metodo: metodoDescarteEnum('metodo').notNull(),
    /** Empresa responsavel pela coleta, quando terceirizada (secao 52). */
    empresa: text('empresa'),
    observacoes: text('observacoes'),
    executadoEm: timestamp('executado_em', { withTimezone: true }),
    autorizadoPorId: uuid('autorizado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [unique('uq_lote_descarte_identificador').on(t.tenantId, t.identificador)],
);

export const objetoBiologicoRelations = relations(objetoBiologico, ({ one, many }) => ({
  caso: one(caso, { fields: [objetoBiologico.casoId], references: [caso.id] }),
  amostra: one(amostra, { fields: [objetoBiologico.amostraId], references: [amostra.id] }),
  bloco: one(bloco, { fields: [objetoBiologico.blocoId], references: [bloco.id] }),
  lamina: one(lamina, { fields: [objetoBiologico.laminaId], references: [lamina.id] }),
  localAtual: one(localFisico, {
    fields: [objetoBiologico.localAtualId],
    references: [localFisico.id],
  }),
  movimentacoes: many(movimentacaoObjeto),
  reservas: many(reservaObjeto),
}));

export const movimentacaoObjetoRelations = relations(movimentacaoObjeto, ({ one }) => ({
  objeto: one(objetoBiologico, {
    fields: [movimentacaoObjeto.objetoId],
    references: [objetoBiologico.id],
  }),
}));

export const emprestimoRelations = relations(emprestimo, ({ many }) => ({
  itens: many(emprestimoItem),
}));

export const emprestimoItemRelations = relations(emprestimoItem, ({ one }) => ({
  emprestimo: one(emprestimo, {
    fields: [emprestimoItem.emprestimoId],
    references: [emprestimo.id],
  }),
  objeto: one(objetoBiologico, {
    fields: [emprestimoItem.objetoId],
    references: [objetoBiologico.id],
  }),
}));

export const inventarioBiotecaRelations = relations(inventarioBioteca, ({ many }) => ({
  itens: many(inventarioItem),
}));

export const colecaoBiologicaRelations = relations(colecaoBiologica, ({ many }) => ({
  itens: many(colecaoItem),
}));
