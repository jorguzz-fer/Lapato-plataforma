import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  canalOrigemLogisticoEnum,
  colunasTempo,
  colunasTenant,
  conservacaoLogisticaEnum,
  motivoNaoRealizacaoEnum,
  prioridadeLogisticaEnum,
  requisitoEspecialLogisticoEnum,
  statusOfertaEnum,
  statusSolicitacaoLogisticaEnum,
  tipoOperacaoLogisticaEnum,
  tipoServicoLogisticoEnum,
} from './_comum.js';
import { caso } from './caso.js';
import { cliente } from './clientes.js';
import { usuario } from './identidade.js';
import { unidade } from './tenancy.js';

/**
 * M19 - Logistica.
 *
 * O modulo e dono da EXECUCAO FISICA do deslocamento entre o ambiente externo e
 * o laboratorio (secao 3). O que ele deliberadamente NAO tem, porque a secao
 * 131 lista uma por uma: cadastro mestre de cliente, cadastro de exame, triagem
 * tecnica, controle de blocos arquivados, calculo financeiro, notificacao
 * propria e cadastro paralelo de usuario.
 *
 * Por isso nao ha tabela de motorista aqui. A identidade do encarregado vem do
 * M02 (secao 34): o que existe e um vinculo operacional, nao uma segunda conta.
 */

/**
 * A solicitacao logistica.
 *
 * Um registro unico por operacao, qualquer que tenha sido o canal de entrada
 * (secao 4). Um pedido que chega por WhatsApp e o mesmo dado que um pedido do
 * Portal - muda o `canalOrigem`, nao a tabela. A secao 6 e categorica: "o
 * WhatsApp nao devera constituir o historico oficial da operacao".
 */
