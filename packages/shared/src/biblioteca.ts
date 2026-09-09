/**
 * M21 - Biblioteca: vocabulario da memoria documental.
 *
 * Secao 1: "a informacao correta, na versao correta, ao usuario correto e no
 * momento em que ela for necessaria". O que estrutura o modulo nao e o
 * arquivo, e a VERSAO: um documento tem varias, e so uma e vigente (secao 19).
 */

/** Secao 5: o que a Biblioteca guarda. */
export const TIPO_DOCUMENTO = [
  'pop',
  'protocolo',
  'instrucao_trabalho',
  'manual',
  'norma_interna',
  'guia',
  'criterio_diagnostico',
  'classificacao',
  'artigo',
  'referencia',
  'documento_regulatorio',
  'material_treinamento',
  'faq',
  'modelo',
  'outro',
] as const;
export type TipoDocumento = (typeof TIPO_DOCUMENTO)[number];

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumento, string> = {
  pop: 'Procedimento operacional padrão (POP)',
  protocolo: 'Protocolo',
  instrucao_trabalho: 'Instrução de trabalho',
  manual: 'Manual',
  norma_interna: 'Norma interna',
  guia: 'Guia (coleta, acondicionamento, envio)',
  criterio_diagnostico: 'Critério diagnóstico',
  classificacao: 'Sistema de graduação ou classificação',
  artigo: 'Artigo científico',
  referencia: 'Capítulo ou referência autorizada',
  documento_regulatorio: 'Documento regulatório',
  material_treinamento: 'Material de treinamento',
  faq: 'Perguntas frequentes',
  modelo: 'Modelo institucional',
  outro: 'Outro conteúdo',
};

/** Secao 10: o prefixo do codigo vem do tipo - `POP-HIST-004`. */
export const SIGLA_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  pop: 'POP',
  protocolo: 'PROT',
  instrucao_trabalho: 'IT',
  manual: 'MAN',
  norma_interna: 'NI',
  guia: 'GUIA',
  criterio_diagnostico: 'CRIT',
  classificacao: 'CLAS',
  artigo: 'ART',
  referencia: 'REF',
  documento_regulatorio: 'REG',
  material_treinamento: 'TRE',
  faq: 'FAQ',
  modelo: 'MOD',
  outro: 'DOC',
};

/** Secao 6: categorias principais. */
export const CATEGORIA_DOCUMENTO = [
  'recebimento_triagem',
  'citopatologia',
  'histopatologia',
  'macroscopia',
  'processamento',
  'coloracoes',
  'microscopia_diagnostico',
  'necropsia',
  'medicina_legal',
  'bioteca',
  'logistica',
  'qualidade',
  'biosseguranca',
  'ensino',
  'administracao',
  'outros',
] as const;
export type CategoriaDocumento = (typeof CATEGORIA_DOCUMENTO)[number];

export const CATEGORIA_DOCUMENTO_LABEL: Record<CategoriaDocumento, string> = {
  recebimento_triagem: 'Recebimento e Triagem',
  citopatologia: 'Citopatologia',
  histopatologia: 'Histopatologia',
  macroscopia: 'Macroscopia',
  processamento: 'Processamento',
  coloracoes: 'Colorações',
  microscopia_diagnostico: 'Microscopia e Diagnóstico',
  necropsia: 'Necropsia',
  medicina_legal: 'Medicina Veterinária Legal',
  bioteca: 'Bioteca',
  logistica: 'Logística',
  qualidade: 'Qualidade',
  biosseguranca: 'Biossegurança',
  ensino: 'Ensino e Treinamento',
  administracao: 'Administração',
  outros: 'Outros',
};

export const SIGLA_CATEGORIA_DOCUMENTO: Record<CategoriaDocumento, string> = {
  recebimento_triagem: 'REC',
  citopatologia: 'CITO',
  histopatologia: 'HIST',
  macroscopia: 'MACRO',
  processamento: 'PROC',
  coloracoes: 'COLOR',
  microscopia_diagnostico: 'MICRO',
  necropsia: 'NECRO',
  medicina_legal: 'LEGAL',
  bioteca: 'BIO',
  logistica: 'LOG',
  qualidade: 'QUAL',
  biosseguranca: 'BIOSSEG',
  ensino: 'ENS',
  administracao: 'ADM',
  outros: 'GER',
};

/**
 * Secao 12: status DOCUMENTAL - o do documento como um todo.
 *
 * `publicado` quer dizer "tem versao vigente"; `obsoleto` e `arquivado` sao
 * saidas de uso sem exclusao (secoes 33 a 35).
 */
export const STATUS_DOCUMENTO = ['rascunho', 'publicado', 'obsoleto', 'arquivado'] as const;
export type StatusDocumento = (typeof STATUS_DOCUMENTO)[number];

export const STATUS_DOCUMENTO_LABEL: Record<StatusDocumento, string> = {
  rascunho: 'Rascunho (sem versão vigente)',
  publicado: 'Publicado',
  obsoleto: 'Obsoleto',
  arquivado: 'Arquivado',
};

/**
 * Secoes 17 a 28: o ciclo de UMA versao.
 *
 * So uma versao por documento e `vigente`; as anteriores viram `obsoleta` na
 * publicacao seguinte e continuam consultaveis, "claramente identificadas como
 * NAO VIGENTES" (secao 20).
 */
