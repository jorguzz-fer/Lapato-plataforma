/**
 * M20 (parcial) - Ordem de Servico.
 *
 * O modelo veio da primeira review com o laboratorio, calcado na rotina que
 * eles ja praticam: a OS nasce quando o material foi CONFERIDO no recebimento
 * (quantidades contadas, divergencias anotadas), acompanha o caso pelo
 * processo inteiro, e no fim alguem confere se tudo que ela lista foi de fato
 * executado. So a OS conferida e despachada pode virar fatura - a cobranca
 * nunca nasce de um caso solto, nasce da ordem.
 *
 * O preco de cada item e um RETRATO do momento da criacao. M01: alteracoes de
 * configuracao nao retroagem - mudar o preco do servico amanha nao pode mudar
 * o valor de uma OS aberta ontem. Por isso o item guarda `valorUnitario`
 * copiado, nunca referencia o preco vigente.
 */

export const STATUS_ORDEM_SERVICO = [
  /** Nasceu no recebimento; itens ainda editaveis. */
  'aberta',
  /** Alguem verificou que tudo que a OS lista foi executado. */
  'conferida',
  /** Saiu da operacao; pronta para faturamento. */
  'despachada',
  /** Ja incluida numa fatura (M20). */
  'faturada',
  'cancelada',
] as const;
export type StatusOrdemServico = (typeof STATUS_ORDEM_SERVICO)[number];

export const STATUS_ORDEM_LABEL: Record<StatusOrdemServico, string> = {
  aberta: 'Aberta',
  conferida: 'Conferida',
  despachada: 'Despachada',
  faturada: 'Faturada',
  cancelada: 'Cancelada',
};

/** Status em que os itens ainda podem ser alterados. */
export const ORDEM_EDITAVEL: readonly StatusOrdemServico[] = ['aberta'];

/**
 * Total de um item, em centavos de precisao decimal.
 *
 * Calculado, nunca gravado: um total armazenado diverge do (quantidade x
 * unitario - desconto) no primeiro update esquecido, e passa a valer o numero
 * errado com cara de oficial.
 */
export function totalDoItem(item: {
  quantidade: string | number;
  valorUnitario: string | number;
  descontoPercentual: string | number;
}): number {
  const quantidade = Number(item.quantidade);
  const unitario = Number(item.valorUnitario);
  const desconto = Number(item.descontoPercentual);
  const bruto = quantidade * unitario;
  const total = bruto * (1 - desconto / 100);
  // Arredonda em centavos, como a fatura vai arredondar.
  return Math.round(total * 100) / 100;
}

export function totalDaOrdem(
  itens: Array<{
    quantidade: string | number;
    valorUnitario: string | number;
    descontoPercentual: string | number;
  }>,
): number {
  const soma = itens.reduce((acc, item) => acc + totalDoItem(item), 0);
  return Math.round(soma * 100) / 100;
}

/** Formata em reais para exibicao (a API trafega strings decimais). */
export function formatarReais(valor: string | number): string {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
