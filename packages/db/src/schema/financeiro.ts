import { relations } from 'drizzle-orm';
import {
  date,
  index,
  integer,
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
  situacaoProducaoLogisticaEnum,
  statusFaturaEnum,
  tipoLancamentoEnum,
  tipoServicoLogisticoEnum,
} from './_comum.js';
import { cliente } from './clientes.js';
import { usuario } from './identidade.js';
import { solicitacaoLogistica } from './logistica.js';

/**
 * M20 (parcial) - Financeiro padrao: fatura e livro de lancamentos.
 *
 * A fatura agrupa Ordens de Servico DESPACHADAS de um cliente (a OS aponta
 * para ca via `ordem_servico.fatura_id`). O valor da fatura nunca e gravado:
 * e a soma dos itens das ordens, calculada na leitura - mesmo principio da
 * propria OS, um numero armazenado diverge das partes no primeiro esquecido.
 *
 * O livro de lancamentos e o "entrada e saida, fluxo de caixa" combinado na
 * review. Pagamento de fatura gera lancamento de ENTRADA automatico e
 * travado; o resto e manual.
 */
export const fatura = pgTable(
  'fatura',
  {
    ...colunasTenant,
    /** `FAT-2026-000045` - serie fiscal propria, continua, nunca reutilizada. */
    identificador: text('identificador').notNull(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id, { onDelete: 'restrict' }),
    status: statusFaturaEnum('status').notNull().default('aberta'),

    /** Vencimento entra na emissao; antes disso a fatura e um rascunho. */
    vencimento: date('vencimento'),
    emitidaEm: timestamp('emitida_em', { withTimezone: true }),
    emitidaPorId: uuid('emitida_por_id').references(() => usuario.id),
    pagaEm: timestamp('paga_em', { withTimezone: true }),
    /** O que de fato entrou - pode diferir do total (juros, abatimento). */
    valorPago: numeric('valor_pago', { precision: 12, scale: 2 }),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    motivoCancelamento: text('motivo_cancelamento'),
    observacoes: text('observacoes'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_fatura_identificador').on(t.tenantId, t.identificador),
    index('idx_fatura_status').on(t.tenantId, t.status),
    index('idx_fatura_cliente').on(t.tenantId, t.clienteId),
  ],
);

export const lancamentoFinanceiro = pgTable(
  'lancamento_financeiro',
  {
    ...colunasTenant,
    tipo: tipoLancamentoEnum('tipo').notNull(),
    /**
     * Texto livre de proposito: o financeiro real inventa categoria nova toda
     * semana, e um enum viraria migration a cada conversa. As sugestoes ficam
     * no shared (`CATEGORIAS_SUGERIDAS`).
     */
    categoria: text('categoria').notNull(),
    descricao: text('descricao').notNull(),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    /** Data de competencia do caixa - dia em que o dinheiro se moveu. */
    data: date('data').notNull(),
    /**
     * Preenchido quando o lancamento nasceu do pagamento de uma fatura.
     * Lancamento com fatura e AUTOMATICO e nao se edita nem se remove - quem
     * quiser mexer, mexe na fatura, e o espelho acompanha.
     */
    faturaId: uuid('fatura_id').references(() => fatura.id, { onDelete: 'restrict' }),
    criadoPorId: uuid('criado_por_id').references(() => usuario.id),
    ...colunasTempo,
  },
  (t) => [
    index('idx_lancamento_data').on(t.tenantId, t.data),
    index('idx_lancamento_fatura').on(t.tenantId, t.faturaId),
  ],
);

export const faturaRelations = relations(fatura, ({ one, many }) => ({
  cliente: one(cliente, { fields: [fatura.clienteId], references: [cliente.id] }),
  lancamentos: many(lancamentoFinanceiro),
}));

export const lancamentoRelations = relations(lancamentoFinanceiro, ({ one }) => ({
  fatura: one(fatura, {
    fields: [lancamentoFinanceiro.faturaId],
    references: [fatura.id],
  }),
}));

/**
 * Producao do encarregado (M19 secoes 159 a 164).
 *
 * A tabela mora no M20 porque a secao 148 e explicita: "a regra de calculo e o
 * pagamento definitivo pertencem ao Modulo 20". A Logistica gera o item ao
 * concluir o servico e depois so CONSULTA a situacao (secao 163).
 *
 * Um item por servico concluido - `solicitacao_id` unico. Servico cancelado
 * ou nao realizado nao gera item (secao 164); se o cancelamento vier depois da
 * conclusao, o item e marcado `cancelado`, nunca apagado.
 */
export const producaoLogistica = pgTable(
  'producao_logistica',
  {
    ...colunasTenant,
    solicitacaoId: uuid('solicitacao_id')
      .notNull()
      .references(() => solicitacaoLogistica.id, { onDelete: 'restrict' }),
    encarregadoId: uuid('encarregado_id')
      .notNull()
      .references(() => usuario.id),
    tipoServico: tipoServicoLogisticoEnum('tipo_servico').notNull(),
    concluidaEm: timestamp('concluida_em', { withTimezone: true }).notNull(),
    /** Valor APLICADO ao servico, copiado da solicitacao no momento da conclusao. */
    valorCentavos: integer('valor_centavos').notNull().default(0),
    situacao: situacaoProducaoLogisticaEnum('situacao').notNull().default('nao_lancado'),
    /** Referencia livre do fechamento ou do pagamento que o M20 registrar. */
    referenciaFinanceira: text('referencia_financeira'),
    pagaEm: timestamp('paga_em', { withTimezone: true }),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_producao_logistica_solicitacao').on(t.solicitacaoId),
    index('idx_producao_logistica_encarregado').on(t.tenantId, t.encarregadoId, t.concluidaEm),
    index('idx_producao_logistica_situacao').on(t.tenantId, t.situacao),
  ],
);

export const producaoLogisticaRelations = relations(producaoLogistica, ({ one }) => ({
  solicitacao: one(solicitacaoLogistica, {
    fields: [producaoLogistica.solicitacaoId],
    references: [solicitacaoLogistica.id],
  }),
  encarregado: one(usuario, {
    fields: [producaoLogistica.encarregadoId],
    references: [usuario.id],
  }),
}));
