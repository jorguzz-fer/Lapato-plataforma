/**
 * M20 (parcial) - Financeiro padrao.
 *
 * O combinado da primeira review: "eu posso fazer o padrao - lancamentos,
 * entrada e saida, balanco, fluxo de caixa, essas coisas padroes" - com a
 * especificidade do setor entrando depois, quando a documentacao do modulo
 * chegar. A fatura nasce das Ordens de Servico DESPACHADAS: a cobranca nunca
 * sai de um caso solto, sai da ordem conferida.
 */

export const STATUS_FATURA = [
  /** Criada, agrupando OSs; ainda pode ser desfeita. */
  'aberta',
  /** Enviada ao cliente, com vencimento; vira contas a receber. */
  'emitida',
  'paga',
  'cancelada',
] as const;
export type StatusFatura = (typeof STATUS_FATURA)[number];

export const STATUS_FATURA_LABEL: Record<StatusFatura, string> = {
  aberta: 'Aberta',
  emitida: 'Emitida',
  paga: 'Paga',
  cancelada: 'Cancelada',
};

export const TIPO_LANCAMENTO = ['entrada', 'saida'] as const;
export type TipoLancamento = (typeof TIPO_LANCAMENTO)[number];

export const TIPO_LANCAMENTO_LABEL: Record<TipoLancamento, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
};

/**
 * Categorias sugeridas para lancamento manual. Sugestao, nao enum de banco:
 * o financeiro real inventa categoria nova toda semana, e um enum viraria
 * migration a cada conversa com a Roberta.
 */
export const CATEGORIAS_SUGERIDAS = [
  'Recebimento de fatura',
  'Insumos e reagentes',
  'Laboratório de apoio',
  'Logística e coleta',
  'Folha e honorários',
  'Impostos e taxas',
  'Infraestrutura',
  'Outros',
] as const;
