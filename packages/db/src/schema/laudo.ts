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
  resultadoMargemEnum,
  statusLaudoEnum,
  tipoVersaoLaudoEnum,
} from './_comum.js';
import { amostra, caso } from './caso.js';
import { lamina } from './processamento.js';
import { usuario } from './identidade.js';

/**
 * M11 - Laudos e Microscopia + M13 - Histopatologia.
 *
 * DIRETRIZES secao 8.4: o M13 define a LOGICA DIAGNOSTICA da histopatologia; o
 * M11 fornece o AMBIENTE comum de interpretacao e documentacao (editor,
 * revisao, versionamento, assinatura, liberacao). As duas coisas nao se
 * misturam.
 *
 * ADR 0005: o laudo E o dado estruturado versionado. O PDF e representacao.
 */

export const laudo = pgTable(
  'laudo',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'cascade' })
      .unique(),
    status: statusLaudoEnum('status').notNull().default('rascunho'),
    /** Numero da versao vigente. */
    versaoAtual: integer('versao_atual').notNull().default(1),

    patologistaId: uuid('patologista_id').references(() => usuario.id),
    revisorId: uuid('revisor_id').references(() => usuario.id),

    /** M11: a liberacao e o evento que dispara todas as consequencias. */
    liberadoEm: timestamp('liberado_em', { withTimezone: true }),
    /**
     * M07: reabrir um caso liberado preserva a data de liberacao ORIGINAL.
     * Por isso este campo nunca e sobrescrito depois da primeira liberacao.
     */
    primeiraLiberacaoEm: timestamp('primeira_liberacao_em', { withTimezone: true }),

    ...colunasTempo,
  },
  (t) => [
    index('idx_laudo_caso').on(t.tenantId, t.casoId),
    index('idx_laudo_status').on(t.tenantId, t.status),
    index('idx_laudo_patologista').on(t.tenantId, t.patologistaId),
  ],
);

/**
 * Versao do laudo.
 *
 * M11: **adendo != correcao** - adendo acrescenta, correcao retifica. Ambos
 * criam versao nova e preservam a anterior; o Portal sinaliza "documento
 * substituido por versao posterior".
 *
 * O conteudo estruturado fica em `conteudo`; o PDF derivado e congelado por
 * versao, com hash, para que o documento entregue seja byte a byte o assinado.
 */
export const laudoVersao = pgTable(
  'laudo_versao',
  {
    ...colunasTenant,
    laudoId: uuid('laudo_id')
      .notNull()
      .references(() => laudo.id, { onDelete: 'cascade' }),
    versao: integer('versao').notNull(),
    tipo: tipoVersaoLaudoEnum('tipo').notNull().default('original'),

    /** Secoes do laudo: historico, macro, micro, diagnostico, comentarios... */
    conteudo: jsonb('conteudo').$type<Record<string, unknown>>().notNull().default({}),
    descricaoMicroscopica: text('descricao_microscopica'),
    comentarios: text('comentarios'),
    conclusao: text('conclusao'),

    /**
     * M11: nota interna NUNCA aparece no documento externo e tem controle de
     * acesso proprio (permissao `laudo:ver_nota_interna`).
     */
    notaInterna: text('nota_interna'),

    /** M11: motivo obrigatorio em adendo e correcao. */
    motivo: text('motivo'),

    criadaPorId: uuid('criada_por_id').references(() => usuario.id),

    // --- Assinatura (M11 secao 82) ---
    assinadaEm: timestamp('assinada_em', { withTimezone: true }),
    assinadaPorId: uuid('assinada_por_id').references(() => usuario.id),
    /** Conselho e registro do profissional, congelados no momento da assinatura. */
    assinaturaIdentificacao: text('assinatura_identificacao'),
    /** senha | mfa_totp | certificado_digital */
    assinaturaMecanismo: text('assinatura_mecanismo'),

    // --- PDF derivado (ADR 0005) ---
    pdfChave: text('pdf_chave'),
    pdfHash: text('pdf_hash'),
    /** M11: codigo do QR Code de validacao de autenticidade. */
    codigoValidacao: text('codigo_validacao'),

    /** True quando uma versao posterior a substituiu. */
    substituida: boolean('substituida').notNull().default(false),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_laudo_versao').on(t.laudoId, t.versao),
    index('idx_laudo_versao_laudo').on(t.tenantId, t.laudoId),
    index('idx_laudo_versao_codigo').on(t.codigoValidacao),
  ],
);

/**
 * M11 + M13: diagnostico ESTRUTURADO.
 *
 * M13: o diagnostico morfologico e composto por orgao + processo + distribuicao
 * + severidade + duracao + qualificadores. Guardar so o texto exibido
 * inviabilizaria pesquisa, indicadores e a Memoria Anatomopatologica (ADR 0005).
 */