export const solicitacaoLogistica = pgTable(
  'solicitacao_logistica',
  {
    ...colunasTenant,
    /** Secao 12: numero unico, que acompanha a operacao ate o encerramento. */
    identificador: text('identificador').notNull(),

    /**
     * Secao 136: o sentido do deslocamento decide origem, destino, os botoes
     * que o encarregado ve e as evidencias exigidas. Nao e um rotulo.
     */
    tipoServico: tipoServicoLogisticoEnum('tipo_servico').notNull(),
    tipoOperacao: tipoOperacaoLogisticaEnum('tipo_operacao').notNull(),
    canalOrigem: canalOrigemLogisticoEnum('canal_origem').notNull(),

    // --- De quem e para onde (secao 13) -------------------------------------
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => cliente.id),
    unidadeId: uuid('unidade_id').references(() => unidade.id),
    /**
     * Secao 81: a coleta pode nascer de uma pre-solicitacao de exame. O vinculo
     * e opcional porque a maior parte das coletas acontece antes de existir
     * caso - e o caso so nasce no recebimento (M05).
     */
    casoId: uuid('caso_id').references(() => caso.id),

    /**
     * Endereco COPIADO, nao referenciado.
     *
     * Secao 15: a coleta pode ocorrer em endereco excepcional, e isso "nao
     * devera alterar silenciosamente o cadastro mestre do cliente". Guardar
     * apenas um `endereco_id` faria a operacao de ontem mudar de lugar quando
     * alguem corrigisse o cadastro hoje - e o historico logistico precisa dizer
     * onde o encarregado esteve, nao onde o cliente mora agora.
     */
    endereco: text('endereco').notNull(),
    pontoReferencia: text('ponto_referencia'),
    /** Secao 16: apoio ao planejamento; nao substitui o endereco textual. */
    latitude: text('latitude'),
    longitude: text('longitude'),

    /** Secao 17: quem entrega o material ao encarregado, no local. */
    contatoNoLocal: text('contato_no_local'),
    telefoneContato: text('telefone_contato'),

    // --- Quando (secoes 18 e 13) --------------------------------------------
    dataDesejada: timestamp('data_desejada', { withTimezone: true }),
    /**
     * Secao 18: a janela e considerada no planejamento e "sem constituir
     * promessa automatica antes da confirmacao" - por isso ela e um dado da
     * solicitacao, e nao um compromisso derivado do status.
     */
    janelaInicio: text('janela_inicio'),
    janelaFim: text('janela_fim'),

    // --- O que (secoes 19 a 21) ---------------------------------------------
    /** Secao 19: ESTIMADA. A quantidade real e conferida no local (secao 59). */
    volumesEstimados: integer('volumes_estimados'),
    tipoMaterial: text('tipo_material'),
    conservacao: conservacaoLogisticaEnum('conservacao'),
    /** Secao 71: sinalizacoes que mudam como o encarregado trata a carga. */
    requisitosEspeciais: requisitoEspecialLogisticoEnum('requisitos_especiais')
      .array()
      .notNull()
      .default([]),

    prioridade: prioridadeLogisticaEnum('prioridade').notNull().default('rotina'),
    observacoes: text('observacoes'),

    status: statusSolicitacaoLogisticaEnum('status').notNull().default('recebida'),

    // --- Execucao ------------------------------------------------------------
    /**
     * O encarregado que assumiu. Nulo ate o aceite - e e essa nulidade que
     * sustenta o aceite competitivo da secao 144: o primeiro UPDATE que
     * encontrar a coluna vazia leva o servico.
     */
    encarregadoId: uuid('encarregado_id').references(() => usuario.id),
    aceitaEm: timestamp('aceita_em', { withTimezone: true }),

    /**
     * Secao 148: valor mostrado ao encarregado ANTES do aceite.
     *
     * Fica aqui como valor aplicado, nao calculado: "a regra de calculo e o
     * pagamento definitivo pertencem ao Modulo 20 - Financeiro; o Modulo 19
     * devera apenas exibir o valor aplicavel e gerar o evento de producao apos
     * conclusao". Guardado em centavos, para nao arredondar dinheiro em ponto
     * flutuante.
     */
    valorCentavos: integer('valor_centavos'),

    // --- Desfecho (secoes 82 a 86) -------------------------------------------
    concluidaEm: timestamp('concluida_em', { withTimezone: true }),
    /** Secao 83: em NAO REALIZADA o motivo e obrigatorio - regra da aplicacao. */
    motivoNaoRealizacao: motivoNaoRealizacaoEnum('motivo_nao_realizacao'),
    detalheNaoRealizacao: text('detalhe_nao_realizacao'),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    canceladaPorId: uuid('cancelada_por_id').references(() => usuario.id),
    motivoCancelamento: text('motivo_cancelamento'),

    /**
     * Secao 85: reagendar NAO apaga a tentativa anterior. A nova solicitacao
     * aponta para a que nao deu certo, e as duas continuam existindo.
     */
    reagendamentoDeId: uuid('reagendamento_de_id'),

    criadaPorId: uuid('criada_por_id').references(() => usuario.id),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_solicitacao_logistica_identificador').on(t.tenantId, t.identificador),
    index('idx_logistica_status').on(t.tenantId, t.status),
    index('idx_logistica_cliente').on(t.tenantId, t.clienteId),
    index('idx_logistica_encarregado').on(t.tenantId, t.encarregadoId),
    index('idx_logistica_data').on(t.tenantId, t.dataDesejada),
  ],
);

/**
 * A oferta enviada a UM encarregado (secoes 140 a 147).
 *
 * Uma linha por convidado, e nao uma lista dentro da solicitacao. A diferenca
 * importa: com linhas separadas o sistema sabe quem recusou, quem aceitou e
 * quem simplesmente nao respondeu - que e a distincao entre um encarregado
 * indisponivel e um que nao viu a mensagem. Numa lista, os tres viram o mesmo
 * silencio.
 */
