/**
 * M15 - Controle de Cadaveres.
 *
 * O modulo e o proprietario da **localizacao fisica e do ciclo de custodia
 * operacional** do cadaver (secao 3): identificacao, armazenamento,
 * movimentacoes, bloqueios, liberacao, retirada e destinacao.
 *
 * O que NAO pertence a ele, e por isso nao aparece neste vocabulario: o exame
 * necroscopico, a descricao de lesoes, a causa mortis, a cobranca e o
 * transporte externo. Cada um tem seu modulo.
 */

/**
 * Estados do cadaver (secao 22).
 *
 * O ponto que a documentacao repete duas vezes (secoes 43 e 88): **liberado e
 * retirado sao estados distintos**. "Liberado" e uma decisao do laboratorio -
 * pode ser entregue; "retirado" e um fato fisico - deixou o predio. Colapsar os
 * dois faz o laboratorio perder o controle de quem ainda esta la dentro.
 *
 * `bloqueado` nao esta aqui de proposito: bloqueio e ortogonal ao estado
 * (secao 31). Um cadaver armazenado pode estar bloqueado, e continuar
 * armazenado - o bloqueio impede a saida, nao muda onde ele esta.
 */
export const STATUS_CADAVER = [
  /** Chegada prevista, posicao pode estar reservada (secao 21). */
  'aguardando_recebimento',
  /** Recebido fisicamente, ainda sem posicao definida. */
  'recebido',
  'armazenado',
  'aguardando_necropsia',
  /** Fora do armazenamento, na sala de necropsia (secoes 26 e 29). */
  'em_necropsia',
  'aguardando_liberacao',
  /** Pode ser entregue. Ainda esta no laboratorio (secao 43). */
  'liberado',
  /** Deixou fisicamente o laboratorio (secao 43). */
  'retirado',
  /** Destinacao confirmada e encerrada (secao 49). */
  'destinado',
] as const;
export type StatusCadaver = (typeof STATUS_CADAVER)[number];

export const STATUS_CADAVER_LABEL: Record<StatusCadaver, string> = {
  aguardando_recebimento: 'Aguardando recebimento',
  recebido: 'Recebido',
  armazenado: 'Armazenado',
  aguardando_necropsia: 'Aguardando necropsia',
  em_necropsia: 'Em necropsia',
  aguardando_liberacao: 'Aguardando liberação',
  liberado: 'Liberado',
  retirado: 'Retirado',
  destinado: 'Destinado',
};

/** Estados em que o cadaver ocupa uma posicao fisica no armazenamento. */
export const STATUS_QUE_OCUPAM_POSICAO: StatusCadaver[] = [
  'armazenado',
  'aguardando_necropsia',
  'aguardando_liberacao',
  'liberado',
];

/**
 * Metodo de conservacao (secao 15).
 *
 * Muda ao longo do tempo, e por isso nao e so um campo: cada mudanca vira
 * movimentacao, e a sequencia delas reconstroi o historico termico (secao 16).
 */
export const CONSERVACAO_CADAVER = [
  'refrigerado',
  'congelado',
  'temperatura_ambiente',
  'outro',
  'nao_informado',
] as const;
export type ConservacaoCadaver = (typeof CONSERVACAO_CADAVER)[number];

export const CONSERVACAO_CADAVER_LABEL: Record<ConservacaoCadaver, string> = {
  refrigerado: 'Refrigerado',
  congelado: 'Congelado',
  temperatura_ambiente: 'Temperatura ambiente',
  outro: 'Outro',
  nao_informado: 'Não informado',
};

/** Condicoes de recebimento (secao 12). */
export const EMBALAGEM_CADAVER = [
  'saco_plastico',
  'saco_cadaverico',
  'caixa',
  'recipiente_rigido',
  'embalagem_dupla',
  'outra',
] as const;
export type EmbalagemCadaver = (typeof EMBALAGEM_CADAVER)[number];

export const INTEGRIDADE_CADAVER = [
  'integra',
  'rompida',
  'vazamento',
  'sujidade_externa',
  'inadequada',
] as const;
export type IntegridadeCadaver = (typeof INTEGRIDADE_CADAVER)[number];

export const IDENTIFICACAO_EXTERNA = [
  'presente',
  'ausente',
  'incompleta',
  'divergente',
] as const;
export type IdentificacaoExterna = (typeof IDENTIFICACAO_EXTERNA)[number];

/**
 * Tipos de movimentacao (secao 23).
 *
 * Toda mudanca fisica gera um evento. A tabela e append-only: o historico do
 * cadaver e a prova de onde ele esteve, e correcao entra como novo registro
 * com justificativa, nunca como edicao do anterior (secoes 65-67 e 88).
 */
export const TIPO_MOVIMENTACAO_CADAVER = [
  'recebimento',
  'armazenamento',
  'transferencia',
  'retirada_necropsia',
  'retorno_necropsia',
  'mudanca_conservacao',
  'saida_fisica',
  'correcao',
] as const;
export type TipoMovimentacaoCadaver = (typeof TIPO_MOVIMENTACAO_CADAVER)[number];

export const TIPO_MOVIMENTACAO_CADAVER_LABEL: Record<TipoMovimentacaoCadaver, string> = {
  recebimento: 'Recebimento',
  armazenamento: 'Armazenamento',
  transferencia: 'Transferência',
  retirada_necropsia: 'Retirada para necropsia',
  retorno_necropsia: 'Retorno da necropsia',
  mudanca_conservacao: 'Mudança de conservação',
  saida_fisica: 'Saída física',
  correcao: 'Correção',
};

/** Bloqueios (secao 31). Impedem a saida, nao a permanencia. */
export const TIPO_BLOQUEIO_CADAVER = [
  'nao_liberar',
  'aguardar_exame_complementar',
  'aguardar_autorizacao',
  'caso_pericial',
  'documentacao_pendente',
  'retencao_tecnica',
  'retencao_legal',
  'outro',
] as const;
export type TipoBloqueioCadaver = (typeof TIPO_BLOQUEIO_CADAVER)[number];

export const TIPO_BLOQUEIO_CADAVER_LABEL: Record<TipoBloqueioCadaver, string> = {
  nao_liberar: 'Não liberar',
  aguardar_exame_complementar: 'Aguardar exame complementar',
  aguardar_autorizacao: 'Aguardar autorização',
  caso_pericial: 'Caso pericial',
  documentacao_pendente: 'Documentação pendente',
  retencao_tecnica: 'Retenção técnica',
  retencao_legal: 'Retenção legal',
  outro: 'Outro',
};

/** Destinacao autorizada (secao 40). */
export const DESTINACAO_CADAVER = [
  'retirada_responsavel',
  'cremacao_individual',
  'cremacao_coletiva',
  'destinacao_institucional',
  'outra',
] as const;
export type DestinacaoCadaver = (typeof DESTINACAO_CADAVER)[number];

export const DESTINACAO_CADAVER_LABEL: Record<DestinacaoCadaver, string> = {
  retirada_responsavel: 'Retirada pelo responsável',
  cremacao_individual: 'Cremação individual',
  cremacao_coletiva: 'Cremação coletiva',
  destinacao_institucional: 'Destinação institucional',
  outra: 'Outra',
};
