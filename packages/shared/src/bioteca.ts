/**
 * M18 - Bioteca e Gestao de Acervo Biologico.
 *
 * O modulo e proprietario da **custodia fisica do material biologico
 * preservado** depois que ele foi gerado (secao 3): localizacao, armazenamento,
 * movimentacao, retirada, devolucao, reserva, emprestimo, condicao,
 * quantidade, disponibilidade, consumo e descarte.
 *
 * O que NAO pertence a ele, e por isso nao aparece neste vocabulario (secao
 * 112): produzir o bloco e a lamina (M09), diagnosticar (M11/M13), fotografar
 * (M16), o cadaver inteiro (M15), o transporte externo (M19) e a cobranca
 * (M20). O modulo recebe esses fatos dos modulos proprietarios.
 *
 * A distincao central com o M15 esta na secao 101: o M15 controla **o
 * cadaver**; o M18 controla **os materiais derivados ou preservados**. Sao
 * objetos fisicos diferentes e nao devem se misturar.
 */

/**
 * Tipos de material armazenavel (secao 6).
 *
 * A secao 11 e explicita: lamina citologica **nao devera ser tratada como
 * lamina histologica sem distincao** - a genealogia de uma vem da amostra
 * citologica, a da outra vem do bloco.
 */
export const TIPO_OBJETO_BIOLOGICO = [
  'tecido_fixado',
  'bloco_parafina',
  'lamina_histologica',
  'lamina_citologica',
  'cell_block',
  'tecido_congelado',
  'material_toxicologico',
  'material_molecular',
  'peca_anatomica',
  'especime_didatico',
  'outro',
] as const;
export type TipoObjetoBiologico = (typeof TIPO_OBJETO_BIOLOGICO)[number];

export const TIPO_OBJETO_BIOLOGICO_LABEL: Record<TipoObjetoBiologico, string> = {
  tecido_fixado: 'Tecido fixado',
  bloco_parafina: 'Bloco de parafina',
  lamina_histologica: 'Lâmina histológica',
  lamina_citologica: 'Lâmina citológica',
  cell_block: 'Cell block',
  tecido_congelado: 'Tecido congelado',
  material_toxicologico: 'Material toxicológico',
  material_molecular: 'Material molecular',
  peca_anatomica: 'Peça anatômica',
  especime_didatico: 'Espécime didático',
  outro: 'Outro',
};

/**
 * Tipos que exigem conservacao a frio.
 *
 * Base da regra da secao 86: "tecido congelado armazenado em equipamento
 * incompativel com sua regra" e um achado do Guardian, nao um detalhe.
 */
export const TIPOS_QUE_EXIGEM_FRIO: TipoObjetoBiologico[] = [
  'tecido_congelado',
  'material_molecular',
];

/**
 * Estados do objeto (secao 22).
 *
 * `esgotado` e `descartado` sao terminais mas **nao apagam o registro**: a
 * secao 53 diz que "o registro permanece historicamente disponivel". Um objeto
 * descartado continua respondendo "onde esteve, quem usou, quando saiu".
 *
 * `nao_localizado` e `perdido` sao estados distintos de proposito (secao 58):
 * o primeiro e o resultado de um inventario, o segundo e uma conclusao depois
 * da investigacao.
 */
export const STATUS_OBJETO_BIOLOGICO = [
  'disponivel',
  'arquivado',
  'reservado',
  'emprestado',
  'em_uso',
  'enviado',
  'aguardando_devolucao',
  'parcialmente_consumido',
  'proximo_esgotamento',
  'esgotado',
  'bloqueado',
  'nao_localizado',
  'perdido',
  'descartado',
] as const;
export type StatusObjetoBiologico = (typeof STATUS_OBJETO_BIOLOGICO)[number];

export const STATUS_OBJETO_BIOLOGICO_LABEL: Record<StatusObjetoBiologico, string> = {
  disponivel: 'Disponível',
  arquivado: 'Arquivado',
  reservado: 'Reservado',
  emprestado: 'Emprestado',
  em_uso: 'Em uso',
  enviado: 'Enviado',
  aguardando_devolucao: 'Aguardando devolução',
  parcialmente_consumido: 'Parcialmente consumido',
  proximo_esgotamento: 'Próximo do esgotamento',
  esgotado: 'Esgotado',
  bloqueado: 'Bloqueado',
  nao_localizado: 'Não localizado',
  perdido: 'Perdido',
  descartado: 'Descartado',
};

