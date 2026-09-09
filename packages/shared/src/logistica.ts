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

// --- Fatia 2: execucao, evidencias, rota e producao ------------------------

/**
 * Secao 52: por que o encarregado nao conseguiu entregar ou receber no local.
 *
 * Registrar a tentativa e o que separa "o cliente nao estava" de "o
 * encarregado nao foi" - sem isso, os dois viram a mesma coleta nao realizada.
 */
export const MOTIVO_CONTATO_SEM_SUCESSO = [
  'ninguem_no_local',
  'cliente_fechado',
  'contato_nao_atende',
  'material_nao_preparado',
  'endereco_nao_localizado',
  'outro',
] as const;
export type MotivoContatoSemSucesso = (typeof MOTIVO_CONTATO_SEM_SUCESSO)[number];

export const MOTIVO_CONTATO_SEM_SUCESSO_LABEL: Record<MotivoContatoSemSucesso, string> = {
  ninguem_no_local: 'Ninguém no local',
  cliente_fechado: 'Cliente fechado',
  contato_nao_atende: 'Contato não atende',
  material_nao_preparado: 'Material não preparado',
  endereco_nao_localizado: 'Endereço não localizado',
  outro: 'Outro',
};

/**
 * Secao 60: o que o encarregado VE na embalagem, sem avaliar o material.
 *
 * A secao 62 e categorica: adequacao diagnostica, qualidade histologica e
 * aceite tecnico sao do M05. Aqui cabe "frasco quebrado", nao "amostra
 * inadequada".
 */
export const CONDICAO_MATERIAL_LOGISTICA = [
  'frasco_quebrado',
  'vazamento',
  'embalagem_inadequada',
  'sem_identificacao',
  'sem_refrigeracao',
  'outra',
] as const;
export type CondicaoMaterialLogistica = (typeof CONDICAO_MATERIAL_LOGISTICA)[number];

export const CONDICAO_MATERIAL_LOGISTICA_LABEL: Record<CondicaoMaterialLogistica, string> = {
  frasco_quebrado: 'Frasco quebrado',
  vazamento: 'Vazamento aparente',
  embalagem_inadequada: 'Embalagem inadequada',
  sem_identificacao: 'Identificação ausente',
  sem_refrigeracao: 'Sem refrigeração quando esperada',
  outra: 'Outra observação',
};

/** Secao 73: o que pode acontecer no caminho. */
export const TIPO_OCORRENCIA_LOGISTICA = [
  'acidente',
  'atraso',
  'falha_veiculo',
  'vazamento',
  'quebra_recipiente',
  'perda_refrigeracao',
  'extravio',
  'interdicao_via',
  'outra',
] as const;
export type TipoOcorrenciaLogistica = (typeof TIPO_OCORRENCIA_LOGISTICA)[number];

export const TIPO_OCORRENCIA_LOGISTICA_LABEL: Record<TipoOcorrenciaLogistica, string> = {
  acidente: 'Acidente',
  atraso: 'Atraso significativo',
  falha_veiculo: 'Falha do veículo',
  vazamento: 'Vazamento',
  quebra_recipiente: 'Quebra de recipiente',
  perda_refrigeracao: 'Perda de refrigeração',
  extravio: 'Extravio',
  interdicao_via: 'Interdição de via',
  outra: 'Outra ocorrência',
};

/**
 * Secao 74: as criticas notificam a central na hora e vao para a Qualidade
 * (M22). O que decide se e critica e o risco para o material ou para a
 * pessoa, nao o transtorno para a rota.
 */
export const OCORRENCIA_LOGISTICA_CRITICA: TipoOcorrenciaLogistica[] = [
  'acidente',
  'vazamento',
  'quebra_recipiente',
  'perda_refrigeracao',
  'extravio',
];

/**
 * Secao 151: marcos que exigem fotografia.
 *
 * `ocorrencia` entra porque a secao 61 pede foto documental da embalagem ou
 * do evento; nao e obrigatoria, mas precisa ficar ligada ao momento certo.
 */
export const MARCO_EVIDENCIA_LOGISTICA = ['retirada', 'entrega', 'ocorrencia'] as const;
export type MarcoEvidenciaLogistica = (typeof MARCO_EVIDENCIA_LOGISTICA)[number];

export const MARCO_EVIDENCIA_LOGISTICA_LABEL: Record<MarcoEvidenciaLogistica, string> = {
  retirada: 'Material retirado',
  entrega: 'Material entregue',
  ocorrencia: 'Ocorrência',
};

/** Secao 151: "no minimo 1 fotografia e permitidas ate 4 por marco". */
export const FOTOS_MINIMAS_POR_MARCO = 1;
export const FOTOS_MAXIMAS_POR_MARCO = 4;

/**
 * Secao 153: quando nao ha coordenada, o motivo fica registrado "sem inventar
 * coordenadas". A ausencia e um dado, nao um campo vazio.
 */
export const MOTIVO_GEO_AUSENTE = ['sem_permissao', 'indisponivel', 'sem_sinal'] as const;
export type MotivoGeoAusente = (typeof MOTIVO_GEO_AUSENTE)[number];

export const MOTIVO_GEO_AUSENTE_LABEL: Record<MotivoGeoAusente, string> = {
  sem_permissao: 'Permissão de localização negada',
  indisponivel: 'Dispositivo sem localização',
  sem_sinal: 'Sem sinal no momento',
};

