/**
 * M08 - vocabulario da descricao rapida ("bloquinhos").
 *
 * Pedido da primeira review: as opcoes da bancada aparecem pre-carregadas como
 * botoes, quem descreve so marca, e o texto corrido nasce no final - "e muito
 * mais rapido do que esse formato" de digitar tudo. As listas cobrem o feijao
 * com arroz da macroscopia veterinaria; o que faltar entra na hora pelo campo
 * livre de cada grupo, e a curadoria do vocabulario por instituicao (M01)
 * chega junto com a documentacao definitiva do modulo.
 *
 * O vocabulario e a ordem dos grupos vem da bancada que o dono do produto ja
 * opera (Alchemy Pet): caracteristica -> cor -> consistencia -> aparencia
 * externa -> forma -> delimitacao -> ao corte -> representacao.
 *
 * **Rotulo e texto sao coisas diferentes.** O bloquinho mostra o rotulo curto
 * que o patologista procura com o olho ("Marrom", "Nodulectomia"); a frase
 * recebe o `texto`, que concorda em genero com o conector do grupo ("de
 * coloracao acastanhada", "Fragmento de nodulectomia"). Sem essa separacao a
 * frase sai com erro de concordancia ou o bloquinho vira uma frase inteira.
 */

export interface OpcaoDescritor {
  /** O que aparece no bloquinho. Curto: e lido de relance. */
  rotulo: string;
  /** O que entra na frase, ja concordando com o conector do grupo. */
  texto: string;
  /** Amostra de cor do bloquinho - so no grupo COR, onde a cor E o dado. */
  amostra?: string;
}

/**
 * Onde o grupo entra na frase.
 *
 * - `nucleo`: e o sujeito ("Fragmento **cutaneo**"). Sem ele, "Fragmento de tecido".
 * - `oracao`: entra na lista separada por virgula, atras do conector.
 * - `fecho`: vira frase propria depois das medidas.
 */
export type PapelDoGrupo = 'nucleo' | 'oracao' | 'fecho';

export interface GrupoDescritores {
  chave: string;
  rotulo: string;
  /** Conector usado na composicao do texto corrido. */
  conector: string;
  papel: PapelDoGrupo;
  opcoes: readonly OpcaoDescritor[];
}

/**
 * "Todo o material incluido" nao e so texto: e o mesmo fato que o campo
 * `materialTotalmenteIncluido` da ficha, que o M18 le para saber se sobra
 * remanescente para a Bioteca. A tela amarra os dois neste identificador para
 * que a frase nunca contradiga o dado gravado.
 */
export const TEXTO_TODO_MATERIAL = 'todo o material incluído';

export const GRUPOS_DESCRITORES_MACRO: readonly GrupoDescritores[] = [
  {
    chave: 'caracteristica',
    rotulo: 'Característica',
    conector: '',
    papel: 'nucleo',
    opcoes: [
      { rotulo: 'Cutâneo', texto: 'cutâneo' },
      { rotulo: 'Não cutâneo', texto: 'não cutâneo' },
      { rotulo: 'Subcutâneo', texto: 'subcutâneo' },
      { rotulo: 'Nodulectomia', texto: 'de nodulectomia' },
      { rotulo: 'Órgão', texto: 'de órgão' },
      { rotulo: 'Amputação', texto: 'de amputação' },
    ],
  },
  {
    chave: 'cor',
    rotulo: 'Cor',
    conector: 'de coloração',
    papel: 'oracao',
    opcoes: [
      { rotulo: 'Branco', texto: 'esbranquiçada', amostra: '#ffffff' },
      { rotulo: 'Bege', texto: 'bege', amostra: '#e7d7b7' },
      { rotulo: 'Amarelo', texto: 'amarelada', amostra: '#eab308' },
      { rotulo: 'Marrom', texto: 'acastanhada', amostra: '#6f4426' },
      { rotulo: 'Pardo', texto: 'pardo-acastanhada', amostra: '#8b6b4a' },
      { rotulo: 'Preto', texto: 'enegrecida', amostra: '#17161a' },
      { rotulo: 'Cinza', texto: 'acinzentada', amostra: '#9aa2ae' },
      { rotulo: 'Vermelho', texto: 'avermelhada', amostra: '#c02626' },
      { rotulo: 'Vinhoso', texto: 'vinhosa', amostra: '#7a1730' },
      { rotulo: 'Variegado', texto: 'variegada' },
    ],
  },
  {
    chave: 'consistencia',
    rotulo: 'Consistência',
    conector: 'de consistência',
    papel: 'oracao',
    opcoes: [
      { rotulo: 'Macio', texto: 'macia' },
      { rotulo: 'Firme', texto: 'firme' },
      { rotulo: 'Duro', texto: 'dura' },
      { rotulo: 'Elástico', texto: 'elástica' },
      { rotulo: 'Fibroelástico', texto: 'fibroelástica' },
      { rotulo: 'Friável', texto: 'friável' },
      { rotulo: 'Cístico (fluído)', texto: 'cística, com conteúdo fluido' },
      { rotulo: 'Untuoso', texto: 'untuosa' },
      { rotulo: 'Endurecido', texto: 'endurecida' },
      { rotulo: 'Flutuante', texto: 'flutuante' },
      { rotulo: 'Gelatinoso', texto: 'gelatinosa' },
    ],
  },
  {
    chave: 'aparencia',
    rotulo: 'Aparência (externo)',
    conector: 'com superfície',
    papel: 'oracao',
    opcoes: [
      { rotulo: 'Lisa', texto: 'lisa' },
      { rotulo: 'Irregular', texto: 'irregular' },
      { rotulo: 'Regular', texto: 'regular' },
      { rotulo: 'Nodular', texto: 'nodular' },
      { rotulo: 'Ulcerada', texto: 'ulcerada' },
      { rotulo: 'Não ulcerada', texto: 'não ulcerada' },
      { rotulo: 'Alopécica', texto: 'alopécica' },
      { rotulo: 'Verrucosa', texto: 'verrucosa' },
      { rotulo: 'Brilhante', texto: 'brilhante' },
      { rotulo: 'Opaca', texto: 'opaca' },
      { rotulo: 'Capsulada', texto: 'capsulada' },
    ],
  },
  {
    chave: 'forma',
    rotulo: 'Forma',
    conector: 'de forma',
    papel: 'oracao',
    opcoes: [
      { rotulo: 'Nodular', texto: 'nodular' },
      { rotulo: 'Ovalada', texto: 'ovalada' },
      { rotulo: 'Alongada', texto: 'alongada' },
      { rotulo: 'Irregular', texto: 'irregular' },
      { rotulo: 'Pediculada', texto: 'pediculada' },
      { rotulo: 'Séssil', texto: 'séssil' },
      { rotulo: 'Elevada', texto: 'elevada' },
    ],
  },
  {
    chave: 'delimitacao',
    rotulo: 'Delimitação',
    conector: '',
    papel: 'oracao',
    opcoes: [
      // Concordam com "Fragmento", que e o sujeito da frase - e nao com um
      // substantivo de conector, porque este grupo nao tem conector.
      { rotulo: 'Bem delimitado', texto: 'bem delimitado' },
      { rotulo: 'Mal delimitado', texto: 'mal delimitado' },
      { rotulo: 'Encapsulado', texto: 'encapsulado' },
      { rotulo: 'Infiltrativo', texto: 'infiltrativo' },
    ],
  },
  {
    chave: 'corte',
    rotulo: 'Ao corte (nódulo)',
    conector: 'ao corte, com aspecto',
    papel: 'oracao',
    opcoes: [
      { rotulo: 'Sólido', texto: 'sólido' },
      { rotulo: 'Cístico', texto: 'cístico' },
      { rotulo: 'Homogêneo', texto: 'homogêneo' },
      { rotulo: 'Heterogêneo', texto: 'heterogêneo' },
      { rotulo: 'Lobulado', texto: 'lobulado' },
      { rotulo: 'Hemorrágico', texto: 'hemorrágico' },
      { rotulo: 'Necrótico', texto: 'necrótico' },
      { rotulo: 'Calcificado', texto: 'calcificado' },
    ],
  },
  {
    chave: 'representacao',
    rotulo: 'Representação',
    conector: 'Representação:',
    papel: 'fecho',
    opcoes: [
      { rotulo: 'Todo o material', texto: TEXTO_TODO_MATERIAL },
      { rotulo: 'Fragmento representativo', texto: 'fragmento representativo' },
      { rotulo: 'Margens', texto: 'margens' },
      { rotulo: 'Linfonodo', texto: 'linfonodo' },
    ],
  },
] as const;

