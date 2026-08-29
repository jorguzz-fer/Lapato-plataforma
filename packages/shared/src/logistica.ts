/**
 * M19 - Logistica: vocabulario do deslocamento fisico dos materiais.
 *
 * O principio central da secao 1 do documento: "toda movimentacao logistica
 * devera possuir origem, destino, responsavel, status, horario e vinculo com a
 * solicitacao ou material correspondente".
 *
 * O modulo e dono da EXECUCAO FISICA entre o ponto de coleta e o destino
 * (secao 3). Ele nao cadastra cliente, nao cadastra exame, nao tria amostra e
 * nao calcula preco - cada uma dessas coisas tem outro dono, e a secao 131
 * lista explicitamente o que nao pode existir aqui.
 */

/**
 * Secao 136: retirada e entrega nao sao dois rotulos do mesmo servico.
 *
 * O sentido do deslocamento muda a origem, o destino, os botoes que o
 * encarregado ve e as evidencias exigidas em cada marco. Por isso a distincao
 * aparece ja na criacao da solicitacao, e nao como um campo de observacao.
 */
export const TIPO_SERVICO_LOGISTICO = ['retirada', 'entrega'] as const;
export type TipoServicoLogistico = (typeof TIPO_SERVICO_LOGISTICO)[number];

export const TIPO_SERVICO_LOGISTICO_LABEL: Record<TipoServicoLogistico, string> = {
  retirada: 'Retirada',
  entrega: 'Entrega',
};

/**
 * Secao 4: o pedido chega por muitos caminhos e vira UM registro no LAPATO.
 *
 * O canal fica gravado porque e informacao operacional real - saber que metade
 * das coletas ainda entra por WhatsApp e o que justifica investir no Portal.
 * O que o canal nao pode ser e um historico paralelo: a secao 6 e explicita,
 * "o WhatsApp nao devera constituir o historico oficial da operacao".
 */
export const CANAL_ORIGEM_LOGISTICO = [
  'portal',
  'telefone',
  'whatsapp',
  'presencial',
  'interna',
  'pre_solicitacao',
  'rotina_programada',
  'outro',
] as const;
export type CanalOrigemLogistico = (typeof CANAL_ORIGEM_LOGISTICO)[number];

export const CANAL_ORIGEM_LOGISTICO_LABEL: Record<CanalOrigemLogistico, string> = {
  portal: 'Portal do Cliente',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  presencial: 'Presencial',
  interna: 'Solicitação interna',
  pre_solicitacao: 'Pré-solicitação de exame',
  rotina_programada: 'Rotina programada',
  outro: 'Outro canal',
};

/** Secao 10: o que a operacao move. */
export const TIPO_OPERACAO_LOGISTICA = [
  'coleta_amostras',
  'retirada_cadaver',
  'entrega_recipientes',
  'retirada_blocos_laminas',
  'devolucao_material',
  'entrega_documentos',
  'transferencia_unidades',
  'outra',
] as const;
export type TipoOperacaoLogistica = (typeof TIPO_OPERACAO_LOGISTICA)[number];

export const TIPO_OPERACAO_LOGISTICA_LABEL: Record<TipoOperacaoLogistica, string> = {
  coleta_amostras: 'Coleta de amostras para exame',
  retirada_cadaver: 'Retirada de cadáver',
  entrega_recipientes: 'Entrega de recipientes ou kits',
  retirada_blocos_laminas: 'Retirada de blocos/lâminas',
  devolucao_material: 'Devolução de material',
  entrega_documentos: 'Entrega de documentos',
  transferencia_unidades: 'Transporte entre unidades',
  outra: 'Outra operação',
};

/**
 * Secao 11: prioridade LOGISTICA.
 *
 * O documento avisa que ela "nao devera ser confundida automaticamente com
 * prioridade diagnostica do exame" - por isso este enum e separado do
 * `PRIORIDADE` do caso, e nao um alias dele. Uma biopsia de rotina pode exigir
 * coleta urgente porque o cliente fecha as 12h; um caso urgente pode ter coleta
 * programada porque o material ja esta aqui.
 */