export const diagnostico = pgTable(
  'diagnostico',
  {
    ...colunasTenant,
    laudoVersaoId: uuid('laudo_versao_id')
      .notNull()
      .references(() => laudoVersao.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id').references(() => amostra.id),

    ordem: integer('ordem').notNull().default(0),
    /** M13: principal | secundario | incidental | associado */
    hierarquia: text('hierarquia').notNull().default('principal'),

    // --- Componentes estruturados ---
    orgaoId: uuid('orgao_id'),
    processo: text('processo'),
    entidade: text('entidade'),
    /** benigno | maligno | indeterminado | nao_neoplasico */
    comportamento: text('comportamento'),
    distribuicao: text('distribuicao'),
    severidade: text('severidade'),
    duracao: text('duracao'),
    qualificadores: jsonb('qualificadores').$type<string[]>().notNull().default([]),
    lateralidade: lateralidadeEnum('lateralidade').notNull().default('nao_aplicavel'),

    /** Texto exibido no laudo, que pode diferir da composicao estruturada. */
    textoExibido: text('texto_exibido').notNull(),

    /**
     * M11 secao 42 e M13: a classificacao e versionada. Casos antigos preservam
     * a versao vigente a epoca - atualizar a classificacao nao altera
     * retroativamente diagnosticos ja emitidos.
     */
    classificacaoNome: text('classificacao_nome'),
    classificacaoVersao: text('classificacao_versao'),

    /** M13: grau e o escore que o produziu. */
    grau: text('grau'),
    /**
     * M13 secao 120: e PROIBIDO guardar so o resultado final do escore - os
     * criterios individuais precisam ficar, para auditoria e reprocessamento
     * cientifico futuro.
     */
    criteriosGraduacao: jsonb('criterios_graduacao').$type<Record<string, unknown>>(),

    /** M11: diferenciais sao campo interno, nao entram no laudo automaticamente. */
    diferenciais: jsonb('diferenciais').$type<string[]>().notNull().default([]),
    /** M11/M12: provisorio nao equivale a liberado. */
    provisorio: boolean('provisorio').notNull().default(false),

    ...colunasTempo,
  },
  (t) => [
    index('idx_diagnostico_versao').on(t.tenantId, t.laudoVersaoId),
    index('idx_diagnostico_entidade').on(t.tenantId, t.entidade),
  ],
);

/**
 * M13: margem avaliada microscopicamente.
 *
 * O modulo e explicito: o sistema NAO impoe valor universal para "margem
 * proxima" - depende do tumor, do protocolo e da literatura, e vem do template.
 * Por isso nao existe threshold no schema.
 */
export const margemMicroscopica = pgTable(
  'margem_microscopica',
  {
    ...colunasTenant,
    laudoVersaoId: uuid('laudo_versao_id')
      .notNull()
      .references(() => laudoVersao.id, { onDelete: 'cascade' }),
    /** Margem macroscopica correspondente, para preservar a orientacao do M08. */
    margemMacroId: uuid('margem_macro_id'),
    nome: text('nome').notNull(),
    resultado: resultadoMargemEnum('resultado').notNull(),
    distanciaMm: numeric('distancia_mm', { precision: 8, scale: 2 }),
    /** in_situ | invasivo */
    tipoExtensao: text('tipo_extensao'),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_margem_micro_nome').on(t.laudoVersaoId, t.nome),
    index('idx_margem_micro_versao').on(t.tenantId, t.laudoVersaoId),
  ],
);

/**
 * M13: contagem mitotica.
 *
 * Requisito tecnico explicito: a area avaliada e registrada em **mm2**, nao em
 * "campos de grande aumento" - porque o diametro do campo varia por microscopio
 * e "8/10 CGA" nao e reproduzivel. O metodo e os parametros ficam guardados
 * para permitir a conversao transparente.
 */
export const contagemMitotica = pgTable(
  'contagem_mitotica',
  {
    ...colunasTenant,
    laudoVersaoId: uuid('laudo_versao_id')
      .notNull()
      .references(() => laudoVersao.id, { onDelete: 'cascade' }),
    laminaId: uuid('lamina_id').references(() => lamina.id),
    mitoses: integer('mitoses').notNull(),
    areaMm2: numeric('area_mm2', { precision: 8, scale: 4 }).notNull(),
    numeroCampos: integer('numero_campos'),
    diametroCampoMm: numeric('diametro_campo_mm', { precision: 6, scale: 4 }),
    equipamento: text('equipamento'),
    regiaoSelecionada: text('regiao_selecionada'),
    mitosesAtipicas: integer('mitoses_atipicas'),
    ...colunasTempo,
  },
  (t) => [index('idx_contagem_versao').on(t.tenantId, t.laudoVersaoId)],
);

/**
 * M11: registro da revisao.
 *
 * O modulo prevê varios modelos institucionais: sem revisao, amostral, por
 * modalidade, obrigatoria, para profissionais em treinamento, dupla revisao.
 */
export const revisaoLaudo = pgTable(
  'revisao_laudo',
  {
    ...colunasTenant,
    laudoVersaoId: uuid('laudo_versao_id')
      .notNull()
      .references(() => laudoVersao.id, { onDelete: 'cascade' }),
    revisorId: uuid('revisor_id')
      .notNull()
      .references(() => usuario.id),
    /** aprovada | ajustes_solicitados */
    resultado: text('resultado').notNull(),
    comentarios: text('comentarios'),
    /** M13: registro de discordancia, insumo para a Qualidade (M22). */
    discordancia: boolean('discordancia').notNull().default(false),
    concluidaEm: timestamp('concluida_em', { withTimezone: true }),
    ...colunasTempo,
  },
  (t) => [index('idx_revisao_versao').on(t.tenantId, t.laudoVersaoId)],
);

export const laudoRelations = relations(laudo, ({ one, many }) => ({
  caso: one(caso, { fields: [laudo.casoId], references: [caso.id] }),
  versoes: many(laudoVersao),
  patologista: one(usuario, { fields: [laudo.patologistaId], references: [usuario.id] }),
}));

export const laudoVersaoRelations = relations(laudoVersao, ({ one, many }) => ({
  laudo: one(laudo, { fields: [laudoVersao.laudoId], references: [laudo.id] }),
  diagnosticos: many(diagnostico),
  margens: many(margemMicroscopica),
  contagens: many(contagemMitotica),
  revisoes: many(revisaoLaudo),
}));

export const diagnosticoRelations = relations(diagnostico, ({ one }) => ({
  versao: one(laudoVersao, {
    fields: [diagnostico.laudoVersaoId],
    references: [laudoVersao.id],
  }),
  amostra: one(amostra, { fields: [diagnostico.amostraId], references: [amostra.id] }),
}));
