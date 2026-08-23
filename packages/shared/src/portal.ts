import type { Etapa } from './enums.js';
import type { TipoEvento } from './eventos.js';

/**
 * M04 - Portal do Cliente: a tradução do interno para o externo.
 *
 * O modulo e explicito (secoes 11-12 e 55): o cliente nao ve a etapa tecnica.
 * "Aguardando inclusao em parafina" vira "Em processamento" - a informacao se
 * preserva, a complexidade interna nao vaza, e o cliente nao precisa aprender o
 * vocabulario do laboratorio para saber onde esta o exame dele.
 *
 * A traducao mora aqui, e nao no front do Portal, por duas razoes: o M07 e o
 * dono do estado (secao 12: "o Portal nao devera criar status proprios"), e
 * a mesma traducao serve a notificacao do M26 quando ela existir.
 */

export const STATUS_EXTERNO = [
  'aguardando_recebimento',
  'recebido',
  'em_analise_inicial',
  'em_processamento',
  'em_analise_diagnostica',
  'aguardando_informacao',
  'em_revisao',
  'laudo_disponivel',
  'cancelado',
] as const;
export type StatusExterno = (typeof STATUS_EXTERNO)[number];

export const STATUS_EXTERNO_LABEL: Record<StatusExterno, string> = {
  aguardando_recebimento: 'Aguardando recebimento',
  recebido: 'Recebido',
  em_analise_inicial: 'Em análise inicial',
  em_processamento: 'Em processamento',
  em_analise_diagnostica: 'Em análise diagnóstica',
  aguardando_informacao: 'Aguardando informação',
  em_revisao: 'Em revisão',
  laudo_disponivel: 'Laudo disponível',
  cancelado: 'Cancelado',
};

const MAPA: Record<Etapa, StatusExterno> = {
  aguardando_recebimento: 'aguardando_recebimento',
  recebido: 'recebido',
  // Triagem e macroscopia sao a analise inicial do material aos olhos de fora:
  // conferencia, descricao e amostragem acontecem antes de existir lamina.
  aguardando_triagem: 'em_analise_inicial',
  em_triagem: 'em_analise_inicial',
  aguardando_macroscopia: 'em_analise_inicial',
  em_macroscopia: 'em_analise_inicial',
  aguardando_processamento: 'em_processamento',
  em_processamento: 'em_processamento',
  laminas_disponiveis: 'em_processamento',
  aguardando_microscopia: 'em_analise_diagnostica',
  em_microscopia: 'em_analise_diagnostica',
  aguardando_complementar: 'em_processamento',
  aguardando_revisao: 'em_revisao',
  em_revisao: 'em_revisao',
  // Assinatura pendente ainda e revisao para quem espera: o documento existe,
  // mas nao esta liberado, e anunciar "concluido" seria promessa falsa.
  aguardando_assinatura: 'em_revisao',
  liberado: 'laudo_disponivel',
  arquivado: 'laudo_disponivel',
  cancelado: 'cancelado',
};

/**
 * Status externo do caso.
 *
 * `bloqueado` vence a etapa: quando o fluxo esta parado esperando o proprio
 * cliente (M10), dizer "em processamento" seria enganoso - e ele e justamente
 * quem pode destravar (M04 secao 13).
 */
export function statusExterno(etapa: Etapa, bloqueado = false): StatusExterno {
  if (bloqueado && etapa !== 'liberado' && etapa !== 'cancelado') {
    return 'aguardando_informacao';
  }
  return MAPA[etapa];
}

/**
 * Eventos que o cliente pode ver na linha do tempo (secoes 62-63).
 *
 * Lista de PERMITIDOS, nao de proibidos: evento novo nasce invisivel no Portal
 * ate alguem decidir o contrario. O inverso deixaria discussao diagnostica,
 * troca de patologista e erro tecnico interno vazarem por esquecimento.
 */
const EVENTOS_EXTERNOS: Partial<Record<TipoEvento, string>> = {
  'caso.criado': 'Exame cadastrado',
  'material.recebido': 'Material recebido',
  'triagem.concluida.apta': 'Material conferido',
  'triagem.concluida.ressalva': 'Material conferido com ressalva',
  'macroscopia.concluida': 'Análise inicial concluída',
  'lote.enviado': 'Processamento iniciado',
  'laminas.disponiveis': 'Processamento concluído',
  'microscopia.iniciada': 'Análise diagnóstica iniciada',
  'historico.complementado': 'Informação clínica enviada por você',
  'pendencia.criada': 'Informação solicitada',
  'pendencia.resolvida': 'Informação recebida',
  'laudo.liberado': 'Laudo liberado',
  'laudo.adendo_criado': 'Adendo emitido',
  'laudo.corrigido': 'Laudo corrigido',
  'caso.cancelado': 'Exame cancelado',
};

export function eventoExterno(tipo: TipoEvento): string | null {
  return EVENTOS_EXTERNOS[tipo] ?? null;
}
