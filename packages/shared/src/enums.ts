/**
 * Enums do dominio, extraidos diretamente da documentacao dos modulos.
 * Ficam aqui (e nao no schema do banco) para serem compartilhados entre API,
 * worker e front sem duplicacao.
 */

// --- M05 Recebimento -------------------------------------------------------

/**
 * M05: "Solicitado != Cadastrado != Recebido != Triado" - quatro momentos
 * registrados separadamente, nenhum apaga o anterior.
 */
export const MOMENTO_CASO = ['solicitado', 'cadastrado', 'recebido', 'triado'] as const;
export type MomentoCaso = (typeof MOMENTO_CASO)[number];

export const FORMA_ENTREGA = [
  'entrega_balcao',
  'coleta_propria',
  'transportadora',
  'correios',
  'motoboy',
  'outra',
] as const;
export type FormaEntrega = (typeof FORMA_ENTREGA)[number];

// --- M06 Triagem -----------------------------------------------------------

/**
 * M05/M06: resultado da triagem por amostra. O resultado do caso e derivado
 * das amostras por regra de agregacao configuravel.
 */
export const RESULTADO_TRIAGEM = [
  'apto',
  'apto_com_ressalva',
  'bloqueado',
  'recusado',
] as const;
export type ResultadoTriagem = (typeof RESULTADO_TRIAGEM)[number];

/** M05: gravidade da nao conformidade pre-analitica. */
export const GRAVIDADE_NC = ['leve', 'moderada', 'grave', 'critica'] as const;
export type GravidadeNc = (typeof GRAVIDADE_NC)[number];

// --- M07 Rastreamento ------------------------------------------------------

/**
 * Etapas do fluxo. O estado global do caso pertence exclusivamente ao M07
 * (DIRETRIZES secao 12) - nenhum outro modulo escreve status.
 */
export const ETAPA = [
  'aguardando_recebimento',
  'recebido',
  'aguardando_triagem',
  'em_triagem',
  'aguardando_macroscopia',
  'em_macroscopia',
  'aguardando_processamento',
  'em_processamento',
  'laminas_disponiveis',
  'aguardando_microscopia',
  'em_microscopia',
  'aguardando_complementar',
  'aguardando_revisao',
  'em_revisao',
  'aguardando_assinatura',
  'liberado',
  'arquivado',
  'cancelado',
] as const;
export type Etapa = (typeof ETAPA)[number];

/** M07: nivel de alerta de prazo. */
export const ALERTA_PRAZO = ['normal', 'atencao', 'critico', 'atrasado'] as const;
export type AlertaPrazo = (typeof ALERTA_PRAZO)[number];

/**
 * M07: status simplificado exposto ao Portal do Cliente. O Portal nao cria
 * status proprio - recebe a traducao feita pelo M07 (M04).
 */
export const STATUS_EXTERNO = [
  'aguardando_material',
  'material_recebido',
  'em_analise',
  'aguardando_informacao',
  'laudo_liberado',
  'cancelado',
] as const;
export type StatusExterno = (typeof STATUS_EXTERNO)[number];

// --- M10 Solicitacoes e Pendencias -----------------------------------------

export const PRIORIDADE = ['rotina', 'prioritaria', 'urgente', 'critica'] as const;
export type Prioridade = (typeof PRIORIDADE)[number];

export const STATUS_SOLICITACAO = [
  'criada',
  'aguardando_analise',
  'aprovada',
  'recusada',
  'aguardando_execucao',
  'em_execucao',
  'aguardando_informacao',
  'parcialmente_concluida',
  'concluida',
  'cancelada',
] as const;
export type StatusSolicitacao = (typeof STATUS_SOLICITACAO)[number];

export const STATUS_PENDENCIA = [
  'aberta',
  'aguardando_acao_interna',
  'aguardando_cliente',
  'aguardando_veterinario',
  'aguardando_patologista',
  'aguardando_autorizacao',
  'aguardando_execucao_tecnica',
  'respondida',
  'em_validacao',
  'resolvida',
  'cancelada',
] as const;
export type StatusPendencia = (typeof STATUS_PENDENCIA)[number];

/** M10: uma pendencia pode nao bloquear, bloquear parcialmente ou bloquear o fluxo. */
export const NIVEL_BLOQUEIO = ['nao', 'parcial', 'total'] as const;
export type NivelBloqueio = (typeof NIVEL_BLOQUEIO)[number];

// --- M08 Macroscopia -------------------------------------------------------

/** M08: metodo de amostragem da margem - afeta a leitura da distancia no M13. */
export const METODO_AMOSTRAGEM = ['perpendicular', 'tangencial_en_face', 'radial'] as const;
export type MetodoAmostragem = (typeof METODO_AMOSTRAGEM)[number];

export const LATERALIDADE = ['direito', 'esquerdo', 'bilateral', 'nao_aplicavel'] as const;
export type Lateralidade = (typeof LATERALIDADE)[number];

// --- M13 Histopatologia ----------------------------------------------------

/**
 * M13: resultado da margem microscopica. "nao_avaliavel" existe por exigencia
 * explicita - o sistema nao obriga preenchimento inventado.
 */
export const RESULTADO_MARGEM = [
  'livre',
  'comprometida',
  'proxima',
  'nao_avaliavel',
  'indeterminada',
] as const;
export type ResultadoMargem = (typeof RESULTADO_MARGEM)[number];

// --- M12 Citopatologia -----------------------------------------------------

/**
 * M12 secoes 9-12: adequacao da amostra citologica.
 *
 * A escala inteira existe porque o modulo e explicito ao recusar a simplificacao
 * para "adequada / inadequada": "adequada com limitacoes" (secao 11) NAO
 * equivale a insatisfatoria, e secao 142 fecha a regra - amostra inadequada nao
 * pode ser tratada como equivalente a amostra negativa, e "nao diagnostica" e
 * diferente de "negativa".
 */
