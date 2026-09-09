import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  categoriaDocumentoEnum,
  colunasTempo,
  colunasTenant,
  contextoBibliotecaEnum,
  desfechoRevisaoEnum,
  publicoDocumentoEnum,
  statusDocumentoEnum,
  statusVersaoDocumentoEnum,
  tipoDocumentoEnum,
  tipoFeedbackDocumentoEnum,
} from './_comum.js';
import { usuario } from './identidade.js';

/**
 * M21 - Biblioteca.
 *
 * O modulo e proprietario do conhecimento institucional (secao 3) e nao do
 * registro transacional: a macroscopia de um caso e do M08; o protocolo de
 * macroscopia de pele e daqui. Tambem nao e a Bioteca (secao 4): aqui ha
 * documentos, la ha blocos.
 *
 * Duas tabelas carregam a regra central. `documento` e a identidade estavel
 * (codigo, titulo, categoria, responsavel); `versao_documento` e o conteudo,
 * e SO UMA versao por documento e vigente (secao 19). Publicar uma nova nao
 * apaga a anterior: torna-a obsoleta e consultavel (secoes 17, 20, 33).
 */
export const documentoBiblioteca = pgTable(
  'documento_biblioteca',
  {
    ...colunasTenant,
    /** Secao 10: `POP-HIST-004`, estavel entre versoes (secao 11). */
    codigo: text('codigo').notNull(),
    titulo: text('titulo').notNull(),
    tipo: tipoDocumentoEnum('tipo').notNull(),
    categoria: categoriaDocumentoEnum('categoria').notNull(),
    /** Secao 7: `Pele > Tumores > Mastocitoma`, texto livre com separador. */
    subcategoria: text('subcategoria'),
    /** Secao 8: colecoes tematicas, ortogonais a categoria. */
    colecoes: text('colecoes').array().notNull().default([]),
    /** Secao 41: descritores controlados pela instituicao, livres na v1. */
    palavrasChave: text('palavras_chave').array().notNull().default([]),
    resumo: text('resumo'),

    /** Secao 107: todo documento tem responsavel institucional. */
    responsavelId: uuid('responsavel_id').references(() => usuario.id),
    /** Secao 88: quem ve. `clientes` e o que o Portal mostra. */
    publico: publicoDocumentoEnum('publico').notNull().default('colaboradores'),
    /** Secoes 51 a 58: em quais telas o documento e oferecido como ajuda. */
    contextos: contextoBibliotecaEnum('contextos').array().notNull().default([]),

    status: statusDocumentoEnum('status').notNull().default('rascunho'),
    /** Secao 27: documentos controlados exigem aprovacao antes de vigorar. */
    exigeAprovacao: boolean('exige_aprovacao').notNull().default(false),
    /** Secao 69: documentos criticos exigem confirmacao de leitura. */
    exigeCiencia: boolean('exige_ciencia').notNull().default(false),
    /** Secao 66: acesso destacado - biosseguranca, acidentes, emergencia. */
    critico: boolean('critico').notNull().default(false),
    /** Secao 91: o administrador decide se baixa ou so visualiza. */
    permiteDownload: boolean('permite_download').notNull().default(true),

    /** Secao 30: prazo programado de revisao, em meses. Nulo: sem prazo. */
    revisaoPeriodicaMeses: integer('revisao_periodica_meses'),
    /** Secao 31: calculada na publicacao; o Guardian olha para ca. */
    proximaRevisaoEm: date('proxima_revisao_em'),

    /** A versao vigente. Nula em rascunho, obsoleto e arquivado. */
    versaoVigenteId: uuid('versao_vigente_id'),

    /** Secao 44: contador simples de consultas a ficha. */
    acessos: integer('acessos').notNull().default(0),

    obsoletoEm: timestamp('obsoleto_em', { withTimezone: true }),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    motivoSaida: text('motivo_saida'),
    criadoPorId: uuid('criado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_documento_biblioteca_codigo').on(t.tenantId, t.codigo),
    index('idx_documento_biblioteca_status').on(t.tenantId, t.status),
    index('idx_documento_biblioteca_categoria').on(t.tenantId, t.categoria),
    index('idx_documento_biblioteca_revisao').on(t.tenantId, t.proximaRevisaoEm),
  ],
);

/**
 * A versao (secoes 17 a 29).
 *
 * Conteudo escrito no editor interno (secao 14) OU arquivo anexado (secao 15)
 * OU link externo (secoes 78-79) - um documento de terceiro cujo arquivo nao
 * pode ser guardado fica so com a referencia. O original de um anexo nunca e
 * sobrescrito: nova versao, novo arquivo.
 */
