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
 * A ordem dos grupos e a ordem canonica da frase: "Fragmento pardo, de
 * consistencia firme, superficie irregular, bem delimitado; ao corte,
 * aspecto solido e homogeneo."
 */
export const GRUPOS_DESCRITORES_MACRO: ReadonlyArray<{
  chave: string;
  rotulo: string;
  /** Conector usado na composicao do texto corrido. */
  conector: string;
  opcoes: readonly string[];
}> = [
  {
    chave: 'cor',
    rotulo: 'Cor',
    conector: 'de coloração',
    opcoes: [
      'esbranquiçada',
      'acinzentada',
      'pardo-acastanhada',
      'avermelhada',
      'enegrecida',
      'amarelada',
      'vinhosa',
      'variegada',
    ],
  },
  {
    chave: 'consistencia',
    rotulo: 'Consistência',
    conector: 'de consistência',
    opcoes: ['macia', 'firme', 'elástica', 'friável', 'endurecida', 'flutuante', 'gelatinosa'],
  },
  {
    chave: 'superficie',
    rotulo: 'Superfície',
    conector: 'com superfície',
    opcoes: ['lisa', 'irregular', 'nodular', 'ulcerada', 'brilhante', 'opaca', 'capsulada'],
  },
  {
    chave: 'forma',
    rotulo: 'Forma',
    conector: 'de forma',
    opcoes: ['nodular', 'ovalada', 'alongada', 'irregular', 'pediculada', 'séssil'],
  },
  {
    chave: 'delimitacao',
    rotulo: 'Delimitação',
    conector: '',
    opcoes: ['bem delimitada', 'mal delimitada', 'encapsulada', 'infiltrativa'],
  },
  {
    chave: 'corte',
    rotulo: 'Ao corte',
    conector: 'ao corte, com aspecto',
    opcoes: [
      'sólido e homogêneo',
      'sólido e heterogêneo',
      'cístico',
      'multilobulado',
      'hemorrágico',
      'necrótico',
      'calcificado',
    ],
  },
] as const;

/**
 * Composicao deterministica do texto corrido - o modo que funciona SEM IA
 * (M17 secao 110). O Copiloto, quando disponivel, lapida esta base; quando
 * nao, ela e o resultado final, e ja e uma frase publicavel.
 */
export function comporDescricaoMacro(
  selecoes: Record<string, string[]>,
  medidas?: { comprimentoCm?: number; larguraCm?: number; alturaCm?: number; pesoG?: number },
): string {
  const partes: string[] = [];

  for (const grupo of GRUPOS_DESCRITORES_MACRO) {
    const escolhidos = selecoes[grupo.chave]?.filter((s) => s.trim() !== '') ?? [];
    if (escolhidos.length === 0) continue;
    const lista =
      escolhidos.length === 1
        ? escolhidos[0]
        : `${escolhidos.slice(0, -1).join(', ')} e ${escolhidos[escolhidos.length - 1]}`;
    partes.push(grupo.conector ? `${grupo.conector} ${lista}` : String(lista));
  }

  let frase = partes.length > 0 ? `Fragmento de tecido ${partes.join(', ')}.` : '';

  if (medidas) {
    const dimensoes = [medidas.comprimentoCm, medidas.larguraCm, medidas.alturaCm]
      .filter((m): m is number => m != null && m > 0)
      .map((m) => m.toLocaleString('pt-BR', { minimumFractionDigits: 1 }));
    const trechos: string[] = [];
    if (dimensoes.length > 0) trechos.push(`Mede ${dimensoes.join(' × ')} cm`);
    if (medidas.pesoG != null && medidas.pesoG > 0) {
      trechos.push(`pesa ${medidas.pesoG.toLocaleString('pt-BR')} g`);
    }
    if (trechos.length > 0) {
      frase = `${frase}${frase ? ' ' : ''}${trechos.join(' e ')}.`;
    }
  }

  return frase.trim();
}
