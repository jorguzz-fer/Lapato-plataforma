import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { colunasInativacao, colunasTempo, colunasTenant, tipoUnidadeEnum } from './_comum.js';

/**
 * M01 - Administracao e Configuracoes: estrutura institucional.
 *
 * Hierarquia: tenant (instituicao) -> unidade -> setor -> local fisico.
 *
 * Atencao a distincao que importa: uma instituicao com cinco filiais e UM
 * tenant, nao cinco. Multiplas unidades sao estrutura interna; multiplos
 * tenants sao instituicoes diferentes usando o mesmo SaaS (ADR 0002).
 */

/**
 * A instituicao. Raiz do isolamento.
 *
 * Nao carrega `tenantId` porque ela **e** o tenant - por isso nao usa
 * `colunasTenant`. Fica fora da RLS por tenant e so e acessivel pelo caminho
 * de autenticacao.
 */
export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Identificador curto usado em subdominio e chaves de cache. */
    slug: text('slug').notNull().unique(),
    razaoSocial: text('razao_social').notNull(),
    nomeFantasia: text('nome_fantasia').notNull(),
    cnpj: text('cnpj'),
    /** M01 secao 30: idioma, formatos, fuso e unidades de medida. */
    preferencias: jsonb('preferencias').$type<Record<string, unknown>>().notNull().default({}),
    /** M01: identidade visual (logo, cores) para laudo e Portal. White-label leve. */
    identidadeVisual: jsonb('identidade_visual')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [index('idx_tenant_slug').on(t.slug)],
);

/**
 * M01 secao 7: "o LAPATO devera permitir funcionamento com uma unica unidade ou
 * multiplas unidades. Cada unidade devera possuir identificacao propria e
 * podera herdar configuracoes gerais da instituicao."
 */
export const unidade = pgTable(
  'unidade',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    codigo: text('codigo').notNull(),
    sigla: text('sigla'),
    tipo: tipoUnidadeEnum('tipo').notNull(),
    endereco: jsonb('endereco').$type<Record<string, unknown>>(),
    contatos: jsonb('contatos').$type<Record<string, unknown>>(),
    responsavel: text('responsavel'),
    horarioFuncionamento: jsonb('horario_funcionamento').$type<Record<string, unknown>>(),
    /**
     * M01 secao 7.3: configuracao especifica da unidade. Quando ausente, vale a
     * configuracao global da instituicao. Ex.: prazo institucional de
     * histopatologia = 5 dias uteis; Unidade B = 7.
     */
    configuracaoEspecifica: jsonb('configuracao_especifica')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_unidade_codigo').on(t.tenantId, t.codigo),
    index('idx_unidade_tenant').on(t.tenantId),
  ],
);

/** M01 secao 8: cada unidade pode ser subdividida em setores. */
export const setor = pgTable(
  'setor',
  {
    ...colunasTenant,
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => unidade.id),
    nome: text('nome').notNull(),
    codigo: text('codigo').notNull(),
    /** Ex.: recepcao, triagem, macroscopia, histotecnica, microscopia. */
    tipo: text('tipo').notNull(),
    responsavelId: uuid('responsavel_id'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_setor_codigo').on(t.tenantId, t.unidadeId, t.codigo),
    index('idx_setor_unidade').on(t.tenantId, t.unidadeId),
  ],
);

/**
 * M01 secao 9: locais fisicos hierarquicos (geladeira 01, freezer 02, arquivo
 * de blocos, prateleira, area de descarte).
 *
 * O M01 define quais locais existem; Rastreamento, Controle de Cadaveres e
 * Bioteca registram o que esta em cada um - sem duplicar o cadastro.
 */
export const localFisico = pgTable(
  'local_fisico',
  {
    ...colunasTenant,
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => unidade.id),
    setorId: uuid('setor_id').references(() => setor.id),
    /** Auto-referencia: freezer -> rack -> caixa -> posicao. */
    paiId: uuid('pai_id'),
    nome: text('nome').notNull(),
    codigo: text('codigo').notNull(),
    categoria: text('categoria').notNull(),
    capacidade: integer('capacidade'),
    /** Ex.: refrigerado, congelado, ambiente. */
    condicaoAmbiental: text('condicao_ambiental'),
    restricaoAcesso: text('restricao_acesso'),
    status: text('status').notNull().default('operacional'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_local_codigo').on(t.tenantId, t.codigo),
    index('idx_local_unidade').on(t.tenantId, t.unidadeId),
    index('idx_local_pai').on(t.paiId),
  ],
);

export const tenantRelations = relations(tenant, ({ many }) => ({
  unidades: many(unidade),
}));

export const unidadeRelations = relations(unidade, ({ one, many }) => ({
  tenant: one(tenant, { fields: [unidade.tenantId], references: [tenant.id] }),
  setores: many(setor),
  locais: many(localFisico),
}));

export const setorRelations = relations(setor, ({ one }) => ({
  unidade: one(unidade, { fields: [setor.unidadeId], references: [unidade.id] }),
}));

export const localFisicoRelations = relations(localFisico, ({ one }) => ({
  unidade: one(unidade, { fields: [localFisico.unidadeId], references: [unidade.id] }),
  setor: one(setor, { fields: [localFisico.setorId], references: [setor.id] }),
}));
