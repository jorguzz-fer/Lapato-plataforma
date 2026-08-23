/**
 * M14 - Necropsia.
 *
 * O modulo e proprietario da **investigacao necroscopica** (secao 3): exame
 * externo e interno, avaliacao por orgaos e sistemas, lesoes macroscopicas,
 * relacao entre lesoes, diagnosticos morfologicos, mapa fisiopatologico,
 * mecanismo terminal, causa mortis e conclusao.
 *
 * O que NAO pertence a ele (secao 162), e por isso nao aparece aqui: a gestao
 * fisica do cadaver (M15), o repositorio de imagens (M16), o processamento
 * histologico (M09), a cadeia de custodia forense (M24) e o versionamento
 * documental do laudo (M11).
 */

/**
 * Modalidade (secao 6). Modifica campos obrigatorios, documentacao, fotografia,
 * revisao e modelo de laudo (secao 7).
 */
export const MODALIDADE_NECROPSIA = [
  'diagnostica',
  'fotodocumentada',
  'forense',
  'parcial',
] as const;
export type ModalidadeNecropsia = (typeof MODALIDADE_NECROPSIA)[number];

export const MODALIDADE_NECROPSIA_LABEL: Record<ModalidadeNecropsia, string> = {
  diagnostica: 'Diagnóstica / hospitalar',
  fotodocumentada: 'Fotodocumentada',
  forense: 'Forense',
  parcial: 'Parcial ou direcionada',
};

/** Estado de conservacao do cadaver na abertura do exame (secao 24). */
export const CONSERVACAO_NECROPSIA = [
  'fresco',
  'refrigerado',
  'congelado_descongelado',
  'autolise_leve',
  'autolise_moderada',
  'autolise_acentuada',
  'decomposicao',
] as const;
export type ConservacaoNecropsia = (typeof CONSERVACAO_NECROPSIA)[number];

export const CONSERVACAO_NECROPSIA_LABEL: Record<ConservacaoNecropsia, string> = {
  fresco: 'Fresco',
  refrigerado: 'Refrigerado',
  congelado_descongelado: 'Congelado e descongelado',
  autolise_leve: 'Autólise leve',
  autolise_moderada: 'Autólise moderada',
  autolise_acentuada: 'Autólise acentuada',
  decomposicao: 'Decomposição',
};

/** Cavidades avaliadas no exame interno (secao 64). */
export const CAVIDADE_NECROPSIA = [
  'externo',
  'toracica',
  'abdominal',
  'pelvica',
  'craniana',
  'canal_vertebral',
  'articulacoes',
  'outra',
] as const;
export type CavidadeNecropsia = (typeof CAVIDADE_NECROPSIA)[number];

export const CAVIDADE_NECROPSIA_LABEL: Record<CavidadeNecropsia, string> = {
  externo: 'Exame externo',
  toracica: 'Cavidade torácica',
  abdominal: 'Cavidade abdominal',
  pelvica: 'Cavidade pélvica',
  craniana: 'Cavidade craniana',
  canal_vertebral: 'Canal vertebral',
  articulacoes: 'Articulações',
  outra: 'Outra',
};

/**
 * Estado do exame de cada orgao (secoes 70, 71 e 163).
 *
 * A regra que da nome a este enum e literal na secao 163: **"nao examinado"
 * devera ser diferente de "sem alteracoes"**. Um orgao que ninguem abriu e um
 * buraco na investigacao; um orgao aberto e normal e um achado. Colapsar os
 * dois num campo vazio apaga a diferenca entre o que se sabe e o que nao se
 * olhou - e e sobre isso que a conclusao vai se apoiar.
 */
export const ESTADO_EXAME_ORGAO = ['sem_alteracoes', 'alterado', 'nao_examinado'] as const;
export type EstadoExameOrgao = (typeof ESTADO_EXAME_ORGAO)[number];

export const ESTADO_EXAME_ORGAO_LABEL: Record<EstadoExameOrgao, string> = {
  sem_alteracoes: 'Sem alterações',
  alterado: 'Alterado',
  nao_examinado: 'Não examinado',
};

/**
 * Classificacao funcional da lesao (secao 75).
 *
 * A secao 97 diz por que ela existe: "essa separacao sera fundamental para
 * evitar que todo diagnostico seja tratado como causal". Nem toda alteracao
 * encontrada participou da morte - e `post_mortem` e `artefato` sao os dois
 * casos em que a alteracao nem sequer e uma lesao.
 */
export const CLASSIFICACAO_LESAO = [
  'processo_principal',
  'processo_secundario',
  'contribuinte',
  'incidental',
  'post_mortem',
  'artefato',
  'indeterminada',
] as const;
export type ClassificacaoLesao = (typeof CLASSIFICACAO_LESAO)[number];