/**
 * Estados em que o objeto ocupa fisicamente a sua posicao no acervo.
 *
 * A secao 33 e a razao de esta lista existir: material retirado **nao
 * desaparece do sistema** - ele mantem a posicao de origem registrada, mas
 * deixa de ocupa-la. Por isso `em_uso` e `emprestado` estao fora daqui e a
 * posicao volta a contar como livre no mapa.
 */
export const STATUS_OBJETO_OCUPANDO_POSICAO: StatusObjetoBiologico[] = [
  'disponivel',
  'arquivado',
  'reservado',
  'parcialmente_consumido',
  'proximo_esgotamento',
  'bloqueado',
];

/** Estados terminais: o objeto saiu definitivamente do acervo utilizavel. */
export const STATUS_TERMINAIS: StatusObjetoBiologico[] = ['esgotado', 'descartado', 'perdido'];

/**
 * Condicao fisica (secao 23).
 *
 * Separada do status de proposito: um bloco pode estar `disponivel` e
 * `danificado` ao mesmo tempo, e as duas informacoes mudam decisoes
 * diferentes - a primeira diz se pode sair, a segunda diz se ainda serve.
 */
export const CONDICAO_OBJETO = [
  'integro',
  'adequado',
  'danificado',
  'quebrado',
  'descolado',
  'ilegivel',
  'deteriorado',
  'contaminado',
  'insuficiente',
  'esgotado',
] as const;
export type CondicaoObjeto = (typeof CONDICAO_OBJETO)[number];

export const CONDICAO_OBJETO_LABEL: Record<CondicaoObjeto, string> = {
  integro: 'Íntegro',
  adequado: 'Adequado',
  danificado: 'Danificado',
  quebrado: 'Quebrado',
  descolado: 'Descolado',
  ilegivel: 'Ilegível',
  deteriorado: 'Deteriorado',
  contaminado: 'Contaminado',
  insuficiente: 'Insuficiente',
  esgotado: 'Esgotado',
};

/**
 * Finalidade de uso, retirada ou reserva (secoes 28 e 30).
 *
 * A ordem desta lista **nao e cosmetica**: ela e a hierarquia da secao 29 -
 * "o uso diagnostico e pericial devera possuir prioridade sobre usos
 * secundarios como ensino e pesquisa". `prioridadeFinalidade()` le esta ordem.
 */
export const FINALIDADE_USO = [
  'diagnostico',
  'complementar',
  'pericia',
  'segunda_opiniao',
  'controle_qualidade',
  'ensino',
  'pesquisa',
] as const;
export type FinalidadeUso = (typeof FINALIDADE_USO)[number];

export const FINALIDADE_USO_LABEL: Record<FinalidadeUso, string> = {
  diagnostico: 'Diagnóstico',
  complementar: 'Exame complementar',
  pericia: 'Perícia',
  segunda_opiniao: 'Segunda opinião',
  controle_qualidade: 'Controle de qualidade',
  ensino: 'Ensino',
  pesquisa: 'Pesquisa',
};

/**
 * Prioridade da finalidade: menor numero, maior precedencia (secao 29).
 *
 * Usada pelo Guardian para a regra da secao 86: "material reservado para
 * pericia sendo solicitado para ensino" e um conflito, mas o inverso -
 * material reservado para ensino sendo requisitado para diagnostico - e
 * legitimo e nao deve gerar alerta.
 */
export function prioridadeFinalidade(finalidade: FinalidadeUso): number {
  return FINALIDADE_USO.indexOf(finalidade);
}

/** Finalidades que a secao 29 considera de uso secundario. */
export const FINALIDADES_SECUNDARIAS: FinalidadeUso[] = ['ensino', 'pesquisa'];

/**
 * Restricoes que acompanham o objeto (secao 85).
 *
 * Sao ortogonais ao status: um material `disponivel` com `nao_emprestar`
 * continua disponivel para uso interno e continua barrado para emprestimo.
 */
export const RESTRICAO_OBJETO = [
  'nao_emprestar',
  'nao_consumir',
  'nao_descartar',
  'confidencial',
  'restricao_pericial',
  'preservacao_especial',
] as const;
export type RestricaoObjeto = (typeof RESTRICAO_OBJETO)[number];

