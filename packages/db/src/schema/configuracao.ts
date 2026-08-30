import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { colunasInativacao, colunasTempo, colunasTenant } from './_comum.js';
import { unidade } from './tenancy.js';

/**
 * M01 - Administracao e Configuracoes: dados mestres e parametros.
 *
 * Principio do modulo: "a configuracao sera centralizada; a utilizacao sera
 * distribuida". Todos os demais modulos CONSOMEM daqui, nunca copiam.
 */

/**
 * M01 secao 11: catalogo de servicos e tipos de exame.
 *
 * As flags de comportamento sao o que faz o motor de fluxo montar o workflow
 * certo: uma revisao de laminas nao passa por macroscopia nem por processamento,
 * e o M07 precisa saber disso sem codigo condicional espalhado.
 */
export const servico = pgTable(
  'servico',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    codigo: text('codigo').notNull(),
    categoria: text('categoria').notNull(),
    descricao: text('descricao'),

    /** histopatologia | citopatologia | necropsia | revisao | complementar */
    modalidade: text('modalidade').notNull(),

    // --- Comportamento no fluxo (M01 secao 11) ---
    /**
     * Desligada por padrao desde a primeira review com o laboratorio: a
     * conferencia do recebimento ja cumpre o papel na rotina deles, e a etapa
     * repetida so travava o caso. A etapa continua no workflow, condicionada a
     * esta flag - reativar e ligar o interruptor do servico na Administracao
     * (util para material que chega sem fixacao, o caso que motivou a etapa).
     */
    exigeTriagem: boolean('exige_triagem').notNull().default(false),
    exigeMacroscopia: boolean('exige_macroscopia').notNull().default(false),
    exigeProcessamento: boolean('exige_processamento').notNull().default(false),
    exigeMicroscopia: boolean('exige_microscopia').notNull().default(true),
    geraLaudo: boolean('gera_laudo').notNull().default(true),
    permiteComplementares: boolean('permite_complementares').notNull().default(true),
    geraMaterialBioteca: boolean('gera_material_bioteca').notNull().default(false),
    /** M01: disponibilidade no Portal do Cliente. */
    disponivelPortal: boolean('disponivel_portal').notNull().default(true),

    /**
     * Preco da tabela padrao, em reais. Nulo = servico sem preco definido
     * (a OS nasce com o item zerado e a tela avisa). O preco vigente NUNCA e
     * consultado por OS antiga: cada item copia o valor no momento da criacao
     * (M01: alteracoes de configuracao nao retroagem).
     */
    valorPadrao: numeric('valor_padrao', { precision: 12, scale: 2 }),

    /** M01 secao 13: prazo padrao em dias uteis. */
    prazoDiasUteis: integer('prazo_dias_uteis').notNull().default(5),
    prazoUrgenteDiasUteis: integer('prazo_urgente_dias_uteis'),

    /** Recipiente recomendado, fixador, metodo de conservacao. */
    caracteristicasOperacionais: jsonb('caracteristicas_operacionais')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_servico_codigo').on(t.tenantId, t.codigo),
    index('idx_servico_tenant').on(t.tenantId),
    index('idx_servico_modalidade').on(t.tenantId, t.modalidade),
  ],
);

/**
 * M01 secao 16: tabelas mestres (especies, racas, orgaos, tecidos, lateralidade,
 * recipientes, fixadores, coloracoes, ...).
 *
 * Uma tabela generica em vez de trinta tabelas especificas: a documentacao pede
 * que a instituicao possa criar novas tabelas "sem necessidade de alteracao
 * constante do codigo-fonte" (M01 secao 2).
 */