export const ofertaServico = pgTable(
  'oferta_servico',
  {
    ...colunasTenant,
    solicitacaoId: uuid('solicitacao_id')
      .notNull()
      .references(() => solicitacaoLogistica.id, { onDelete: 'cascade' }),
    encarregadoId: uuid('encarregado_id')
      .notNull()
      .references(() => usuario.id),

    status: statusOfertaEnum('status').notNull().default('enviada'),

    enviadaEm: timestamp('enviada_em', { withTimezone: true }).notNull().defaultNow(),
    /** Secao 146: sem aceite ate aqui, a solicitacao volta para a fila. */
    expiraEm: timestamp('expira_em', { withTimezone: true }),
    respondidaEm: timestamp('respondida_em', { withTimezone: true }),
    /** Secao 147: a recusa pode registrar motivo, e nao impede os demais. */
    motivoRecusa: text('motivo_recusa'),

    ...colunasTempo,
  },
  (t) => [
    /**
     * Um encarregado nao recebe a mesma oferta duas vezes. Sem isto, clicar
     * duas vezes em ENVIAR OFERTA duplicaria a mensagem e, pior, criaria duas
     * linhas concorrendo pelo mesmo aceite.
     */
    unique('uq_oferta_solicitacao_encarregado').on(t.solicitacaoId, t.encarregadoId),
    index('idx_oferta_encarregado').on(t.tenantId, t.encarregadoId, t.status),
    index('idx_oferta_solicitacao').on(t.tenantId, t.solicitacaoId),
  ],
);

/**
 * A linha do tempo da operacao (secao 88), append-only.
 *
 * Mesmo padrao do M15 e do M18: o status da solicitacao diz onde ela esta
 * AGORA; esta tabela diz como ela chegou ate ai. A secao 113 exige valor
 * anterior e valor novo nas alteracoes relevantes, e a secao 166 proibe que o
 * arquivamento "apague ou condense evidencias necessarias a auditoria".
 */
export const movimentacaoLogistica = pgTable(
  'movimentacao_logistica',
  {
    ...colunasTenant,
    solicitacaoId: uuid('solicitacao_id')
      .notNull()
      .references(() => solicitacaoLogistica.id, { onDelete: 'cascade' }),

    /** O que aconteceu: `criada`, `oferta_enviada`, `aceita`, `recusada`... */
    tipo: text('tipo').notNull(),
    statusAnterior: statusSolicitacaoLogisticaEnum('status_anterior'),
    statusNovo: statusSolicitacaoLogisticaEnum('status_novo'),

    /**
     * Secao 89: nem todo evento vai para o Portal. Planejamento interno,
     * reatribuicao e ocorrencia sensivel ficam de dentro de casa.
     */
    visivelPortal: boolean('visivel_portal').notNull().default(false),

    descricao: text('descricao'),
    /** Detalhe estruturado do evento - volumes conferidos, coordenadas, motivo. */
    detalhe: jsonb('detalhe').$type<Record<string, unknown>>().notNull().default({}),

    ocorridoEm: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
    responsavelId: uuid('responsavel_id').references(() => usuario.id),

    ...colunasTempo,
  },
  (t) => [
    index('idx_movimentacao_logistica').on(t.tenantId, t.solicitacaoId, t.ocorridoEm),
  ],
);

export const solicitacaoLogisticaRelations = relations(
  solicitacaoLogistica,
  ({ one, many }) => ({
    cliente: one(cliente, {
      fields: [solicitacaoLogistica.clienteId],
      references: [cliente.id],
    }),
    caso: one(caso, { fields: [solicitacaoLogistica.casoId], references: [caso.id] }),
    encarregado: one(usuario, {
      fields: [solicitacaoLogistica.encarregadoId],
      references: [usuario.id],
    }),
    ofertas: many(ofertaServico),
    movimentacoes: many(movimentacaoLogistica),
  }),
);

export const ofertaServicoRelations = relations(ofertaServico, ({ one }) => ({
  solicitacao: one(solicitacaoLogistica, {
    fields: [ofertaServico.solicitacaoId],
    references: [solicitacaoLogistica.id],
  }),
  encarregado: one(usuario, {
    fields: [ofertaServico.encarregadoId],
    references: [usuario.id],
  }),
}));

export const movimentacaoLogisticaRelations = relations(movimentacaoLogistica, ({ one }) => ({
  solicitacao: one(solicitacaoLogistica, {
    fields: [movimentacaoLogistica.solicitacaoId],
    references: [solicitacaoLogistica.id],
  }),
}));