export const RESTRICAO_OBJETO_LABEL: Record<RestricaoObjeto, string> = {
  nao_emprestar: 'Não emprestar',
  nao_consumir: 'Não consumir',
  nao_descartar: 'Não descartar',
  confidencial: 'Confidencial',
  restricao_pericial: 'Restrição pericial',
  preservacao_especial: 'Preservação especial',
};

/**
 * Tipos de movimentacao (secoes 30-34, 82-83).
 *
 * A tabela e append-only: "o historico nao devera ser apagado" (secao 82) e
 * "correcoes de localizacao nao deverao apagar o historico anterior" (secao
 * 113). Corrigir e registrar um evento novo, nunca editar o antigo.
 */
export const TIPO_MOVIMENTACAO_OBJETO = [
  'arquivamento',
  'retirada',
  'devolucao',
  'transferencia',
  'emprestimo_saida',
  'emprestimo_retorno',
  'correcao_localizacao',
  'consumo',
  'mudanca_condicao',
  'inventario',
  'descarte',
] as const;
export type TipoMovimentacaoObjeto = (typeof TIPO_MOVIMENTACAO_OBJETO)[number];

export const TIPO_MOVIMENTACAO_OBJETO_LABEL: Record<TipoMovimentacaoObjeto, string> = {
  arquivamento: 'Arquivamento',
  retirada: 'Retirada',
  devolucao: 'Devolução',
  transferencia: 'Transferência',
  emprestimo_saida: 'Saída em empréstimo',
  emprestimo_retorno: 'Retorno de empréstimo',
  correcao_localizacao: 'Correção de localização',
  consumo: 'Consumo',
  mudanca_condicao: 'Mudança de condição',
  inventario: 'Inventário',
  descarte: 'Descarte',
};

/** Emprestimo interno x externo (secoes 35 e 36). O externo tem controle ampliado. */
export const TIPO_EMPRESTIMO = ['interno', 'externo'] as const;
export type TipoEmprestimo = (typeof TIPO_EMPRESTIMO)[number];

export const TIPO_EMPRESTIMO_LABEL: Record<TipoEmprestimo, string> = {
  interno: 'Interno',
  externo: 'Externo',
};

/**
 * Estados do emprestimo (secoes 38 e 39).
 *
 * `nao_devolvido` existe porque a secao 39 e taxativa: o sistema "nao devera
 * simplesmente encerrar o emprestimo" quando o material nao volta. Encerrar
 * sem devolucao apagaria a unica pista de onde o material esta.
 */
export const STATUS_EMPRESTIMO = [
  'aberto',
  'devolvido_parcial',
  'devolvido',
  'atrasado',
  'nao_devolvido',
] as const;
export type StatusEmprestimo = (typeof STATUS_EMPRESTIMO)[number];

export const STATUS_EMPRESTIMO_LABEL: Record<StatusEmprestimo, string> = {
  aberto: 'Aberto',
  devolvido_parcial: 'Devolvido parcialmente',
  devolvido: 'Devolvido',
  atrasado: 'Atrasado',
  nao_devolvido: 'Não devolvido',
};

/** Estados de emprestimo que ainda prendem o material fora do acervo. */
export const STATUS_EMPRESTIMO_ABERTOS: StatusEmprestimo[] = [
  'aberto',
  'devolvido_parcial',
  'atrasado',
  'nao_devolvido',
];

/** Divergencias de inventario (secao 56). */
export const DIVERGENCIA_INVENTARIO = [
  'nao_localizado',
  'posicao_incorreta',
  'nao_cadastrado',
  'condicao_divergente',
] as const;
export type DivergenciaInventario = (typeof DIVERGENCIA_INVENTARIO)[number];

export const DIVERGENCIA_INVENTARIO_LABEL: Record<DivergenciaInventario, string> = {
  nao_localizado: 'Não localizado na posição esperada',
  posicao_incorreta: 'Encontrado em posição incorreta',
  nao_cadastrado: 'Objeto não cadastrado identificado',
  condicao_divergente: 'Condição diferente da registrada',
};

/** Metodo de destinacao final (secao 52). */
export const METODO_DESCARTE = [
  'incineracao',
  'residuo_infectante',
  'residuo_quimico',
  'sepultamento',
  'devolucao_ao_tutor',
  'transferencia_institucional',
  'outro',
] as const;
export type MetodoDescarte = (typeof METODO_DESCARTE)[number];

