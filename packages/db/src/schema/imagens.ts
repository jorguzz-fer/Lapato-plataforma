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
  nivelImagemEnum,
  origemImagemEnum,
  tipoImagemEnum,
} from './_comum.js';
import { caso } from './caso.js';
import { usuario } from './identidade.js';

/**
 * M16 - Imagens e Scanner de Laminas.
 *
 * DIRETRIZES secao 11: fotografias sao produzidas em recebimento, triagem,
 * macroscopia, necropsia, pericia, microscopia e logistica - mas TODOS os
 * arquivos sao armazenados e gerenciados aqui. Os demais modulos apenas
 * estabelecem o contexto.
 *
 * WSI esta fora do escopo v1 por decisao da propria documentacao (ADR 0004);
 * `tipo = 'whole_slide'` fica reservado.
 */
export const imagem = pgTable(
  'imagem',
  {
    ...colunasTenant,
    /** M16: identificador proprio (`IMG-2026-0004582`). */
    identificador: text('identificador').notNull(),
    casoId: uuid('caso_id').references(() => caso.id, { onDelete: 'cascade' }),

    tipo: tipoImagemEnum('tipo').notNull(),
    /**
     * M16: a origem e obrigatoria. Imagem enviada pelo cliente aparece
     * visualmente separada da produzida pelo laboratorio.
     */
    origem: origemImagemEnum('origem').notNull(),

    /** Modulo que forneceu o contexto da captura. */
    moduloContexto: text('modulo_contexto').notNull(),
    /** Objeto relacionado: amostra, lesao, cassete, bloco, lamina. */
    objetoTipo: text('objeto_tipo'),
    objetoId: uuid('objeto_id'),

    /** Metadados anatomopatologicos: orgao, tecido, coloracao, aumento... */
    metadados: jsonb('metadados').$type<Record<string, unknown>>().notNull().default({}),
    legenda: text('legenda'),
    descricao: text('descricao'),

    /**
     * M16: data de captura != data de upload. Distincao explicita do modulo.
     */
    capturadaEm: timestamp('capturada_em', { withTimezone: true }),
    enviadaEm: timestamp('enviada_em', { withTimezone: true }).notNull().defaultNow(),
    autorId: uuid('autor_id').references(() => usuario.id),

    /** M16: selecionada para compor o laudo, com ordem de exibicao. */
    incluidaNoLaudo: boolean('incluida_no_laudo').notNull().default(false),
    ordemNoLaudo: integer('ordem_no_laudo'),

    /**
     * M16 e M17 secao 97: uso didatico, cientifico ou de treinamento de modelo
     * depende de autorizacao explicita e anonimizacao. Armazenar imagem clinica
     * NAO implica autorizacao de pesquisa.
     */
    autorizadaEnsino: boolean('autorizada_ensino').notNull().default(false),
    autorizadaPesquisa: boolean('autorizada_pesquisa').notNull().default(false),
    autorizadaTreinamentoIa: boolean('autorizada_treinamento_ia').notNull().default(false),

    /**
     * M16 secao 73: miniatura para a galeria - "o arquivo original somente
     * sera carregado quando necessario". Nao e um `nivel` da imagem: os tres
     * niveis (original, trabalho, publicada) sao estados do CONTEUDO, e a
     * miniatura e so uma representacao de navegacao do mesmo conteudo.
     *
     * Nula quando quem enviou nao produziu miniatura; a galeria cai no
     * original nesse caso.
     */
    miniaturaChave: text('miniatura_chave'),

    /**
     * M16: exclusao e restrita - prefere-se inativar mantendo o historico
     * (INATIVADA / MARCADA COMO NAO UTILIZAR / CAPTURA ACIDENTAL).
     */
    inativadaEm: timestamp('inativada_em', { withTimezone: true }),
    motivoInativacao: text('motivo_inativacao'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_imagem_identificador').on(t.tenantId, t.identificador),
    index('idx_imagem_caso').on(t.tenantId, t.casoId),
    index('idx_imagem_objeto').on(t.tenantId, t.objetoTipo, t.objetoId),
    index('idx_imagem_tipo').on(t.tenantId, t.tipo),
  ],
);

/**
 * M16: versoes da imagem.
 *
 * Regra dura do modulo: **o arquivo original e preservado e nunca sobrescrito**.
 * Edicoes sao nao destrutivas e geram versao derivada; anotacoes sao camada
 * separada; selecionar para o laudo nao modifica o original.
 */
export const imagemVersao = pgTable(
  'imagem_versao',
  {
    ...colunasTenant,
    imagemId: uuid('imagem_id')
      .notNull()
      .references(() => imagem.id, { onDelete: 'cascade' }),
    nivel: nivelImagemEnum('nivel').notNull(),
    /** Chave no bucket privado. Acesso so por URL assinada curta pos-authz. */
    chaveStorage: text('chave_storage').notNull(),
    /**
     * M16: identificador criptografico do original, para verificacao de
     * integridade. Utilizavel pelo M24 em contexto pericial.
     */
    hash: text('hash'),
    mimeType: text('mime_type').notNull(),
    tamanhoBytes: integer('tamanho_bytes'),
    largura: integer('largura'),
    altura: integer('altura'),
    /** Transformacoes aplicadas, para a edicao ser reversivel e auditavel. */
    transformacoes: jsonb('transformacoes').$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    criadaPorId: uuid('criada_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_imagem_versao_nivel').on(t.imagemId, t.nivel),
    index('idx_imagem_versao').on(t.tenantId, t.imagemId),
  ],
);

/** M16: anotacoes em camada separada - nunca queimadas no arquivo. */
export const imagemAnotacao = pgTable(
  'imagem_anotacao',
  {
    ...colunasTenant,
    imagemId: uuid('imagem_id')
      .notNull()
      .references(() => imagem.id, { onDelete: 'cascade' }),
    /** seta | circulo | medida | texto | roi */
    tipo: text('tipo').notNull(),
    /** Geometria e estilo da anotacao. */
    geometria: jsonb('geometria').$type<Record<string, unknown>>().notNull(),
    texto: text('texto'),
    /**
     * M16: medida sem referencia espacial confiavel nao pode ser apresentada
     * como exata. Quando a escala nao foi calibrada, o front sinaliza.
     */
    escalaCalibrada: boolean('escala_calibrada').notNull().default(false),
    autorId: uuid('autor_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [index('idx_anotacao_imagem').on(t.tenantId, t.imagemId)],
);

export const imagemRelations = relations(imagem, ({ one, many }) => ({
  caso: one(caso, { fields: [imagem.casoId], references: [caso.id] }),
  versoes: many(imagemVersao),
  anotacoes: many(imagemAnotacao),
}));

export const imagemVersaoRelations = relations(imagemVersao, ({ one }) => ({
  imagem: one(imagem, { fields: [imagemVersao.imagemId], references: [imagem.id] }),
}));