export const versaoDocumento = pgTable(
  'versao_documento',
  {
    ...colunasTenant,
    documentoId: uuid('documento_id')
      .notNull()
      .references(() => documentoBiblioteca.id, { onDelete: 'cascade' }),
    /** Secao 18: `1.0`, `1.1`, `2.0`. */
    numero: text('numero').notNull(),
    status: statusVersaoDocumentoEnum('status').notNull().default('rascunho'),

    /** Editor interno: texto simples com marcacao leve (titulos, listas). */
    conteudo: text('conteudo'),
    /** Anexo no storage (M16 guarda imagem de caso; documento fica aqui). */
    arquivoChave: text('arquivo_chave'),
    arquivoNome: text('arquivo_nome'),
    arquivoMime: text('arquivo_mime'),
    arquivoTamanho: integer('arquivo_tamanho'),
    arquivoHash: text('arquivo_hash'),
    linkExterno: text('link_externo'),

    /** Secao 22: por que esta versao existe. */
    motivoRevisao: text('motivo_revisao'),

    autorId: uuid('autor_id').references(() => usuario.id),
    enviadaRevisaoEm: timestamp('enviada_revisao_em', { withTimezone: true }),
    revisaoConcluidaEm: timestamp('revisao_concluida_em', { withTimezone: true }),
    revisadaPorId: uuid('revisada_por_id').references(() => usuario.id),
    /** Secao 28: quem aprovou, quando, qual versao. */
    aprovadaPorId: uuid('aprovada_por_id').references(() => usuario.id),
    aprovadaEm: timestamp('aprovada_em', { withTimezone: true }),
    publicadaPorId: uuid('publicada_por_id').references(() => usuario.id),
    publicadaEm: timestamp('publicada_em', { withTimezone: true }),
    obsoletaEm: timestamp('obsoleta_em', { withTimezone: true }),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_versao_documento_numero').on(t.documentoId, t.numero),
    index('idx_versao_documento').on(t.tenantId, t.documentoId, t.status),
  ],
);

/** Secao 26: a conversa da revisao, presa a versao. */
export const comentarioRevisao = pgTable(
  'comentario_revisao',
  {
    ...colunasTenant,
    versaoId: uuid('versao_id')
      .notNull()
      .references(() => versaoDocumento.id, { onDelete: 'cascade' }),
    autorId: uuid('autor_id').references(() => usuario.id),
    desfecho: desfechoRevisaoEnum('desfecho').notNull().default('comentario'),
    texto: text('texto').notNull(),
    ...colunasTempo,
  },
  (t) => [index('idx_comentario_revisao').on(t.tenantId, t.versaoId)],
);

/**
 * Secoes 69 a 72: a ciencia e por VERSAO. Nova versao relevante, nova ciencia
 * (secao 71) - por isso a chave e (versao, usuario), e nao (documento, usuario).
 */
export const cienciaDocumento = pgTable(
  'ciencia_documento',
  {
    ...colunasTenant,
    versaoId: uuid('versao_id')
      .notNull()
      .references(() => versaoDocumento.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    confirmadaEm: timestamp('confirmada_em', { withTimezone: true }).notNull().defaultNow(),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_ciencia_versao_usuario').on(t.versaoId, t.usuarioId),
    index('idx_ciencia_documento').on(t.tenantId, t.versaoId),
  ],
);

/** Secoes 105 a 108: o que o usuario diz do documento, encaminhado ao responsavel. */
export const feedbackDocumento = pgTable(
  'feedback_documento',
  {
    ...colunasTenant,
    /** Nulo quando e pedido de conteudo que nao existe (secao 106). */
    documentoId: uuid('documento_id').references(() => documentoBiblioteca.id, {
      onDelete: 'cascade',
    }),
    usuarioId: uuid('usuario_id').references(() => usuario.id),
    tipo: tipoFeedbackDocumentoEnum('tipo').notNull(),
    texto: text('texto'),
    tratadoEm: timestamp('tratado_em', { withTimezone: true }),
    tratadoPorId: uuid('tratado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [index('idx_feedback_documento').on(t.tenantId, t.documentoId)],
);

export const documentoBibliotecaRelations = relations(documentoBiblioteca, ({ one, many }) => ({
  responsavel: one(usuario, {
    fields: [documentoBiblioteca.responsavelId],
    references: [usuario.id],
  }),
  versoes: many(versaoDocumento),
  feedbacks: many(feedbackDocumento),
}));

export const versaoDocumentoRelations = relations(versaoDocumento, ({ one, many }) => ({
  documento: one(documentoBiblioteca, {
    fields: [versaoDocumento.documentoId],
    references: [documentoBiblioteca.id],
  }),
  comentarios: many(comentarioRevisao),
  ciencias: many(cienciaDocumento),
}));

export const comentarioRevisaoRelations = relations(comentarioRevisao, ({ one }) => ({
  versao: one(versaoDocumento, {
    fields: [comentarioRevisao.versaoId],
    references: [versaoDocumento.id],
  }),
}));

export const cienciaDocumentoRelations = relations(cienciaDocumento, ({ one }) => ({
  versao: one(versaoDocumento, {
    fields: [cienciaDocumento.versaoId],
    references: [versaoDocumento.id],
  }),
  usuario: one(usuario, { fields: [cienciaDocumento.usuarioId], references: [usuario.id] }),
}));

export const feedbackDocumentoRelations = relations(feedbackDocumento, ({ one }) => ({
  documento: one(documentoBiblioteca, {
    fields: [feedbackDocumento.documentoId],
    references: [documentoBiblioteca.id],
  }),
}));