export const METODO_DESCARTE_LABEL: Record<MetodoDescarte, string> = {
  incineracao: 'Incineração',
  residuo_infectante: 'Resíduo infectante',
  residuo_quimico: 'Resíduo químico',
  sepultamento: 'Sepultamento',
  devolucao_ao_tutor: 'Devolução ao tutor',
  transferencia_institucional: 'Transferência institucional',
  outro: 'Outro',
};

/**
 * Motivos de retencao ampliada (secao 48).
 *
 * "A justificativa devera ser registrada" - por isso e um vocabulario e nao um
 * booleano: prorrogar sem dizer por que transforma o prazo numa opiniao.
 */
export const MOTIVO_RETENCAO_AMPLIADA = [
  'litigio',
  'pericia',
  'pesquisa',
  'ensino',
  'interesse_cientifico',
  'solicitacao_responsavel',
  'outro',
] as const;
export type MotivoRetencaoAmpliada = (typeof MOTIVO_RETENCAO_AMPLIADA)[number];

export const MOTIVO_RETENCAO_AMPLIADA_LABEL: Record<MotivoRetencaoAmpliada, string> = {
  litigio: 'Litígio',
  pericia: 'Perícia',
  pesquisa: 'Pesquisa',
  ensino: 'Ensino',
  interesse_cientifico: 'Interesse científico',
  solicitacao_responsavel: 'Solicitação do responsável',
  outro: 'Outro',
};

/**
 * Prazo de retencao padrao em meses, por tipo (secao 46).
 *
 * Sao padroes de partida, nao lei: a secao 46 diz que "o prazo devera ser
 * configuravel" por instituicao. O calculo da data prevista de descarte
 * (secao 47) parte daqui quando nao ha politica propria cadastrada.
 */
export const RETENCAO_PADRAO_MESES: Record<TipoObjetoBiologico, number> = {
  tecido_fixado: 6,
  bloco_parafina: 120,
  lamina_histologica: 120,
  lamina_citologica: 60,
  cell_block: 120,
  tecido_congelado: 24,
  material_toxicologico: 12,
  material_molecular: 60,
  peca_anatomica: 60,
  especime_didatico: 240,
  outro: 12,
};

/**
 * Um objeto so pode ser descartado se nada o estiver segurando (secao 49).
 *
 * A funcao devolve o motivo do bloqueio, nao um booleano, porque a secao 50
 * exige que a lista de elegiveis diga **por que** cada material ficou de fora.
 */
export interface ContextoDescarte {
  status: StatusObjetoBiologico;
  restricoes: RestricaoObjeto[];
  temEmprestimoAberto: boolean;
  temReservaAtiva: boolean;
  retencaoAte: Date | null;
  agora: Date;
}

export function motivoDescarteBloqueado(contexto: ContextoDescarte): string | null {
  if (contexto.status === 'descartado') {
    return 'Este material já foi descartado.';
  }
  if (contexto.restricoes.includes('nao_descartar')) {
    return 'O material tem restrição "não descartar" registrada. Remova a restrição antes, com justificativa.';
  }
  if (contexto.restricoes.includes('restricao_pericial')) {
    return 'O material está sob restrição pericial. O descarte depende de liberação formal da perícia.';
  }
  if (contexto.temEmprestimoAberto) {
    return 'Há empréstimo em aberto para este material. Registre a devolução antes de destiná-lo.';
  }
  if (contexto.temReservaAtiva) {
    return 'O material está reservado. Cancele a reserva antes, ou aguarde o fim da vigência.';
  }
  if (contexto.retencaoAte && contexto.retencaoAte > contexto.agora) {
    return `O prazo de guarda vai até ${contexto.retencaoAte.toLocaleDateString('pt-BR')}. Antes disso, o descarte exige retenção revista com justificativa.`;
  }
  return null;
}

/**
 * Calcula a data prevista de descarte a partir do tipo (secao 47).
 *
 * Retorna `null` quando o material tem preservacao especial (secao 72): ali a
 * retencao e indefinida por decisao institucional, e inventar uma data seria
 * criar um vencimento que ninguem pediu.
 */
export function calcularRetencaoAte(
  tipo: TipoObjetoBiologico,
  arquivadoEm: Date,
  opcoes: { preservacaoEspecial?: boolean; mesesConfigurados?: number } = {},
): Date | null {
  if (opcoes.preservacaoEspecial) return null;
  const meses = opcoes.mesesConfigurados ?? RETENCAO_PADRAO_MESES[tipo];
  const data = new Date(arquivadoEm);
  data.setMonth(data.getMonth() + meses);
  return data;
}
