import { relations } from 'drizzle-orm';
import { index, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { colunasInativacao, colunasTempo, colunasTenant } from './_comum.js';
import { servico } from './configuracao.js';

/**
 * M20 - tabelas de preco nomeadas.
 *
 * Segunda review (Roberta): "os servicos sao os mesmos, so varia o valor -
 * se ele for laboratorio e um valor, clinica e outro, hospital veterinario e
 * outro". Preco fechado, nao percentual. Em vez de digitar o catalogo inteiro
 * cliente a cliente, a instituicao mantem poucas tabelas (Laboratorio,
 * Clinica, Hospital...) e cada cliente aponta para uma - e o "convenio ou
 * valor normal" do sistema que o Hugo mostrou.
 *
 * Ordem de resolucao do preco de um item de OS: acordo individual do cliente
 * (`preco_cliente`) > tabela do cliente > valor padrao do servico. O acordo
 * segue existindo para a excecao ("o Alem tem uma tabela super diferenciada").
 *
 * M01: inativa-se, nunca se exclui - uma tabela usada por clientes some da
 * escolha, nao do historico.
 */
export const tabelaPreco = pgTable(
  'tabela_preco',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [unique('uq_tabela_preco_nome').on(t.tenantId, t.nome)],
);

export const itemTabelaPreco = pgTable(
  'item_tabela_preco',
  {
    ...colunasTenant,
    tabelaId: uuid('tabela_id')
      .notNull()
      .references(() => tabelaPreco.id, { onDelete: 'cascade' }),
    servicoId: uuid('servico_id')
      .notNull()
      .references(() => servico.id, { onDelete: 'cascade' }),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_item_tabela_preco').on(t.tenantId, t.tabelaId, t.servicoId),
    index('idx_item_tabela_preco').on(t.tenantId, t.tabelaId),
  ],
);

export const tabelaPrecoRelations = relations(tabelaPreco, ({ many }) => ({
  itens: many(itemTabelaPreco),
}));

export const itemTabelaPrecoRelations = relations(itemTabelaPreco, ({ one }) => ({
  tabela: one(tabelaPreco, { fields: [itemTabelaPreco.tabelaId], references: [tabelaPreco.id] }),
  servico: one(servico, { fields: [itemTabelaPreco.servicoId], references: [servico.id] }),
}));
