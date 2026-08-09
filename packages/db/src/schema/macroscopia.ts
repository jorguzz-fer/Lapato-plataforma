import { relations } from 'drizzle-orm';
import {
  boolean,
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
import {
  colunasTempo,
  colunasTenant,
  lateralidadeEnum,
  metodoAmostragemEnum,
} from './_comum.js';
import { amostra, caso } from './caso.js';
import { usuario } from './identidade.js';

/**
 * M08 - Macroscopia.
 *
 * Finalidade: "transformar uma peca anatomica em representacao estruturada,
 * mensuravel, fotografada e amostrada".
 *
 * Uma ficha POR AMOSTRA, nao por caso.
 */
export const macroscopia = pgTable(
  'macroscopia',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id')
      .notNull()
      .references(() => amostra.id, { onDelete: 'cascade' })
      .unique(),

    /**
     * M08: campos estruturados e texto livre COEXISTEM. Um nao substitui o
     * outro - requisito explicito do modulo.
     */
    caracteristicas: jsonb('caracteristicas')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Texto gerado a partir dos campos, editavel pelo profissional. */
    descricaoTexto: text('descricao_texto'),

    /** Medidas em cm (unidade padrao do M08). */
    comprimentoCm: numeric('comprimento_cm', { precision: 8, scale: 2 }),
    larguraCm: numeric('largura_cm', { precision: 8, scale: 2 }),
    alturaCm: numeric('altura_cm', { precision: 8, scale: 2 }),
    pesoG: numeric('peso_g', { precision: 10, scale: 2 }),

    /** M08: marcacoes do cirurgiao (fio longo = cranial, clipe = margem profunda). */
    orientacaoPeca: jsonb('orientacao_peca').$type<Record<string, unknown>>(),
    croqui: jsonb('croqui').$type<Record<string, unknown>>(),

    /** M08: material totalmente incluido - repercute na Bioteca (M18). */
    materialTotalmenteIncluido: boolean('material_totalmente_incluido')
      .notNull()
      .default(false),
    materialRemanescente: text('material_remanescente'),

    // --- Registro de tempo (M08) ---
    iniciadaEm: timestamp('iniciada_em', { withTimezone: true }),
    concluidaEm: timestamp('concluida_em', { withTimezone: true }),
    executadaPorId: uuid('executada_por_id').references(() => usuario.id),
    /** M08: residente/tecnico em treinamento nao conclui sem aprovacao. */
    aprovadaPorId: uuid('aprovada_por_id').references(() => usuario.id),

    ...colunasTempo,
  },
  (t) => [
    index('idx_macroscopia_caso').on(t.tenantId, t.casoId),
    index('idx_macroscopia_executor').on(t.tenantId, t.executadaPorId),
  ],
);

/** M08: lesao descrita na macroscopia, com distancia ate as margens. */
export const lesaoMacroscopica = pgTable(
  'lesao_macroscopica',
  {
    ...colunasTenant,
    macroscopiaId: uuid('macroscopia_id')
      .notNull()
      .references(() => macroscopia.id, { onDelete: 'cascade' }),
    /** Rotulo curto: L01, L02... */
    rotulo: text('rotulo').notNull(),
    tipo: text('tipo'),
    localizacao: text('localizacao'),
    lateralidade: lateralidadeEnum('lateralidade').notNull().default('nao_aplicavel'),
    maiorEixoCm: numeric('maior_eixo_cm', { precision: 8, scale: 2 }),
    menorEixoCm: numeric('menor_eixo_cm', { precision: 8, scale: 2 }),
    delimitacao: text('delimitacao'),
    distribuicao: text('distribuicao'),
    /** unica | multiplas | incontaveis */
    numero: text('numero'),
    caracteristicas: jsonb('caracteristicas')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_lesao_rotulo').on(t.macroscopiaId, t.rotulo),
    index('idx_lesao_macroscopia').on(t.tenantId, t.macroscopiaId),
  ],
);

/**
 * M08: margem cirurgica avaliada macroscopicamente.
 *
 * O metodo de amostragem e registrado aqui porque, segundo o M13, ele e
 * essencial para interpretar a distancia medida na microscopia - tangencial e
 * perpendicular nao significam a mesma coisa.
 */
