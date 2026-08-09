/**
 * Catalogo de permissoes (M02).
 *
 * M02 secao 12: alem do acesso ao modulo, existe controle granular por acao.
 * Um usuario pode acessar o modulo de Histopatologia sem poder executar todas
 * as acoes dele.
 *
 * Formato: `recurso:acao` - o mesmo formato de escopo que o Blueprint secao 8
 * pede para quando a API for aberta a terceiros, para nao termos dois
 * vocabularios diferentes depois.
 */
export const PERMISSOES = {
  // M01 Administracao
  CONFIG_VISUALIZAR: 'config:visualizar',
  CONFIG_EDITAR: 'config:editar',
  UNIDADE_GERENCIAR: 'unidade:gerenciar',
  TABELA_MESTRE_GERENCIAR: 'tabela_mestre:gerenciar',

  // M02 Usuarios
  USUARIO_VISUALIZAR: 'usuario:visualizar',
  USUARIO_CRIAR: 'usuario:criar',
  USUARIO_EDITAR: 'usuario:editar',
  USUARIO_BLOQUEAR: 'usuario:bloquear',
  PERMISSAO_GERENCIAR: 'permissao:gerenciar',

  // M03 Clientes e veterinarios
  CLIENTE_VISUALIZAR: 'cliente:visualizar',
  CLIENTE_CRIAR: 'cliente:criar',
  CLIENTE_EDITAR: 'cliente:editar',
  CLIENTE_FUNDIR: 'cliente:fundir',
  VETERINARIO_VISUALIZAR: 'veterinario:visualizar',
  VETERINARIO_CRIAR: 'veterinario:criar',
  VETERINARIO_EDITAR: 'veterinario:editar',

  // M05 Recebimento e cadastro
  CASO_VISUALIZAR: 'caso:visualizar',
  CASO_CRIAR: 'caso:criar',
  CASO_EDITAR: 'caso:editar',
  CASO_CANCELAR: 'caso:cancelar',
  /** M05: alteracoes criticas pos-recebimento (paciente, cliente, exame). */
  CASO_CORRIGIR_CRITICO: 'caso:corrigir_critico',
  MATERIAL_RECEBER: 'material:receber',
  ETIQUETA_IMPRIMIR: 'etiqueta:imprimir',
  ETIQUETA_REIMPRIMIR: 'etiqueta:reimprimir',

  // M06 Triagem
  TRIAGEM_EXECUTAR: 'triagem:executar',
  TRIAGEM_RECUSAR_MATERIAL: 'triagem:recusar_material',
  TRIAGEM_DESBLOQUEAR: 'triagem:desbloquear',

  // M07 Rastreamento
  FLUXO_VISUALIZAR: 'fluxo:visualizar',
  /** M07: transicao manual e excecao, exige permissao e justificativa. */
  FLUXO_TRANSICAO_MANUAL: 'fluxo:transicao_manual',
  FLUXO_ALTERAR_PRIORIDADE: 'fluxo:alterar_prioridade',
  FLUXO_REABRIR_CASO: 'fluxo:reabrir_caso',
  FLUXO_ATRIBUIR_RESPONSAVEL: 'fluxo:atribuir_responsavel',

  // M08 Macroscopia
  MACROSCOPIA_VISUALIZAR: 'macroscopia:visualizar',
  MACROSCOPIA_EXECUTAR: 'macroscopia:executar',
  /** M08: residente/tecnico em treinamento nao conclui sem aprovacao. */
  MACROSCOPIA_CONCLUIR: 'macroscopia:concluir',
  MACROSCOPIA_ALTERAR_APOS_CONCLUSAO: 'macroscopia:alterar_apos_conclusao',

  // M09 Processamento
  PROCESSAMENTO_VISUALIZAR: 'processamento:visualizar',
  PROCESSAMENTO_ENVIAR_LOTE: 'processamento:enviar_lote',
  /** Usado pelo laboratorio de apoio terceirizado. */
  PROCESSAMENTO_CONFIRMAR_RECEBIMENTO: 'processamento:confirmar_recebimento',
  PROCESSAMENTO_REGISTRAR_LAMINAS: 'processamento:registrar_laminas',

  // M10 Solicitacoes e pendencias
  SOLICITACAO_VISUALIZAR: 'solicitacao:visualizar',
  SOLICITACAO_CRIAR: 'solicitacao:criar',
  SOLICITACAO_APROVAR: 'solicitacao:aprovar',
  SOLICITACAO_EXECUTAR: 'solicitacao:executar',
  SOLICITACAO_CANCELAR: 'solicitacao:cancelar',
  PENDENCIA_RESOLVER: 'pendencia:resolver',

  // M11 Laudos e microscopia
  LAUDO_VISUALIZAR: 'laudo:visualizar',
  LAUDO_EDITAR: 'laudo:editar',
  LAUDO_REVISAR: 'laudo:revisar',
  /** M02: assinatura e pessoal e intransferivel; admin nao adquire autoridade tecnica. */
  LAUDO_ASSINAR: 'laudo:assinar',
  LAUDO_LIBERAR: 'laudo:liberar',
  LAUDO_ADENDO: 'laudo:adendo',
  LAUDO_CORRIGIR: 'laudo:corrigir',
  /** M11: notas internas nunca aparecem no documento externo. */
  LAUDO_VER_NOTA_INTERNA: 'laudo:ver_nota_interna',

  // M16 Imagens
  IMAGEM_VISUALIZAR: 'imagem:visualizar',
  IMAGEM_ENVIAR: 'imagem:enviar',
  IMAGEM_EDITAR: 'imagem:editar',
  IMAGEM_EXPORTAR: 'imagem:exportar',

  // M22 Qualidade e auditoria
  AUDITORIA_VISUALIZAR: 'auditoria:visualizar',
} as const;

export type Permissao = (typeof PERMISSOES)[keyof typeof PERMISSOES];

export const TODAS_PERMISSOES = Object.values(PERMISSOES) as Permissao[];

/**
 * M02 secao 13: o escopo limita a permissao ao ambito em que o usuario atua.
 * Um administrador da Unidade Fortaleza administra usuarios de Fortaleza, nao
 * de outra unidade.
 */
export const ESCOPO_PERMISSAO = [
  'instituicao',
  'unidade',
  'setor',
  'proprios_casos',
] as const;
export type EscopoPermissao = (typeof ESCOPO_PERMISSAO)[number];

/**
 * M02 secao 10: "perfis nao devem ser absolutos". Os perfis abaixo sao modelos
 * iniciais de permissao, ajustaveis por usuario dentro dos limites autorizados.
 */
export const PERFIS_PADRAO = {
  ADMINISTRADOR_GERAL: 'administrador_geral',
  ADMINISTRADOR_UNIDADE: 'administrador_unidade',
  GESTOR: 'gestor',
  RECEPCAO: 'recepcao',
  TECNICO_LABORATORIO: 'tecnico_laboratorio',
  TECNICO_HISTOTECNICA: 'tecnico_histotecnica',
  PATOLOGISTA: 'patologista',
  PATOLOGISTA_REVISOR: 'patologista_revisor',
  RESIDENTE: 'residente',
  LABORATORIO_APOIO: 'laboratorio_apoio',
  QUALIDADE: 'qualidade',
  CLIENTE: 'cliente',
  VETERINARIO_SOLICITANTE: 'veterinario_solicitante',
} as const;

export type PerfilPadrao = (typeof PERFIS_PADRAO)[keyof typeof PERFIS_PADRAO];
