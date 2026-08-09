import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { colunasTenant } from './_comum.js';

/**
 * Trilha de auditoria imutavel.
 *
 * DIRETRIZES secao 10: "todos os modulos deverao gerar eventos auditaveis. (...)
 * cada modulo devera registrar seus eventos, mas nao devera implementar um
 * sistema independente de auditoria."
 *
 * Introducao secao 6.6 lista o que a auditoria precisa responder:
 *   quem criou, quem alterou, qual conteudo, quando, valor anterior, valor novo,
 *   por que (quando exigido), e **se houve edicao apos validacao, assinatura ou
 *   liberacao**.
 *
 * Diferenca para `evento_dominio`: o evento e o FATO DE NEGOCIO (interessa ao
 * fluxo e a linha do tempo); o audit_log e o RASTRO TECNICO da alteracao de
 * dado (interessa a conformidade). Um laudo liberado gera evento; alterar o
 * telefone de um cliente gera audit_log.
 *
 * Imutabilidade imposta por trigger na migration de RLS: UPDATE e DELETE
 * levantam excecao.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    ...colunasTenant,
    /** Tabela alterada. */
    entidade: text('entidade').notNull(),
    entidadeId: uuid('entidade_id').notNull(),
    /** criar | atualizar | inativar | acessar | exportar | imprimir */
    acao: text('acao').notNull(),
    usuarioId: uuid('usuario_id'),
    unidadeId: uuid('unidade_id'),
    casoId: uuid('caso_id'),
    /** Apenas os campos que mudaram, com valor anterior e novo. */
    valorAnterior: jsonb('valor_anterior').$type<Record<string, unknown>>(),
    valorNovo: jsonb('valor_novo').$type<Record<string, unknown>>(),
    /** M05/M11: alteracoes criticas exigem justificativa. */
    justificativa: text('justificativa'),
    /**
     * Marca alteracao feita DEPOIS de validacao, assinatura ou liberacao -
     * exatamente o caso que a Introducao secao 6.6 manda destacar.
     */
    aposValidacao: text('apos_validacao'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Correlaciona com os logs estruturados (Blueprint secao 11). */
    requestId: text('request_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_entidade').on(t.tenantId, t.entidade, t.entidadeId),
    index('idx_audit_usuario').on(t.tenantId, t.usuarioId),
    index('idx_audit_caso').on(t.tenantId, t.casoId),
    index('idx_audit_criado').on(t.tenantId, t.criadoEm),
  ],
);