export const ADEQUACAO_CITOLOGICA = [
  'adequada',
  'adequada_com_limitacoes',
  'pouco_representativa',
  'insatisfatoria',
  'nao_diagnostica',
] as const;
export type AdequacaoCitologica = (typeof ADEQUACAO_CITOLOGICA)[number];

/** M12 secao 13. */
export const CELULARIDADE = [
  'acelular',
  'muito_baixa',
  'baixa',
  'moderada',
  'alta',
  'muito_alta',
] as const;
export type Celularidade = (typeof CELULARIDADE)[number];

/** M12 secao 15. */
export const PRESERVACAO_CELULAR = [
  'excelente',
  'boa',
  'moderada',
  'ruim',
  'acentuadamente_degenerada',
] as const;
export type PreservacaoCelular = (typeof PRESERVACAO_CELULAR)[number];

/** M12 secoes 17-18 e 28: escala de intensidade compartilhada. */
export const INTENSIDADE = ['ausente', 'discreta', 'moderada', 'acentuada'] as const;
export type Intensidade = (typeof INTENSIDADE)[number];

/**
 * M12 secao 66: grau de certeza estruturado, de uso **interno**.
 *
 * "Podera ajudar na auditoria e IA, mas nao devera necessariamente aparecer no
 * laudo" - por isso ele nao entra no PDF, e serve ao Guardian (secao 89:
 * amostra pouco representativa com diagnostico definitivo pede revisao).
 */
export const GRAU_CERTEZA = ['alta', 'moderada', 'limitada'] as const;
export type GrauCerteza = (typeof GRAU_CERTEZA)[number];

// --- M11 Laudos ------------------------------------------------------------

export const STATUS_LAUDO = [
  'rascunho',
  'aguardando_revisao',
  'em_revisao',
  'retornado_para_correcao',
  'aguardando_assinatura',
  'assinado',
  'liberado',
  'substituido',
] as const;
export type StatusLaudo = (typeof STATUS_LAUDO)[number];

/** M11: adendo acrescenta; correcao retifica. Ambos criam nova versao. */
export const TIPO_VERSAO_LAUDO = ['original', 'adendo', 'correcao'] as const;
export type TipoVersaoLaudo = (typeof TIPO_VERSAO_LAUDO)[number];

// --- M16 Imagens -----------------------------------------------------------

/**
 * M16. `whole_slide` fica reservado: WSI esta fora do escopo v1 por decisao
 * da propria documentacao. Ver docs/adr/0004.
 */
export const TIPO_IMAGEM = [
  'recebimento',
  'triagem',
  'macroscopia',
  'microfotografia',
  'necropsia',
  'documento',
  'whole_slide',
] as const;
export type TipoImagem = (typeof TIPO_IMAGEM)[number];

/** M16: a origem e obrigatoria - imagem do cliente aparece visualmente separada. */
export const ORIGEM_IMAGEM = [
  'produzida_lapato',
  'enviada_cliente',
  'enviada_veterinario',
  'importada',
  'laboratorio_parceiro',
  'pericial_externa',
] as const;
export type OrigemImagem = (typeof ORIGEM_IMAGEM)[number];

/** M16: o original nunca e sobrescrito. */
export const NIVEL_IMAGEM = ['original', 'trabalho', 'publicada'] as const;
export type NivelImagem = (typeof NIVEL_IMAGEM)[number];

// --- M17 Inteligencia Artificial -------------------------------------------

/** M17 secao 11: niveis de intervencao da IA, com padrao visual consistente. */
export const NIVEL_IA = ['informacao', 'sugestao', 'atencao', 'critico'] as const;
export type NivelIa = (typeof NIVEL_IA)[number];

/** M17 secao 15: o sistema registra o que o usuario fez com cada sugestao. */
export const ACAO_SUGESTAO = ['aceita', 'editada', 'rejeitada', 'ignorada'] as const;
export type AcaoSugestao = (typeof ACAO_SUGESTAO)[number];

// --- M01 Administracao -----------------------------------------------------

export const TIPO_UNIDADE = [
  'sede',
  'filial',
  'posto_recebimento',
  'laboratorio_apoio',
  'unidade_parceira',
] as const;
export type TipoUnidade = (typeof TIPO_UNIDADE)[number];

// --- M02 Usuarios ----------------------------------------------------------

export const STATUS_USUARIO = [
  'ativo',
  'aguardando_ativacao',
  'suspenso',
  'bloqueado',
  'afastado',
  'temporario',
  'acesso_expirado',
  'desligado',
  'inativo',
] as const;
export type StatusUsuario = (typeof STATUS_USUARIO)[number];

/** M02: internos, externos, academicos e temporarios. */
export const CATEGORIA_USUARIO = ['interno', 'externo', 'academico', 'temporario'] as const;
export type CategoriaUsuario = (typeof CATEGORIA_USUARIO)[number];

// --- M03 Clientes ----------------------------------------------------------

export const TIPO_CLIENTE = [
  'clinica',
  'hospital',
  'veterinario_autonomo',
  'laboratorio_parceiro',
  'universidade',
  'instituicao_publica',
  'ong',
  'centro_pesquisa',
  'empresa',
  'tutor_particular',
  'outro',
] as const;
export type TipoCliente = (typeof TIPO_CLIENTE)[number];

export const STATUS_CLIENTE = [
  'ativo',
  'aguardando_aprovacao',
  'pendente_documentacao',
  'suspenso',
  'inativo',
  'bloqueado',
  'encerrado',
] as const;
export type StatusCliente = (typeof STATUS_CLIENTE)[number];