export const margemMacroscopica = pgTable(
  'margem_macroscopica',
  {
    ...colunasTenant,
    macroscopiaId: uuid('macroscopia_id')
      .notNull()
      .references(() => macroscopia.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    tipo: text('tipo'),
    metodoAmostragem: metodoAmostragemEnum('metodo_amostragem'),
    distanciaCm: numeric('distancia_cm', { precision: 8, scale: 2 }),
    /** M08: tinta usada, com cor, fabricante e metodo de fixacao. */
    tinta: jsonb('tinta').$type<Record<string, unknown>>(),
    /** True quando a margem nao pode ser avaliada macroscopicamente. */
    naoAvaliavel: boolean('nao_avaliavel').notNull().default(false),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_margem_macro_nome').on(t.macroscopiaId, t.nome),
    index('idx_margem_macroscopia').on(t.tenantId, t.macroscopiaId),
  ],
);

/**
 * M08: cassete gerado na amostragem.
 *
 * Regra estruturante: "cada cassete deve ter tecido de origem identificado e
 * vinculo com amostra e caso; cassetes nao podem ser renumerados sem
 * rastreabilidade".
 *
 * Primeiro elo da cadeia que o M09 chama de rastreabilidade total:
 *   Caso -> Amostra -> Cassete -> Bloco -> Corte -> Lamina -> Coloracao
 */
export const cassete = pgTable(
  'cassete',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id')
      .notNull()
      .references(() => amostra.id),
    macroscopiaId: uuid('macroscopia_id').references(() => macroscopia.id),
    lesaoId: uuid('lesao_id').references(() => lesaoMacroscopica.id),
    margemId: uuid('margem_id').references(() => margemMacroscopica.id),

    /** `CV-000342/26-A1` */
    identificador: text('identificador').notNull(),
    ordem: integer('ordem').notNull(),
    /** Tecido de origem - obrigatorio pela regra do M08. */
    tecidoOrigem: text('tecido_origem').notNull(),
    descricao: text('descricao'),

    /** M09: sinaliza necessidade de descalcificacao para o processamento. */
    exigeDescalcificacao: boolean('exige_descalcificacao').notNull().default(false),
    instrucoesEspeciais: text('instrucoes_especiais'),

    /** M09: status tecnico do cassete ao longo do processamento. */
    statusTecnico: text('status_tecnico').notNull().default('aguardando_processamento'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_cassete_identificador').on(t.tenantId, t.identificador),
    index('idx_cassete_caso').on(t.tenantId, t.casoId),
    index('idx_cassete_amostra').on(t.tenantId, t.amostraId),
    index('idx_cassete_status').on(t.tenantId, t.statusTecnico),
  ],
);

export const macroscopiaRelations = relations(macroscopia, ({ one, many }) => ({
  caso: one(caso, { fields: [macroscopia.casoId], references: [caso.id] }),
  amostra: one(amostra, { fields: [macroscopia.amostraId], references: [amostra.id] }),
  lesoes: many(lesaoMacroscopica),
  margens: many(margemMacroscopica),
  cassetes: many(cassete),
}));

export const lesaoMacroscopicaRelations = relations(lesaoMacroscopica, ({ one }) => ({
  macroscopia: one(macroscopia, {
    fields: [lesaoMacroscopica.macroscopiaId],
    references: [macroscopia.id],
  }),
}));

export const margemMacroscopicaRelations = relations(margemMacroscopica, ({ one }) => ({
  macroscopia: one(macroscopia, {
    fields: [margemMacroscopica.macroscopiaId],
    references: [macroscopia.id],
  }),
}));

export const casseteRelations = relations(cassete, ({ one }) => ({
  caso: one(caso, { fields: [cassete.casoId], references: [caso.id] }),
  amostra: one(amostra, { fields: [cassete.amostraId], references: [amostra.id] }),
  macroscopia: one(macroscopia, {
    fields: [cassete.macroscopiaId],
    references: [macroscopia.id],
  }),
}));