export const PRIORIDADE_LOGISTICA = [
  'rotina',
  'prioritaria',
  'urgente',
  'programada',
] as const;
export type PrioridadeLogistica = (typeof PRIORIDADE_LOGISTICA)[number];

export const PRIORIDADE_LOGISTICA_LABEL: Record<PrioridadeLogistica, string> = {
  rotina: 'Rotina',
  prioritaria: 'Prioritária',
  urgente: 'Urgente',
  programada: 'Programada',
};

/** Secao 21: condicao esperada de conservacao durante o transporte. */
export const CONSERVACAO_LOGISTICA = [
  'ambiente',
  'refrigerado',
  'congelado',
  'fixado',
  'sem_requisito',
  'outra',
] as const;
export type ConservacaoLogistica = (typeof CONSERVACAO_LOGISTICA)[number];

export const CONSERVACAO_LOGISTICA_LABEL: Record<ConservacaoLogistica, string> = {
  ambiente: 'Temperatura ambiente',
  refrigerado: 'Refrigerado',
  congelado: 'Congelado',
  fixado: 'Fixado',
  sem_requisito: 'Sem requisito especial',
  outra: 'Outra',
};

/** Secao 71: operacoes que exigem sinalizacao especial ao encarregado. */
export const REQUISITO_ESPECIAL_LOGISTICO = [
  'refrigeracao',
  'congelamento',
  'fragilidade',
  'cadaver',
  'medico_legal',
  'alto_valor_diagnostico',
  'outro',
] as const;
export type RequisitoEspecialLogistico = (typeof REQUISITO_ESPECIAL_LOGISTICO)[number];

export const REQUISITO_ESPECIAL_LOGISTICO_LABEL: Record<RequisitoEspecialLogistico, string> = {
  refrigeracao: 'Refrigeração',
  congelamento: 'Congelamento',
  fragilidade: 'Fragilidade',
  cadaver: 'Cadáver',
  medico_legal: 'Material médico-legal',
  alto_valor_diagnostico: 'Alto valor diagnóstico',
  outro: 'Outro requisito',
};

/**
 * Secao 25: status INTERNOS da solicitacao.
 *
 * A ordem e a do ciclo operacional, e e usada para desenhar o funil sem que
 * ninguem precise reordenar na mao.
 */
export const STATUS_SOLICITACAO_LOGISTICA = [
  'rascunho',
  'recebida',
  'aguardando_informacao',
  'aguardando_triagem',
  'aguardando_aceite',
  'aceita',
  'agendada',
  'em_deslocamento',
  'no_local',
  'coletada',
  'em_transporte',
  'entregue',
  'concluida',
  'cancelada',
  'nao_realizada',
] as const;
export type StatusSolicitacaoLogistica = (typeof STATUS_SOLICITACAO_LOGISTICA)[number];

export const STATUS_SOLICITACAO_LOGISTICA_LABEL: Record<StatusSolicitacaoLogistica, string> = {
  rascunho: 'Rascunho',
  recebida: 'Recebida',
  aguardando_informacao: 'Aguardando informação',
  aguardando_triagem: 'Aguardando triagem logística',
  aguardando_aceite: 'Aguardando aceite',
  aceita: 'Aceita',
  agendada: 'Agendada',
  em_deslocamento: 'Motorista a caminho',
  no_local: 'No local',
  coletada: 'Coletada',
  em_transporte: 'Em transporte',
  entregue: 'Entregue',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  nao_realizada: 'Não realizada',
};

/** Situacoes em que a solicitacao ainda ocupa alguem. */
export const STATUS_LOGISTICO_ABERTO: StatusSolicitacaoLogistica[] = [
  'rascunho',
  'recebida',
  'aguardando_informacao',
  'aguardando_triagem',
  'aguardando_aceite',
  'aceita',
  'agendada',
  'em_deslocamento',
  'no_local',
  'coletada',
  'em_transporte',
  'entregue',
];

/**
 * Secao 26: o que o CLIENTE ve.
 *
 * Deliberadamente mais pobre que o interno. Reatribuicao de motorista, triagem
 * logistica e ocorrencia sensivel sao assunto de dentro de casa (secao 89).
 */
