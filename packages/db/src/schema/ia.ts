import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { colunasTempo, colunasTenant, nivelIaEnum } from './_comum.js';
import { caso } from './caso.js';
import { usuario } from './identidade.js';

/**
 * M17 - Inteligencia Artificial.
 *
 * M17 secao 3: este modulo NAO e proprietario de dados clinicos. Ele consulta,
 * compreende, relaciona, sugere e alerta - sem criar copias.
 *
 * O que ele possui: configuracoes, politicas e o **registro das sugestoes**.
 */

/**
 * Registro de cada sugestao ou alerta apresentado ao usuario.
 *
 * M17 secao 15 exige transparencia: toda sugestao indica que foi produzida pela
 * IA, quais dados usou, quais fontes consultou e se houve inferencia. M17 secao
 * 109 exige registrar o modelo e a versao utilizados.
 *
 * Serve tambem aos indicadores de desempenho do M17 (apresentadas, aceitas,
 * modificadas, rejeitadas) - que a documentacao ressalva serem para melhoria do
 * sistema, "nao para avaliacao individual simplista".
 */
export const sugestaoIa = pgTable(
  'sugestao_ia',
  {
    ...colunasTenant,
    casoId: uuid('caso_id').references(() => caso.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id').references(() => usuario.id),

    /** copiloto | guardian | memoria */
    componente: text('componente').notNull(),
    moduloContexto: text('modulo_contexto').notNull(),
    etapa: text('etapa'),

    nivel: nivelIaEnum('nivel').notNull(),
    /** Codigo estavel do achado, quando vem do Guardian. */
    codigo: text('codigo'),
    titulo: text('titulo').notNull(),
    corpo: text('corpo').notNull(),

    /** M17 secao 99: fontes consultadas, na hierarquia definida pelo modulo. */
    fontes: jsonb('fontes').$type<string[]>().notNull().default([]),
    /** M17: distingue inferencia de leitura direta de um dado observado. */
    inferencia: text('inferencia'),
    evidencias: jsonb('evidencias').$type<Record<string, unknown>>(),

    /** M17 secao 109: "o usuario nao devera precisar saber qual modelo", mas o sistema sabe. */
    modelo: text('modelo'),
    modeloVersao: text('modelo_versao'),

    /** M17 secao 15: o que o usuario fez com a sugestao. */
    acaoUsuario: text('acao_usuario'),
    acaoUsuarioEm: timestamp('acao_usuario_em', { withTimezone: true }),
    comentarioUsuario: text('comentario_usuario'),

    ...colunasTempo,
  },
  (t) => [
    index('idx_sugestao_caso').on(t.tenantId, t.casoId),
    index('idx_sugestao_componente').on(t.tenantId, t.componente),
    index('idx_sugestao_nivel').on(t.tenantId, t.nivel),
    index('idx_sugestao_codigo').on(t.tenantId, t.codigo),
  ],
);

/**
 * M17 secao 8 e secao 88: politica de IA da instituicao.
 *
 * Define onde a IA pode atuar, quais funcoes estao habilitadas, quais exigem
 * confirmacao e **quais estao proibidas**. O perfil de atuacao (conservador,
 * assistido, intensivo) tambem mora aqui.
 */
export const politicaIa = pgTable(
  'politica_ia',
  {
    ...colunasTenant,
    /** conservador | assistido | intensivo */
    perfilAtuacao: text('perfil_atuacao').notNull().default('conservador'),
    /** Modulos em que a IA pode atuar. */
    modulosHabilitados: jsonb('modulos_habilitados').$type<string[]>().notNull().default([]),
    /** Funcoes que exigem confirmacao explicita do usuario (M17 secao 14). */
    funcoesExigemConfirmacao: jsonb('funcoes_exigem_confirmacao')
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Funcoes proibidas por decisao institucional. */
    funcoesProibidas: jsonb('funcoes_proibidas').$type<string[]>().notNull().default([]),
    /**
     * M17 secao 97: dados clinicos NAO sao usados para treinamento sem regra
     * institucional e autorizacao. O padrao e false, e assim deve permanecer
     * ate haver politica escrita e DPA com o provedor.
     */
    permiteTreinamento: text('permite_treinamento').notNull().default('nao'),
    /** M17 secao 90: retencao das sugestoes; nem toda interacao fica para sempre. */
    retencaoSugestoesDias: text('retencao_sugestoes_dias'),
    ...colunasTempo,
  },
  (t) => [index('idx_politica_ia_tenant').on(t.tenantId)],
);
