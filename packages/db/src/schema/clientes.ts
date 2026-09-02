import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  colunasInativacao,
  colunasTempo,
  colunasTenant,
  statusClienteEnum,
  tipoClienteEnum,
} from './_comum.js';
import { tabelaPreco } from './precos.js';

/**
 * M03 - Cadastro de Clientes e Veterinarios.
 *
 * Fonte unica de verdade dos dados cadastrais. DIRETRIZES secao 3: o endereco de
 * uma clinica pertence ao M03; Logistica, Financeiro e Portal apenas CONSULTAM.
 * Nenhum deles guarda copia.
 *
 * M03: cliente e veterinario com exames anteriores NUNCA sao excluidos - apenas
 * inativados.
 */

export const cliente = pgTable(
  'cliente',
  {
    ...colunasTenant,
    nomeFantasia: text('nome_fantasia').notNull(),
    razaoSocial: text('razao_social'),
    /** CNPJ ou CPF conforme o tipo. */
    documento: text('documento'),
    tipo: tipoClienteEnum('tipo').notNull(),
    status: statusClienteEnum('status').notNull().default('ativo'),

    /**
     * M03: codigo do cliente, usado na composicao do identificador do exame
     * conforme a mascara do M01 (ex.: 'CV' em `CV-000342/26`).
     */
    codigo: text('codigo').notNull(),
    nomeAbreviado: text('nome_abreviado'),

    /** M03: interno | pre_cadastro | indicacao | importacao | integracao */
    origem: text('origem').notNull().default('interno'),

    /**
     * Aponta para o cliente que absorveu este registro numa fusao. M03: a fusao
     * preserva o historico e redireciona as referencias - nenhum caso antigo
     * perde vinculo.
     */
    fundidoEmId: uuid('fundido_em_id'),

    /**
     * M20: tabela de precos que o cliente segue (Laboratorio, Clinica,
     * Hospital...). Nulo = valor padrao do servico. O acordo individual em
     * `preco_cliente` vence a tabela.
     */
    tabelaPrecoId: uuid('tabela_preco_id').references(() => tabelaPreco.id, {
      onDelete: 'set null',
    }),

    observacoes: text('observacoes'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_cliente_codigo').on(t.tenantId, t.codigo),
    index('idx_cliente_tenant').on(t.tenantId),
    index('idx_cliente_documento').on(t.tenantId, t.documento),
    index('idx_cliente_nome').on(t.tenantId, t.nomeFantasia),
  ],
);

/** M03: multiplos enderecos tipados por cliente (sede, coleta, fiscal, cobranca). */
export const clienteEndereco = pgTable(
  'cliente_endereco',
  {
    ...colunasTenant,
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    cep: text('cep'),
    logradouro: text('logradouro'),
    numero: text('numero'),
    complemento: text('complemento'),
    bairro: text('bairro'),
    municipio: text('municipio'),
    estado: text('estado'),
    pais: text('pais').notNull().default('BR'),
    /** Endereco usado por padrao para coleta (consumido pelo M19). */
    padraoColeta: boolean('padrao_coleta').notNull().default(false),
    /** Endereco usado por padrao para faturamento (consumido pelo M20). */
    padraoFaturamento: boolean('padrao_faturamento').notNull().default(false),
    ...colunasTempo,
  },
  (t) => [index('idx_cliente_endereco').on(t.tenantId, t.clienteId)],
);

export const clienteContato = pgTable(
  'cliente_contato',
  {
    ...colunasTenant,
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    cargo: text('cargo'),
    email: text('email'),
    telefone: text('telefone'),
    whatsapp: text('whatsapp'),
    /** email | whatsapp | telefone */
    canalPreferencial: text('canal_preferencial'),
    ...colunasTempo,
  },
  (t) => [index('idx_cliente_contato').on(t.tenantId, t.clienteId)],
);

/**
 * M03: o veterinario e pessoa UNICA com N vinculos.
 *
 * Regra explicita do modulo: nunca recadastrar o mesmo profissional uma vez por
 * clinica. O vinculo e que muda, nao a pessoa.
 */
export const veterinario = pgTable(
  'veterinario',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    crmv: text('crmv'),
    crmvUf: text('crmv_uf'),
    email: text('email'),
    telefone: text('telefone'),
    especialidade: text('especialidade'),
    /** M03: data da ultima conferencia do registro em base externa. */
    crmvConferidoEm: date('crmv_conferido_em'),
    status: text('status').notNull().default('ativo'),
    fundidoEmId: uuid('fundido_em_id'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    unique('uq_veterinario_crmv').on(t.tenantId, t.crmv, t.crmvUf),
    index('idx_veterinario_tenant').on(t.tenantId),
    index('idx_veterinario_nome').on(t.tenantId, t.nome),
  ],
);

/** M03: vinculo do profissional com uma instituicao cliente. */
export const vinculoVeterinarioCliente = pgTable(
  'vinculo_veterinario_cliente',
  {
    ...colunasTenant,
    veterinarioId: uuid('veterinario_id')
      .notNull()
      .references(() => veterinario.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    cargo: text('cargo'),
    /** Profissional de referencia daquele cliente. */
    principal: boolean('principal').notNull().default(false),
    recebeLaudo: boolean('recebe_laudo').notNull().default(true),
    recebeNotificacoes: boolean('recebe_notificacoes').notNull().default(true),
    podeSolicitarExames: boolean('pode_solicitar_exames').notNull().default(true),
    inicioEm: date('inicio_em'),
    /** M03: encerrar o vinculo nao apaga o historico. */
    terminoEm: date('termino_em'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_vinculo_vet_cliente').on(t.veterinarioId, t.clienteId),
    index('idx_vinculo_cliente').on(t.tenantId, t.clienteId),
    index('idx_vinculo_veterinario').on(t.tenantId, t.veterinarioId),
  ],
);

/** M05: tutor do animal. Dado pessoal - ver docs/dados-pessoais.md. */
export const tutor = pgTable(
  'tutor',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    /** Opcional por minimizacao (LGPD). */
    documento: text('documento'),
    email: text('email'),
    telefone: text('telefone'),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    index('idx_tutor_tenant').on(t.tenantId),
    index('idx_tutor_nome').on(t.tenantId, t.nome),
  ],
);

/**
 * M05: o paciente e entidade LONGITUDINAL e persistente - nao pertence a um
 * caso. E o que permite a Memoria do Paciente do M17 reunir exames, diagnosticos
 * e imagens anteriores do mesmo animal.
 */
export const paciente = pgTable(
  'paciente',
  {
    ...colunasTenant,
    nome: text('nome').notNull(),
    tutorId: uuid('tutor_id').references(() => tutor.id),
    /** Referencia a termo da tabela mestre 'especie'. */
    especieId: uuid('especie_id'),
    racaId: uuid('raca_id'),
    sexo: text('sexo'),
    condicaoReprodutiva: text('condicao_reprodutiva'),
    dataNascimento: date('data_nascimento'),
    /** Quando a data exata e desconhecida, mas a idade foi informada. */
    idadeInformada: text('idade_informada'),
    pelagem: text('pelagem'),
    /**
     * M05: identificador de alta relevancia. O mesmo microchip em outro paciente
     * ativo e tratado como problema de identidade pelo Guardian.
     */
    microchip: text('microchip'),
    identificacaoAlternativa: text('identificacao_alternativa'),
    obito: boolean('obito').notNull().default(false),
    dataObito: timestamp('data_obito', { withTimezone: true }),
    ...colunasTempo,
    ...colunasInativacao,
  },
  (t) => [
    index('idx_paciente_tenant').on(t.tenantId),
    index('idx_paciente_microchip').on(t.tenantId, t.microchip),
    index('idx_paciente_tutor').on(t.tenantId, t.tutorId),
    index('idx_paciente_nome').on(t.tenantId, t.nome),
  ],
);

export const clienteRelations = relations(cliente, ({ many }) => ({
  enderecos: many(clienteEndereco),
  contatos: many(clienteContato),
  vinculos: many(vinculoVeterinarioCliente),
}));

export const veterinarioRelations = relations(veterinario, ({ many }) => ({
  vinculos: many(vinculoVeterinarioCliente),
}));

export const vinculoRelations = relations(vinculoVeterinarioCliente, ({ one }) => ({
  veterinario: one(veterinario, {
    fields: [vinculoVeterinarioCliente.veterinarioId],
    references: [veterinario.id],
  }),
  cliente: one(cliente, {
    fields: [vinculoVeterinarioCliente.clienteId],
    references: [cliente.id],
  }),
}));

export const pacienteRelations = relations(paciente, ({ one }) => ({
  tutor: one(tutor, { fields: [paciente.tutorId], references: [tutor.id] }),
}));