/** "a, b e c" - a enumeracao como se escreve, nao como se programa. */
function enumerar(itens: string[]): string {
  if (itens.length === 1) return itens[0]!;
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Composicao deterministica do texto corrido - o modo que funciona SEM IA
 * (M17 secao 110). O Copiloto, quando disponivel, lapida esta base; quando
 * nao, ela e o resultado final, e ja e uma frase publicavel.
 *
 * Aceita texto que nao esta em nenhuma lista: o "outro..." de cada grupo entra
 * aqui como qualquer outro descritor, porque o vocabulario da bancada nunca
 * estara completo e travar a composicao seria pior do que uma palavra fora da
 * curadoria.
 */
export function comporDescricaoMacro(
  selecoes: Record<string, string[]>,
  medidas?: { comprimentoCm?: number; larguraCm?: number; alturaCm?: number; pesoG?: number },
): string {
  const marcados = (chave: string) => (selecoes[chave] ?? []).filter((s) => s.trim() !== '');

  const nucleo: string[] = [];
  const oracoes: string[] = [];
  const fechos: string[] = [];

  for (const grupo of GRUPOS_DESCRITORES_MACRO) {
    const escolhidos = marcados(grupo.chave);
    if (escolhidos.length === 0) continue;
    const lista = enumerar(escolhidos);

    if (grupo.papel === 'nucleo') nucleo.push(lista);
    else if (grupo.papel === 'fecho') fechos.push(`${grupo.conector} ${lista}`.trim());
    else oracoes.push(grupo.conector ? `${grupo.conector} ${lista}` : lista);
  }

  const frases: string[] = [];

  if (nucleo.length > 0 || oracoes.length > 0) {
    const sujeito = nucleo.length > 0 ? `Fragmento ${enumerar(nucleo)}` : 'Fragmento de tecido';
    frases.push(oracoes.length > 0 ? `${sujeito} ${oracoes.join(', ')}.` : `${sujeito}.`);
  }

  if (medidas) {
    const dimensoes = [medidas.comprimentoCm, medidas.larguraCm, medidas.alturaCm]
      .filter((m): m is number => m != null && m > 0)
      .map((m) => m.toLocaleString('pt-BR', { minimumFractionDigits: 1 }));
    const trechos: string[] = [];
    if (dimensoes.length > 0) trechos.push(`Mede ${dimensoes.join(' × ')} cm`);
    if (medidas.pesoG != null && medidas.pesoG > 0) {
      trechos.push(`pesa ${medidas.pesoG.toLocaleString('pt-BR')} g`);
    }
    if (trechos.length > 0) frases.push(`${trechos.join(' e ')}.`);
  }

  for (const fecho of fechos) frases.push(`${fecho}.`);

  return frases.join(' ').trim();
}