export const CLASSIFICACAO_LESAO_LABEL: Record<ClassificacaoLesao, string> = {
  processo_principal: 'Processo principal',
  processo_secundario: 'Processo secundário',
  contribuinte: 'Condição contribuinte',
  incidental: 'Achado incidental',
  post_mortem: 'Alteração post mortem',
  artefato: 'Artefato',
  indeterminada: 'Indeterminada',
};

/** Classificacoes que participam da cadeia causal da morte. */
export const CLASSIFICACOES_CAUSAIS: ClassificacaoLesao[] = [
  'processo_principal',
  'processo_secundario',
  'contribuinte',
];

/**
 * Mecanismo terminal (secao 107).
 *
 * A secao 108 e o ponto conceitual do modulo: **mecanismo nao e causa**. O
 * choque hipovolemico e como o animal morreu; a ruptura hepatica e por que.
 * Sao campos separados porque confundi-los e o erro classico do laudo
 * necroscopico.
 */
export const MECANISMO_TERMINAL = [
  'insuficiencia_respiratoria',
  'choque_hipovolemico',
  'choque_cardiogenico',
  'choque_distributivo',
  'choque_obstrutivo',
  'insuficiencia_circulatoria',
  'tamponamento',
  'hipertensao_intracraniana',
  'falencia_multiorganica',
  'outro',
  'indeterminado',
] as const;
export type MecanismoTerminal = (typeof MECANISMO_TERMINAL)[number];

export const MECANISMO_TERMINAL_LABEL: Record<MecanismoTerminal, string> = {
  insuficiencia_respiratoria: 'Insuficiência respiratória',
  choque_hipovolemico: 'Choque hipovolêmico',
  choque_cardiogenico: 'Choque cardiogênico',
  choque_distributivo: 'Choque distributivo',
  choque_obstrutivo: 'Choque obstrutivo',
  insuficiencia_circulatoria: 'Insuficiência circulatória',
  tamponamento: 'Tamponamento',
  hipertensao_intracraniana: 'Hipertensão intracraniana',
  falencia_multiorganica: 'Falência multiorgânica',
  outro: 'Outro',
  indeterminado: 'Indeterminado',
};

/**
 * Grau de certeza da causa mortis (secao 110).
 *
 * `indeterminada` nao e falha de preenchimento (secao 111): "em determinadas
 * situacoes, essa sera a conclusao cientificamente adequada". O sistema precisa
 * aceitar isso sem transformar em pendencia.
 */
export const GRAU_CERTEZA_CAUSA = [
  'estabelecida',
  'altamente_provavel',
  'provavel',
  'possivel',
  'indeterminada',
] as const;
export type GrauCertezaCausa = (typeof GRAU_CERTEZA_CAUSA)[number];

export const GRAU_CERTEZA_CAUSA_LABEL: Record<GrauCertezaCausa, string> = {
  estabelecida: 'Estabelecida',
  altamente_provavel: 'Altamente provável',
  provavel: 'Provável',
  possivel: 'Possível',
  indeterminada: 'Indeterminada',
};

/** Limitacoes do exame (secao 119). Entram no laudo, nao ficam implicitas. */
export const LIMITACAO_NECROPSIA = [
  'autolise',
  'congelamento',
  'decomposicao',
  'historico_insuficiente',
  'prontuario_indisponivel',
  'ausencia_toxicologia',
  'exame_parcial',
  'material_previamente_manipulado',
  'outra',
] as const;
export type LimitacaoNecropsia = (typeof LIMITACAO_NECROPSIA)[number];

export const LIMITACAO_NECROPSIA_LABEL: Record<LimitacaoNecropsia, string> = {
  autolise: 'Autólise',
  congelamento: 'Congelamento prévio',
  decomposicao: 'Decomposição',
  historico_insuficiente: 'Histórico insuficiente',
  prontuario_indisponivel: 'Prontuário indisponível',
  ausencia_toxicologia: 'Ausência de toxicologia',
  exame_parcial: 'Exame parcial ou direcionado',
  material_previamente_manipulado: 'Material previamente manipulado',
  outra: 'Outra',
};

/**
 * Tipo de relacao entre lesoes (secao 76).
 *
 * As relacoes formam o mapa fisiopatologico: ruptura esplenica → hemoperitonio
 * → hipovolemia → choque. E a diferenca entre uma lista de achados e um
 * raciocinio sobre a morte.
 */
export const RELACAO_LESAO = ['causou', 'contribuiu_para', 'associada_a'] as const;
export type RelacaoLesao = (typeof RELACAO_LESAO)[number];

export const RELACAO_LESAO_LABEL: Record<RelacaoLesao, string> = {
  causou: 'causou',
  contribuiu_para: 'contribuiu para',
  associada_a: 'associada a',
};