export const STATUS_EXTERNO_LOGISTICO = [
  'solicitada',
  'aguardando_confirmacao',
  'agendada',
  'a_caminho',
  'coletada',
  'entregue_ao_laboratorio',
  'cancelada',
] as const;
export type StatusExternoLogistico = (typeof STATUS_EXTERNO_LOGISTICO)[number];

export const STATUS_EXTERNO_LOGISTICO_LABEL: Record<StatusExternoLogistico, string> = {
  solicitada: 'Solicitada',
  aguardando_confirmacao: 'Aguardando confirmação',
  agendada: 'Agendada',
  a_caminho: 'Motorista a caminho',
  coletada: 'Coletada',
  entregue_ao_laboratorio: 'Entregue ao laboratório',
  cancelada: 'Cancelada',
};

/**
 * Secao 27: a conversao interno -> externo mora AQUI, no M19.
 *
 * "O Portal nao devera criar status logisticos independentes." Deixar a
 * traducao no front do Portal criaria uma segunda tabela de equivalencia, que
 * envelheceria em silencio a cada status novo.
 */
export function statusExternoDe(
  interno: StatusSolicitacaoLogistica,
): StatusExternoLogistico | null {
  switch (interno) {
    // O cliente nao precisa saber que o pedido dele ainda e rascunho interno.
    case 'rascunho':
      return null;
    case 'recebida':
    case 'aguardando_informacao':
      return 'solicitada';
    case 'aguardando_triagem':
    case 'aguardando_aceite':
      return 'aguardando_confirmacao';
    case 'aceita':
    case 'agendada':
      return 'agendada';
    case 'em_deslocamento':
    case 'no_local':
      return 'a_caminho';
    case 'coletada':
    case 'em_transporte':
      return 'coletada';
    case 'entregue':
    case 'concluida':
      return 'entregue_ao_laboratorio';
    case 'cancelada':
    case 'nao_realizada':
      return 'cancelada';
  }
}

/**
 * Secao 144: estado da oferta enviada a UM encarregado.
 *
 * Cada convidado tem sua propria linha e seu proprio desfecho: um aceita, os
 * outros sao encerrados. Guardar isso numa lista dentro da solicitacao perderia
 * quem recusou e quem simplesmente nao respondeu - que e a diferenca entre um
 * encarregado indisponivel e um que nao esta olhando o celular.
 */
export const STATUS_OFERTA = [
  'enviada',
  'aceita',
  'recusada',
  'encerrada',
  'expirada',
] as const;
export type StatusOferta = (typeof STATUS_OFERTA)[number];

export const STATUS_OFERTA_LABEL: Record<StatusOferta, string> = {
  enviada: 'Enviada',
  aceita: 'Aceita',
  recusada: 'Recusada',
  encerrada: 'Encerrada (assumida por outro)',
  expirada: 'Expirada',
};

/** Secao 84: motivos de nao realizacao. O motivo e obrigatorio (secao 83). */
export const MOTIVO_NAO_REALIZACAO = [
  'cliente_fechado',
  'material_indisponivel',
  'cancelado_pelo_cliente',
  'endereco_incorreto',
  'sem_acesso',
  'falha_operacional',
  'outro',
] as const;
export type MotivoNaoRealizacao = (typeof MOTIVO_NAO_REALIZACAO)[number];

export const MOTIVO_NAO_REALIZACAO_LABEL: Record<MotivoNaoRealizacao, string> = {
  cliente_fechado: 'Cliente fechado',
  material_indisponivel: 'Material não disponível',
  cancelado_pelo_cliente: 'Cancelamento pelo cliente',
  endereco_incorreto: 'Endereço incorreto',
  sem_acesso: 'Impossibilidade de acesso',
  falha_operacional: 'Falha operacional',
  outro: 'Outro motivo',
};

/** Secao 146: prazo padrao da oferta, quando a instituicao nao configurar outro. */
export const MINUTOS_VALIDADE_OFERTA = 30;