export const STATUS_VERSAO_DOCUMENTO = [
  'rascunho',
  'em_revisao',
  'aguardando_aprovacao',
  'aprovada',
  'vigente',
  'obsoleta',
] as const;
export type StatusVersaoDocumento = (typeof STATUS_VERSAO_DOCUMENTO)[number];

export const STATUS_VERSAO_DOCUMENTO_LABEL: Record<StatusVersaoDocumento, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada, não publicada',
  vigente: 'Vigente',
  obsoleta: 'Não vigente',
};

/** Secao 26: o que o revisor faz com a versao. */
export const DESFECHO_REVISAO = ['comentario', 'ajuste_solicitado', 'revisao_concluida'] as const;
export type DesfechoRevisao = (typeof DESFECHO_REVISAO)[number];

export const DESFECHO_REVISAO_LABEL: Record<DesfechoRevisao, string> = {
  comentario: 'Comentário',
  ajuste_solicitado: 'Ajuste solicitado (devolvida ao autor)',
  revisao_concluida: 'Revisão concluída (segue para aprovação)',
};

/**
 * Secao 88: regra de visibilidade do conteudo.
 *
 * `clientes` e o que aparece no Portal (secoes 59-60: "somente conteudos
 * explicitamente liberados"). `restrito` fica com o responsavel e quem
 * administra a Biblioteca (secao 89).
 */
export const PUBLICO_DOCUMENTO = ['colaboradores', 'gestores', 'clientes', 'restrito'] as const;
export type PublicoDocumento = (typeof PUBLICO_DOCUMENTO)[number];

export const PUBLICO_DOCUMENTO_LABEL: Record<PublicoDocumento, string> = {
  colaboradores: 'Todos os colaboradores',
  gestores: 'Gestores e quem administra a Biblioteca',
  clientes: 'Colaboradores e clientes (aparece no Portal)',
  restrito: 'Restrito ao responsável',
};

/**
 * Secoes 51 a 58: de onde os outros modulos chamam a Biblioteca.
 *
 * Uma chave por tela; o documento declara em quais aparece. E o que faz um
 * guia de acondicionamento aparecer no Recebimento e um protocolo de margens
 * aparecer na Macroscopia sem que ninguem saia do fluxo.
 */
export const CONTEXTO_BIBLIOTECA = [
  'recebimento',
  'macroscopia',
  'processamento',
  'microscopia',
  'necropsia',
  'logistica',
  'bioteca',
  'portal',
  'emergencia',
] as const;
export type ContextoBiblioteca = (typeof CONTEXTO_BIBLIOTECA)[number];

export const CONTEXTO_BIBLIOTECA_LABEL: Record<ContextoBiblioteca, string> = {
  recebimento: 'Recebimento e triagem',
  macroscopia: 'Bancada de macroscopia',
  processamento: 'Processamento e colorações',
  microscopia: 'Microscopia e laudo',
  necropsia: 'Bancada de necropsia',
  logistica: 'Encarregado de coleta e entrega',
  bioteca: 'Bioteca',
  portal: 'Portal do cliente (orientações)',
  emergencia: 'Acesso destacado (emergência e biossegurança)',
};

/** Secao 105: o que o usuario diz sobre um documento. */
export const TIPO_FEEDBACK_DOCUMENTO = [
  'util',
  'erro',
  'desatualizado',
  'precisa_revisao',
  'solicitacao_novo',
] as const;
export type TipoFeedbackDocumento = (typeof TIPO_FEEDBACK_DOCUMENTO)[number];

export const TIPO_FEEDBACK_DOCUMENTO_LABEL: Record<TipoFeedbackDocumento, string> = {
  util: 'Foi útil',
  erro: 'Contém erro',
  desatualizado: 'Está desatualizado',
  precisa_revisao: 'Precisa de revisão',
  solicitacao_novo: 'Solicitação de conteúdo novo',
};

/** Secao 15: formatos que a Biblioteca guarda como anexo. */
export const MIMES_ANEXO_BIBLIOTECA: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

/** 50 MB: cabe um POP com fotos e um video curto de bancada; um scanner de laminas nao. */
export const TAMANHO_MAXIMO_ANEXO_BIBLIOTECA = 50 * 1024 * 1024;

/**
 * Secao 18: numeracao de versoes `1.0`, `1.1`, `2.0`.
 *
 * Revisao pequena avanca o menor; "alteracao relevante" (secao 17) avanca o
 * maior. Quem decide e o autor, no momento de abrir a versao.
 */
export function proximaVersao(atual: string | null, relevante: boolean): string {
  if (!atual) return '1.0';
  const [maiorTxt, menorTxt] = atual.split('.');
  const maior = Number(maiorTxt) || 1;
  const menor = Number(menorTxt) || 0;
  return relevante ? `${maior + 1}.0` : `${maior}.${menor + 1}`;
}

/** Secao 10: `POP-HIST-004`. */
export function codigoDocumento(tipo: TipoDocumento, categoria: CategoriaDocumento, sequencial: number): string {
  return `${SIGLA_TIPO_DOCUMENTO[tipo]}-${SIGLA_CATEGORIA_DOCUMENTO[categoria]}-${String(sequencial).padStart(3, '0')}`;
}