export const tabelaMestre = pgTable(
  'tabela_mestre',
  {
    ...colunasTenant,
    /** Ex.: 'especie', 'orgao', 'fixador', 'coloracao'. */
    chave: text('chave').notNull(),
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    /** Tabelas do sistema nao podem ser removidas pelo administrador. */
    sistema: boolean('sistema').notNull().default(false),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [unique('uq_tabela_mestre_chave').on(t.tenantId, t.chave)],
);

/**
 * M01 secao 17: terminologia controlada, com termo preferencial, sinonimos e
 * vigencia.
 */
export const termo = pgTable(
  'termo',
  {
    ...colunasTenant,
    tabelaId: uuid('tabela_id')
      .notNull()
      .references(() => tabelaMestre.id, { onDelete: 'cascade' }),
    /** Termo preferencial exibido. */
    valor: text('valor').notNull(),
    codigo: text('codigo').notNull(),
    /** Auto-referencia para hierarquia: sistema -> orgao -> tecido. */
    paiId: uuid('pai_id'),
    sinonimos: jsonb('sinonimos').$type<string[]>().notNull().default([]),
    abreviacao: text('abreviacao'),
    ordem: integer('ordem').notNull().default(0),
    /** Atributos extras especificos da tabela (ex.: especie de um orgao). */
    metadados: jsonb('metadados').$type<Record<string, unknown>>().notNull().default({}),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_termo_codigo').on(t.tenantId, t.tabelaId, t.codigo),
    index('idx_termo_tabela').on(t.tenantId, t.tabelaId),
    index('idx_termo_pai').on(t.paiId),
  ],
);

/**
 * M01 secao 12: sequencia de numeracao dos registros.
 *
 * Regra dura do modulo: o sequencial e unico, automatico e **nunca reutilizavel**,
 * preservado mesmo quando o caso e cancelado. Por isso o contador so anda para
 * frente e a alocacao acontece dentro da transacao que cria o caso.
 */
export const sequenciaNumeracao = pgTable(
  'sequencia_numeracao',
  {
    ...colunasTenant,
    /** Ex.: 'caso', 'solicitacao', 'imagem', 'remessa'. */
    escopo: text('escopo').notNull(),
    ano: integer('ano').notNull(),
    /** Discrimina a serie: sigla do cliente para casos, vazio para os demais. */
    discriminador: text('discriminador').notNull().default(''),
    proximoValor: integer('proximo_valor').notNull().default(1),
    /** Mascara de formatacao (ver MascaraCaso em @lapato/shared). */
    mascara: jsonb('mascara').$type<Record<string, unknown>>().notNull().default({}),
    ...colunasTempo,
  },
  (t) => [unique('uq_sequencia').on(t.tenantId, t.escopo, t.ano, t.discriminador)],
);

/**
 * M01 secao 14: calendario institucional, necessario para calcular prazo em
 * dias uteis. Feriado nacional, estadual, municipal e recesso.
 */
export const diaNaoUtil = pgTable(
  'dia_nao_util',
  {
    ...colunasTenant,
    /** Nulo = vale para toda a instituicao. */
    unidadeId: uuid('unidade_id').references(() => unidade.id),
    data: date('data').notNull(),
    descricao: text('descricao').notNull(),
    /** nacional | estadual | municipal | recesso | institucional */
    tipo: text('tipo').notNull().default('institucional'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_dia_nao_util').on(t.tenantId, t.unidadeId, t.data),
    index('idx_dia_nao_util_data').on(t.tenantId, t.data),
  ],
);

/**
 * M01 secao 22: configuracoes relevantes tem historico, vigencia e responsavel.
 *
 * Regra estruturante: "alteracoes de informacoes institucionais nao deverao
 * modificar retroativamente" documentos e casos ja encerrados. Um caso aberto
 * quando o prazo era 7 dias continua valendo 7 dias.
 */
export const versaoConfiguracao = pgTable(
  'versao_configuracao',
  {
    ...colunasTenant,
    /** Tabela e registro alterados. */
    entidade: text('entidade').notNull(),
    entidadeId: uuid('entidade_id').notNull(),
    versao: integer('versao').notNull(),
    conteudo: jsonb('conteudo').$type<Record<string, unknown>>().notNull(),
    vigenciaInicio: timestamp('vigencia_inicio', { withTimezone: true }).notNull().defaultNow(),
    vigenciaFim: timestamp('vigencia_fim', { withTimezone: true }),
    responsavelId: uuid('responsavel_id'),
    justificativa: text('justificativa'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_versao_config').on(t.tenantId, t.entidade, t.entidadeId, t.versao),
    index('idx_versao_config_entidade').on(t.tenantId, t.entidade, t.entidadeId),
  ],
);

/**
 * M01 secao 19: modelos de etiqueta, com dimensoes, campos, codigo de barras e
 * QR Code. O M05, M08 e M09 imprimem usando estes modelos, sem definir formato
 * proprio.
 */
export const modeloEtiqueta = pgTable(
  'modelo_etiqueta',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    /** caso | recipiente | amostra | cassete | lamina | cadaver | bioteca */
    alvo: text('alvo').notNull(),
    larguraMm: integer('largura_mm').notNull(),
    alturaMm: integer('altura_mm').notNull(),
    /** Campos impressos, na ordem, e configuracao de codigo de barras / QR. */
    layout: jsonb('layout').$type<Record<string, unknown>>().notNull().default({}),
    copiasPadrao: integer('copias_padrao').notNull().default(1),
    impressoraPadrao: text('impressora_padrao'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [unique('uq_modelo_etiqueta').on(t.tenantId, t.nome)],
);

export const servicoRelations = relations(servico, ({ one }) => ({
  tenant: one(unidade, { fields: [servico.tenantId], references: [unidade.tenantId] }),
}));

export const tabelaMestreRelations = relations(tabelaMestre, ({ many }) => ({
  termos: many(termo),
}));

export const termoRelations = relations(termo, ({ one }) => ({
  tabela: one(tabelaMestre, { fields: [termo.tabelaId], references: [tabelaMestre.id] }),
}));
