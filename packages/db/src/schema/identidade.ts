import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  categoriaUsuarioEnum,
  colunasInativacao,
  colunasTempo,
  colunasTenant,
  statusUsuarioEnum,
} from './_comum.js';
import { setor, unidade } from './tenancy.js';

/**
 * M02 - Usuarios, Perfis e Permissoes.
 *
 * Principio do modulo: "toda acao deve ter autor identificavel, e todo acesso
 * deve obedecer ao menor nivel de privilegio necessario".
 *
 * M02 secao 3: contas compartilhadas ("Recepcao", "Laboratorio") sao PROIBIDAS.
 * A linha do tempo precisa dizer "Amostra recebida por Ana Beatriz Silva", nao
 * "por Recepcao".
 */

export const usuario = pgTable(
  'usuario',
  {
    ...colunasTenant,
    nomeCompleto: text('nome_completo').notNull(),
    /** M02 secao 7.1: nome social ou de exibicao, quando aplicavel. */
    nomeExibicao: text('nome_exibicao'),
    email: text('email').notNull(),
    /** LGPD: opcional por minimizacao. Ver docs/dados-pessoais.md. */
    cpf: text('cpf'),
    telefone: text('telefone'),

    /** Argon2id (Blueprint secao 6). Nulo enquanto o convite nao for aceito. */
    senhaHash: text('senha_hash'),
    /** Segredo TOTP cifrado. MFA e obrigatorio para papeis sensiveis. */
    mfaSegredo: text('mfa_segredo'),
    mfaAtivo: boolean('mfa_ativo').notNull().default(false),

    status: statusUsuarioEnum('status').notNull().default('aguardando_ativacao'),
    categoria: categoriaUsuarioEnum('categoria').notNull().default('interno'),

    /** M02 secao 7.3: profissao, conselho, registro, especialidade. */
    dadosProfissionais: jsonb('dados_profissionais')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    unidadePrincipalId: uuid('unidade_principal_id').references(() => unidade.id),
    setorPrincipalId: uuid('setor_principal_id').references(() => setor.id),

    /** M02 secao 6.4: usuarios temporarios expiram automaticamente. */
    acessoExpiraEm: timestamp('acesso_expira_em', { withTimezone: true }),
    ultimoAcessoEm: timestamp('ultimo_acesso_em', { withTimezone: true }),

    /**
     * M02: bloqueio progressivo. Contador de falhas consecutivas e ate quando a
     * conta esta travada (Blueprint secao 6: lockout progressivo).
     */
    tentativasFalhas: jsonb('tentativas_falhas')
      .$type<{ contador: number; bloqueadoAte: string | null }>()
      .notNull()
      .default({ contador: 0, bloqueadoAte: null }),

    /**
     * M03/M04: quando o usuario e externo, aponta para o cliente ao qual esta
     * vinculado. E a base do isolamento do Portal do Cliente.
     * Sem FK para evitar dependencia circular entre modulos de schema.
     */
    clienteId: uuid('cliente_id'),

    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_usuario_email').on(t.tenantId, t.email),
    index('idx_usuario_tenant').on(t.tenantId),
    index('idx_usuario_status').on(t.tenantId, t.status),
    index('idx_usuario_cliente').on(t.tenantId, t.clienteId),
  ],
);

/**
 * M02 secao 9: perfis sao modelos de permissao.
 * M02 secao 10: "perfis nao devem ser absolutos" - a instituicao cria os seus, e
 * permissoes individuais ajustam por pessoa.
 */
export const perfil = pgTable(
  'perfil',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    /** Chave estavel dos perfis semeados (PERFIS_PADRAO). Nulo se criado a mao. */
    chave: text('chave'),
    descricao: text('descricao'),
    /**
     * M11: perfis em treinamento elaboram rascunho mas o sistema impede
     * assinatura e exige revisao.
     */
    exigeSupervisao: boolean('exige_supervisao').notNull().default(false),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_perfil_nome').on(t.tenantId, t.nome),
    index('idx_perfil_tenant').on(t.tenantId),
  ],
);

/** Permissoes concedidas por um perfil. Chave = valor de PERMISSOES. */
export const perfilPermissao = pgTable(
  'perfil_permissao',
  {
    ...colunasTenant,
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfil.id, { onDelete: 'cascade' }),
    permissao: text('permissao').notNull(),
    /** M02 secao 13: instituicao, unidade, setor ou proprios_casos. */
    escopo: text('escopo').notNull().default('unidade'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_perfil_permissao').on(t.perfilId, t.permissao),
    index('idx_perfil_permissao_perfil').on(t.tenantId, t.perfilId),
  ],
);

export const usuarioPerfil = pgTable(
  'usuario_perfil',
  {
    ...colunasTenant,
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfil.id),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_usuario_perfil').on(t.usuarioId, t.perfilId),
    index('idx_usuario_perfil_usuario').on(t.tenantId, t.usuarioId),
  ],
);

/**
 * M02 secao 15: o usuario pode ter unidade principal e unidades adicionais, com
 * nivel de acesso diferente em cada uma. Ex.: "Fortaleza - acesso total;
 * Sao Paulo - apenas revisao; Campinas - sem acesso".
 */
