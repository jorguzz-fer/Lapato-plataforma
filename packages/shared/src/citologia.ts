/**
 * M12 - Citopatologia: vocabulario estruturado do modulo.
 *
 * DIRETRIZES secao 8.4 e M12 secao 3: o M12 e **proprietario** das estruturas
 * especificas da citologia - tipos de material, adequacao, celularidade, fundo,
 * populacoes celulares, criterios citomorfologicos, padroes inflamatorios,
 * agentes. Elas nao sao tabela mestre do M01 porque nao sao configuracao
 * institucional: sao a linguagem do modulo, e mudar uma delas muda o que o
 * sistema sabe representar, nao como a instituicao o usa.
 *
 * O que a instituicao ajusta continua no M01 (coloracoes, orgaos, servicos).
 *
 * M12 secao 145: "o LAPATO nao devera tratar a citologia como uma versao
 * simplificada da histopatologia. Ela devera possuir sua propria linguagem e
 * sua propria logica."
 */

/** M12 secao 5: modalidades de coleta. */
export const TIPO_COLETA_CITOLOGICA = [
  { chave: 'paaf', rotulo: 'PAAF (punção aspirativa por agulha fina)', grupo: 'Aspirativa' },
  { chave: 'punção_nao_aspirativa', rotulo: 'Punção não aspirativa', grupo: 'Aspirativa' },
  { chave: 'imprint', rotulo: 'Imprint', grupo: 'Contato' },
  { chave: 'squash', rotulo: 'Squash', grupo: 'Contato' },
  { chave: 'escovado', rotulo: 'Escovado', grupo: 'Esfoliativa' },
  { chave: 'swab', rotulo: 'Swab', grupo: 'Esfoliativa' },
  { chave: 'raspado', rotulo: 'Raspado', grupo: 'Esfoliativa' },
  { chave: 'liquido_cavitario', rotulo: 'Líquido cavitário', grupo: 'Líquidos' },
  { chave: 'urina', rotulo: 'Urina', grupo: 'Líquidos' },
  { chave: 'liquor', rotulo: 'Líquido cefalorraquidiano', grupo: 'Líquidos' },
  { chave: 'lavado', rotulo: 'Lavado', grupo: 'Lavados' },
  { chave: 'preparacao_especial', rotulo: 'Preparação especial', grupo: 'Outras' },
] as const;

/**
 * M12 secao 10: motivos da limitacao.
 *
 * A secao existe para impedir que "adequacao" vire um rotulo solto: registrar
 * POR QUE a amostra limita a interpretacao e o que alimenta o indicador de
 * qualidade pre-analitica por cliente e por metodo de coleta (secoes 119-120).
 */
export const MOTIVO_LIMITACAO_CITOLOGICA = [
  'baixa celularidade',
  'excesso de sangue',
  'degeneração celular',
  'ausência da população-alvo',
  'material espesso',
  'lise celular',
  'contaminação',
  'número reduzido de lâminas',
  'artefato de preparação',
  'material exclusivamente necrótico',
  'material exclusivamente inflamatório',
  'preparação inadequada',
] as const;

/** M12 secao 16: multiplos componentes coexistem. */
export const FUNDO_PREPARACAO = [
  'limpo',
  'proteináceo',
  'hemorrágico',
  'necrótico',
  'mucinoso',
  'inflamatório',
  'granular',
  'lipídico',
  'mineralizado',
  'debris celulares',
  'material extracelular',
] as const;

/** M12 secao 20: matriz extracelular - relevante na caracterizacao de neoplasias. */
export const MATERIAL_EXTRACELULAR = [
  'colágeno',
  'matriz mixoide',
  'matriz condroide',
  'osteoide',
  'material mucinoso',
  'material amorfo',
  'material fibrilar',
] as const;

/**
 * M12 secoes 21-22: populacoes celulares.
 *
 * `indeterminada` nao e falta de preenchimento - e resposta valida e prevista:
 * "a classificacao nao devera obrigar o patologista a decidir precocemente a
 * origem", o que importa em neoplasias pouco diferenciadas.
 */
export const POPULACAO_CELULAR = [
  'epitelial',
  'mesenquimal',
  'células redondas',
  'inflamatória',
  'histiocítica',
  'linfoide',
  'melanocítica',
  'indiferenciada',
  'indeterminada',
] as const;

/** M12 secao 27: criterios gerais de malignidade. */
export const CRITERIO_MALIGNIDADE = [
  'anisocitose',
  'anisocariose',
  'aumento da relação N:C',
  'macrocariose',
  'multinucleação',
  'nucléolos proeminentes',
  'nucléolos múltiplos',
  'nucléolos angulares',
  'cromatina grosseira',
  'pleomorfismo',
  'mitoses atípicas',
  'moldagem nuclear',
  'células gigantes bizarras',
] as const;

/** M12 secao 30. */
export const FREQUENCIA_MITOSES = [
  'ausentes',
  'raras',
  'ocasionais',
  'frequentes',
  'atípicas',
] as const;

/** M12 secao 32. */
export const TIPO_INFLAMACAO = [
  'neutrofílica',
  'piogranulomatosa',
  'granulomatosa',
  'linfocítica',
  'plasmocitária',
  'linfoplasmocitária',
  'eosinofílica',
  'mista',
  'supurativa',
  'séptica',
] as const;

/** M12 secao 43. */
export const GRUPO_AGENTE = [
  'bactérias',
  'fungos',
  'protozoários',
  'parasitas',
  'outro organismo',
] as const;

/** M12 secao 44. */
export const LOCALIZACAO_AGENTE = [
  'extracelulares',
  'intracelulares',
  'em neutrófilos',
  'em macrófagos',
  'aderidos às células',
  'associados à necrose',
] as const;

/**
 * M12 secao 46: a leitura do achado bacteriano e INTERPRETATIVA.
 *
 * "O sistema devera permitir diferenciar: provavel agente associado a
 * inflamacao; bacteria presente sem evidencia de significancia; possivel
 * contaminacao. Essa diferenciacao devera ser interpretativa, nao automatizada."
 * Por isso e campo do patologista, e nao regra derivada da presenca do agente.
 */
export const SIGNIFICANCIA_AGENTE = [
  'provável agente associado à inflamação',
  'presente sem evidência de significância',
  'possível contaminação',
] as const;

/**
 * M12 secao 65: terminologia do diagnostico citologico.
 *
 * A propria secao diz que a terminologia e configuravel conforme politica
 * institucional; esta lista e o ponto de partida, nao a lei.
 */
export const CERTEZA_DIAGNOSTICO_CITOLOGICO = [
  'definitivo',
  'compatível com',
  'sugestivo de',
  'indicativo de',
  'suspeito para',
  'inconclusivo',
  'não diagnóstico',
] as const;

/** M12 secao 67: limitacoes explicitas. */
export const LIMITACAO_CITOLOGICA = [
  'baixa celularidade',
  'ausência de arquitetura tecidual',
  'impossibilidade de avaliar invasão',
  'impossibilidade de avaliar margens',
  'diferenciação limitada',
  'necessidade de histopatologia',
] as const;

export type TipoColetaCitologica = (typeof TIPO_COLETA_CITOLOGICA)[number]['chave'];
export type FundoPreparacao = (typeof FUNDO_PREPARACAO)[number];
export type PopulacaoCelular = (typeof POPULACAO_CELULAR)[number];
export type CriterioMalignidade = (typeof CRITERIO_MALIGNIDADE)[number];
export type GrupoAgente = (typeof GRUPO_AGENTE)[number];
