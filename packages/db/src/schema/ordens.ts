import { relations } from 'drizzle-orm';
import { index, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { colunasTempo, colunasTenant, statusOrdemServicoEnum } from './_comum.js';
import { caso } from './caso.js';
import { fatura } from './financeiro.js';
import { cliente } from './clientes.js';
import { servico } from './configuracao.js';
import { usuario } from './identidade.js';

/**
 * M20 (parcial) - Ordem de Servico e precos.
 *
 * O desenho veio da primeira review com o laboratorio, espelhando a rotina que
 * eles ja praticam em producao: a OS nasce quando o material foi conferido no
 * recebimento, atravessa o processo junto com o caso, e no final alguem
 * verifica se tudo que ela lista foi executado - conferiu, despachou, e so
 * entao ela pode ser faturada. E a OS, nao o caso, que carrega a cobranca.
 */

/**
 * Preco personalizado de um servico para um cliente (M01 secao 11 + review).
 *
 * "O mesmo servico pode ter precos diferentes para clientes diferentes -
 * acordos": a tabela padrao e o `valorPadrao` do servico; este registro e a
 * excecao negociada. Remover a linha devolve o cliente a tabela padrao.
 */
export const precoCliente = pgTable(
  'preco_cliente',
  {
    ...colunasTenant,
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    servicoId: uuid('servico_id')
      .notNull()
      .references(() => servico.id, { onDelete: 'cascade' }),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_preco_cliente').on(t.tenantId, t.clienteId, t.servicoId),
    index('idx_preco_cliente_cliente').on(t.tenantId, t.clienteId),
  ],
);

export const ordemServico = pgTable(
  'ordem_servico',
  {
    ...colunasTenant,
    /** `OS-2026-000123` - serie fiscal propria, continua, nunca reutilizada. */
    identificador: text('identificador').notNull(),
    /**
     * Uma OS por caso. A review foi explicita: "e a OS que roda todo o
     * processo" - servicos adicionais viram ITENS desta ordem, nunca uma
     * segunda ordem para o mesmo caso.
     */
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id, { onDelete: 'restrict' }),
    /**
     * Copiado do caso na criacao: a fatura e do cliente, e reatribuir o caso
     * a outro cliente depois nao pode mudar quem deve a ordem ja aberta.
     */
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id, { onDelete: 'restrict' }),

    status: statusOrdemServicoEnum('status').notNull().default('aberta'),
    observacoes: text('observacoes'),

    /**
     * Preenchido quando a OS entra numa fatura (status `faturada`). Cancelar
     * a fatura limpa o vinculo e devolve a OS a `despachada`.
     */
    faturaId: uuid('fatura_id').references(() => fatura.id, { onDelete: 'set null' }),

    conferidaEm: timestamp('conferida_em', { withTimezone: true }),
    conferidaPorId: uuid('conferida_por_id').references(() => usuario.id),
    despachadaEm: timestamp('despachada_em', { withTimezone: true }),
    despachadaPorId: uuid('despachada_por_id').references(() => usuario.id),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    /** Cancelamento sem motivo nao existe (mesma regra do M19 secao 86). */
    motivoCancelamento: text('motivo_cancelamento'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_ordem_identificador').on(t.tenantId, t.identificador),
    unique('uq_ordem_caso').on(t.tenantId, t.casoId),
    index('idx_ordem_status').on(t.tenantId, t.status),
    index('idx_ordem_cliente').on(t.tenantId, t.clienteId),
  ],
);

/**
 * Item da OS. `valorUnitario` e retrato do preco no momento em que o item
 * entrou (M01: alteracoes nao retroagem); o total nunca e gravado - e sempre
 * `quantidade x unitario x (1 - desconto)`, calculado na leitura, para nao
 * existir um numero armazenado que possa divergir das partes.
 */
export const itemOrdemServico = pgTable(
  'item_ordem_servico',
  {
    ...colunasTenant,
    ordemId: uuid('ordem_id')
      .notNull()
      .references(() => ordemServico.id, { onDelete: 'cascade' }),
    /** Nulo para item avulso descrito a mao (a review pediu criar na hora). */
    servicoId: uuid('servico_id').references(() => servico.id, { onDelete: 'set null' }),
    descricao: text('descricao').notNull(),
    quantidade: numeric('quantidade', { precision: 10, scale: 2 }).notNull().default('1'),
    valorUnitario: numeric('valor_unitario', { precision: 12, scale: 2 }).notNull(),
    descontoPercentual: numeric('desconto_percentual', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    ordem: integer('ordem').notNull().default(0),
    ...colunasTempo,
  },
  (t) => [index('idx_item_ordem').on(t.tenantId, t.ordemId)],
);

export const ordemServicoRelations = relations(ordemServico, ({ many, one }) => ({
  itens: many(itemOrdemServico),
  caso: one(caso, { fields: [ordemServico.casoId], references: [caso.id] }),
  cliente: one(cliente, { fields: [ordemServico.clienteId], references: [cliente.id] }),
}));

export const itemOrdemServicoRelations = relations(itemOrdemServico, ({ one }) => ({
  ordem: one(ordemServico, {
    fields: [itemOrdemServico.ordemId],
    references: [ordemServico.id],
  }),
}));