/** O que fica gravado num marco critico (secao 153). */
export interface GeoMarco {
  latitude: number | null;
  longitude: number | null;
  precisaoMetros?: number | null;
  ausente?: MotivoGeoAusente | null;
  registradoEm: string;
}

/** Secao 66: quem entregou o material ao encarregado, no cliente. */
export interface PessoaNoLocal {
  nome: string;
  funcao?: string | null;
}

/** Secao 155: quem recebeu o material numa ENTREGA. */
export interface Recebedor {
  nome: string;
  documento?: string | null;
  observacao?: string | null;
}

/** Secoes 37 a 47: a rota do dia de um encarregado. */
export const STATUS_ROTA_LOGISTICA = ['planejada', 'em_andamento', 'encerrada'] as const;
export type StatusRotaLogistica = (typeof STATUS_ROTA_LOGISTICA)[number];

export const STATUS_ROTA_LOGISTICA_LABEL: Record<StatusRotaLogistica, string> = {
  planejada: 'Planejada',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
};

/**
 * Secao 160: situacao financeira do servico, fornecida pelo M20 e apenas
 * EXIBIDA pela logistica.
 */
export const SITUACAO_PRODUCAO_LOGISTICA = [
  'nao_lancado',
  'lancado',
  'incluido_em_fechamento',
  'pago',
  'cancelado',
] as const;
export type SituacaoProducaoLogistica = (typeof SITUACAO_PRODUCAO_LOGISTICA)[number];

export const SITUACAO_PRODUCAO_LOGISTICA_LABEL: Record<SituacaoProducaoLogistica, string> = {
  nao_lancado: 'Não lançado',
  lancado: 'Lançado',
  incluido_em_fechamento: 'Incluído em fechamento',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

/**
 * Secao 150: os botoes do encarregado, na ordem, por tipo de servico.
 *
 * O status interno e o mesmo nos dois sentidos (`coletada` e "o material esta
 * com o encarregado"); o que muda e o ROTULO, porque "material retirado no
 * laboratorio" e "material retirado no cliente" sao gestos diferentes para
 * quem esta com o celular na mao.
 */
export interface MarcoOperacional {
  /** Status que o marco produz. */
  status: Extract<
    StatusSolicitacaoLogistica,
    'em_deslocamento' | 'no_local' | 'coletada' | 'em_transporte' | 'entregue' | 'concluida'
  >;
  rotulo: string;
  /** Marco que abre a camera e pede geolocalizacao (secoes 151 e 153). */
  exigeEvidencia: boolean;
}

export function marcosDoServico(tipo: TipoServicoLogistico): MarcoOperacional[] {
  if (tipo === 'entrega') {
    return [
      { status: 'em_deslocamento', rotulo: 'Em deslocamento', exigeEvidencia: false },
      { status: 'coletada', rotulo: 'Material retirado no laboratório', exigeEvidencia: true },
      { status: 'em_transporte', rotulo: 'Em transporte', exigeEvidencia: false },
      { status: 'entregue', rotulo: 'Material entregue', exigeEvidencia: true },
      { status: 'concluida', rotulo: 'Serviço concluído', exigeEvidencia: false },
    ];
  }
  return [
    { status: 'em_deslocamento', rotulo: 'Em deslocamento', exigeEvidencia: false },
    { status: 'no_local', rotulo: 'Cheguei ao local', exigeEvidencia: false },
    { status: 'coletada', rotulo: 'Material retirado', exigeEvidencia: true },
    { status: 'em_transporte', rotulo: 'Em transporte', exigeEvidencia: false },
    { status: 'entregue', rotulo: 'Entregue ao laboratório', exigeEvidencia: true },
    { status: 'concluida', rotulo: 'Serviço concluído', exigeEvidencia: false },
  ];
}

/**
 * De onde cada marco pode ser acionado.
 *
 * A chegada (`no_local`) e opcional na retirada - a secao 50 diz "podera" - e
 * nao existe na entrega, cuja origem e o proprio laboratorio. Pular a chegada
 * nao bloqueia, mas vira achado do Guardian (secao 111: "coleta marcada como
 * concluida sem chegada registrada").
 */
export const ORIGENS_DO_MARCO: Record<MarcoOperacional['status'], StatusSolicitacaoLogistica[]> = {
  em_deslocamento: ['aceita', 'agendada'],
  no_local: ['em_deslocamento', 'aceita', 'agendada'],
  coletada: ['no_local', 'em_deslocamento', 'aceita', 'agendada'],
  em_transporte: ['coletada'],
  entregue: ['em_transporte', 'coletada'],
  concluida: ['entregue'],
};

/**
 * Secao 154: distancia entre a posicao registrada e o endereco previsto que
 * vira alerta. Nao bloqueia - "situacoes legitimas" existem, e quem decide e
 * a central.
 */
export const DISTANCIA_ALERTA_GEO_METROS = 500;

/**
 * Distancia aproximada entre duas coordenadas, em metros (haversine).
 *
 * Fica no shared porque a tela do encarregado mostra o mesmo aviso que o
 * servidor grava, e dois calculos diferentes dariam dois avisos diferentes.
 */
export function distanciaMetros(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
