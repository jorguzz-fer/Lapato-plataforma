import type { AlertaPrazo } from './enums.js';

/**
 * Calculo de prazo em dias uteis (M01 secao 14 + M07).
 *
 * M01 define as regras (prazo por servico, por unidade, calendario institucional,
 * feriados, recessos, horario limite de recebimento). O M07 apenas aplica.
 *
 * M07: "distincao formal entre previsao estimada e prazo contratual/legal" -
 * quem chama decide qual dos dois esta calculando; esta funcao so conta dias.
 */

export interface CalendarioInstitucional {
  /** Datas nao uteis no formato 'AAAA-MM-DD' (feriados, recessos). */
  naoUteis: ReadonlySet<string>;
  /**
   * Dias da semana uteis, 0 = domingo ... 6 = sabado.
   * Padrao: segunda a sexta.
   */
  diasUteisDaSemana: ReadonlySet<number>;
}

export const CALENDARIO_PADRAO: CalendarioInstitucional = {
  naoUteis: new Set<string>(),
  diasUteisDaSemana: new Set([1, 2, 3, 4, 5]),
};

/** Chave 'AAAA-MM-DD' em UTC, para comparar com o calendario. */
function chaveData(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function ehDiaUtil(data: Date, calendario: CalendarioInstitucional): boolean {
  if (!calendario.diasUteisDaSemana.has(data.getUTCDay())) return false;
  return !calendario.naoUteis.has(chaveData(data));
}

/**
 * Soma `dias` dias uteis a partir de `inicio`.
 *
 * O dia de inicio nao conta: um prazo de 5 dias uteis aberto numa segunda vence
 * na segunda seguinte, nao na sexta.
 */
export function somarDiasUteis(
  inicio: Date,
  dias: number,
  calendario: CalendarioInstitucional = CALENDARIO_PADRAO,
): Date {
  if (dias <= 0) return new Date(inicio);

  const atual = new Date(inicio);
  let restantes = dias;

  // Limite defensivo: um calendario mal configurado (nenhum dia util) faria
  // este laco rodar para sempre.
  const maxIteracoes = dias * 10 + 366;
  let iteracoes = 0;

  while (restantes > 0) {
    if (++iteracoes > maxIteracoes) {
      throw new Error(
        'Nao foi possivel calcular o prazo: o calendario institucional nao tem dias uteis suficientes.',
      );
    }
    atual.setUTCDate(atual.getUTCDate() + 1);
    if (ehDiaUtil(atual, calendario)) restantes--;
  }

  return atual;
}

/** Conta os dias uteis entre duas datas, sem contar a data inicial. */
export function contarDiasUteis(
  inicio: Date,
  fim: Date,
  calendario: CalendarioInstitucional = CALENDARIO_PADRAO,
): number {
  if (fim <= inicio) return 0;

  const atual = new Date(inicio);
  let total = 0;

  while (true) {
    atual.setUTCDate(atual.getUTCDate() + 1);
    if (atual > fim) break;
    if (ehDiaUtil(atual, calendario)) total++;
  }

  return total;
}

/**
 * M07: nivel de alerta do prazo, para o indicador visual das filas.
 *
 * M07 exige que os indicadores "nao dependam exclusivamente de cores" - por
 * isso o retorno e um valor semantico, e o front acrescenta icone e rotulo.
 */
export function alertaDePrazo(
  previsao: Date,
  agora: Date,
  calendario: CalendarioInstitucional = CALENDARIO_PADRAO,
): AlertaPrazo {
  if (agora > previsao) return 'atrasado';

  const uteisRestantes = contarDiasUteis(agora, previsao, calendario);
  if (uteisRestantes <= 0) return 'critico';
  if (uteisRestantes === 1) return 'critico';
  if (uteisRestantes <= 2) return 'atencao';
  return 'normal';
}

/**
 * M07: suspensao de prazo. Uma pendencia aguardando o cliente pode suspender a
 * contagem; alguns SLAs legais nao podem ser suspensos, e isso e decidido pela
 * configuracao, nao aqui.
 */
export interface JanelaSuspensao {
  inicio: Date;
  /** Nulo enquanto a suspensao estiver aberta. */
  fim: Date | null;
}

/**
 * Recalcula a previsao empurrando-a pelos dias uteis em que o prazo esteve
 * suspenso. Suspensao ainda aberta conta ate `agora`.
 */
export function aplicarSuspensoes(
  previsaoOriginal: Date,
  suspensoes: readonly JanelaSuspensao[],
  agora: Date,
  calendario: CalendarioInstitucional = CALENDARIO_PADRAO,
): Date {
  const diasSuspensos = suspensoes.reduce((total, janela) => {
    const fim = janela.fim ?? agora;
    return total + contarDiasUteis(janela.inicio, fim, calendario);
  }, 0);

  return somarDiasUteis(previsaoOriginal, diasSuspensos, calendario);
}