export const usuarioUnidade = pgTable(
  'usuario_unidade',
  {
    ...colunasTenant,
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => unidade.id),
    /** total | leitura | revisao */
    nivelAcesso: text('nivel_acesso').notNull().default('total'),
    /** M02 secao 16: acesso temporario a outra unidade. */
    validoAte: timestamp('valido_ate', { withTimezone: true }),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_usuario_unidade').on(t.usuarioId, t.unidadeId),
    index('idx_usuario_unidade_usuario').on(t.tenantId, t.usuarioId),
  ],
);

/**
 * M02 secao 10: permissoes individuais ajustam o perfil.
 *
 * `concedida = false` cria permissao NEGATIVA, que vence a do perfil. E como se
 * tira de um patologista especifico o direito de liberar sozinho, sem precisar
 * criar um perfil novo so para ele.
 */
export const permissaoIndividual = pgTable(
  'permissao_individual',
  {
    ...colunasTenant,
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    permissao: text('permissao').notNull(),
    concedida: boolean('concedida').notNull(),
    escopo: text('escopo').notNull().default('unidade'),
    /** M02: permissoes temporarias expiram automaticamente. */
    validoAte: timestamp('valido_ate', { withTimezone: true }),
    motivo: text('motivo'),
    concedidoPor: uuid('concedido_por').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_permissao_individual').on(t.usuarioId, t.permissao),
    index('idx_permissao_individual_usuario').on(t.tenantId, t.usuarioId),
  ],
);

/**
 * M02: assinatura profissional, pessoal e intransferivel.
 * Assinatura expirada ou inativa bloqueia a liberacao do laudo.
 */
export const assinaturaProfissional = pgTable(
  'assinatura_profissional',
  {
    ...colunasTenant,
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    /** eletronica | digital_certificado */
    tipo: text('tipo').notNull().default('eletronica'),
    /** Conselho profissional e registro exibidos no laudo. */
    identificacaoProfissional: text('identificacao_profissional').notNull(),
    /** Representacao grafica (caminho no storage), quando houver. */
    representacaoGrafica: text('representacao_grafica'),
    validoDe: timestamp('valido_de', { withTimezone: true }).notNull().defaultNow(),
    validoAte: timestamp('valido_ate', { withTimezone: true }),
    ativa: boolean('ativa').notNull().default(true),
    ...colunasTempo,
  },
  (t) => [index('idx_assinatura_usuario').on(t.tenantId, t.usuarioId)],
);

/**
 * Sessao server-side (Blueprint secao 6).
 *
 * O token nunca vai para o JavaScript do cliente: o cookie e httpOnly e guarda
 * apenas o id da sessao. O que se guarda aqui e o HASH do token, para que um
 * vazamento do banco nao permita sequestrar sessoes.
 */
export const sessao = pgTable(
  'sessao',
  {
    ...colunasTenant,
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /** Unidade ativa da sessao, quando o usuario atua em mais de uma. */
    unidadeAtivaId: uuid('unidade_ativa_id').references(() => unidade.id),
    ip: text('ip'),
    userAgent: text('user_agent'),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    /** Revogacao imediata em logout ou troca de senha. */
    revogadaEm: timestamp('revogada_em', { withTimezone: true }),
    ultimoUsoEm: timestamp('ultimo_uso_em', { withTimezone: true }).notNull().defaultNow(),
    /** MFA ja validado nesta sessao. */
    mfaValidado: boolean('mfa_validado').notNull().default(false),
    ...colunasTempo,
  },
  (t) => [
    index('idx_sessao_usuario').on(t.tenantId, t.usuarioId),
    index('idx_sessao_token').on(t.tokenHash),
  ],
);

export const usuarioRelations = relations(usuario, ({ many, one }) => ({
  perfis: many(usuarioPerfil),
  unidades: many(usuarioUnidade),
  permissoesIndividuais: many(permissaoIndividual),
  assinaturas: many(assinaturaProfissional),
  unidadePrincipal: one(unidade, {
    fields: [usuario.unidadePrincipalId],
    references: [unidade.id],
  }),
}));

export const perfilRelations = relations(perfil, ({ many }) => ({
  permissoes: many(perfilPermissao),
  usuarios: many(usuarioPerfil),
}));

export const perfilPermissaoRelations = relations(perfilPermissao, ({ one }) => ({
  perfil: one(perfil, { fields: [perfilPermissao.perfilId], references: [perfil.id] }),
}));

export const usuarioPerfilRelations = relations(usuarioPerfil, ({ one }) => ({
  usuario: one(usuario, { fields: [usuarioPerfil.usuarioId], references: [usuario.id] }),
  perfil: one(perfil, { fields: [usuarioPerfil.perfilId], references: [perfil.id] }),
}));

export const usuarioUnidadeRelations = relations(usuarioUnidade, ({ one }) => ({
  usuario: one(usuario, { fields: [usuarioUnidade.usuarioId], references: [usuario.id] }),
  unidade: one(unidade, { fields: [usuarioUnidade.unidadeId], references: [unidade.id] }),
}));
