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
 * Limiares de cor de um servico, em HORAS desde a entrada do material.
 *
 * Quarta revisao com o Hugo, sobre o mapa de exames que ele ja opera: "lá nos
 * cadastros eu posso alterar os prazos de exame. No citopatológico ele calcula
 * em horas: entre 0 e 24 fica verde, entre 24 e 48 amarelo, passou de 48
 * vermelho. O histopatológico são sete dias... de zero a três verde, três a
 * cinco amarelo, passou de cinco vermelho. E depois disso ele fica preto."
 *
 * Dois limiares, nao quatro faixas: verde e "antes do primeiro", e preto e
 * vencido - que ja e o `atrasado` calculado pela previsao, e nao por hora
 * decorrida. Nulo significa "nao configurado", e a contagem cai nos dias uteis
 * restantes.
 */
export interface LimiaresAlerta {
  /** Horas decorridas a partir das quais o caso fica em 'atencao' (amarelo). */
  atencaoHoras: number | null;
  /** Horas decorridas a partir das quais fica 'critico' (vermelho). */
  criticoHoras: number | null;
}

const HORA_EM_MS = 3_600_000;

/**
 * Alerta de prazo de um caso, com tres regras em ordem:
 *
 * 1. Vencido manda: passou da previsao, e 'atrasado' - seja o que for o
 *    tempo decorrido. E o "preto" do mapa do Hugo.
 * 2. Limiares do servico, quando configurados: horas desde a ENTRADA do
 *    material (nao desde o cadastro - segunda review).
 * 3. Sem limiares, os dias uteis que restam para a previsao, como antes.
 *
 * Centralizado aqui porque a mesma conta e feita na escrita do estado (M07) e
 * na leitura da Central: duas implementacoes divergiriam em uma semana.
 */
export function alertaDoCaso(dados: {
  entradaEm: Date | null;
  previsaoLiberacao: Date | null;
  agora: Date;
  limiares?: LimiaresAlerta | null;
  calendario?: CalendarioInstitucional;
}): AlertaPrazo {
  const { entradaEm, previsaoLiberacao, agora, limiares } = dados;

  if (previsaoLiberacao && agora > previsaoLiberacao) return 'atrasado';

  if (entradaEm && limiares && (limiares.atencaoHoras !== null || limiares.criticoHoras !== null)) {
    const horas = (agora.getTime() - entradaEm.getTime()) / HORA_EM_MS;
    if (limiares.criticoHoras !== null && horas >= limiares.criticoHoras) return 'critico';
    if (limiares.atencaoHoras !== null && horas >= limiares.atencaoHoras) return 'atencao';
    return 'normal';
  }

  if (previsaoLiberacao) {
    return alertaDePrazo(previsaoLiberacao, agora, dados.calendario ?? CALENDARIO_PADRAO);
  }

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
 * Funde janelas que se sobrepoem ou se encostam, resolvendo as abertas em
 * `agora`. Janela degenerada (fim <= inicio) sai fora: nao houve espera.
 *
 * A fusao e feita no instante bruto, e nao em dias uteis, porque a
 * sobreposicao e um fato de calendario real - duas pendencias abertas na mesma
 * tarde esperaram a MESMA tarde. A conversao para dias uteis vem depois, uma
 * vez por janela fundida.
 */
function unirJanelas(
  suspensoes: readonly JanelaSuspensao[],
  agora: Date,
): { inicio: Date; fim: Date }[] {
  const ordenadas = suspensoes
    .map((janela) => ({ inicio: janela.inicio, fim: janela.fim ?? agora }))
    .filter((janela) => janela.fim > janela.inicio)
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const unidas: { inicio: Date; fim: Date }[] = [];

  for (const janela of ordenadas) {
    const ultima = unidas[unidas.length - 1];

    // `<=` funde tambem as que apenas se encostam: entre elas nao houve um
    // instante de trabalho para devolver ao prazo.
    if (ultima && janela.inicio <= ultima.fim) {
      if (janela.fim > ultima.fim) ultima.fim = janela.fim;
    } else {
      unidas.push({ ...janela });
    }
  }

  return unidas;
}

/**
 * Recalcula a previsao empurrando-a pelos dias uteis em que o prazo esteve
 * suspenso. Suspensao ainda aberta conta ate `agora`.
 *
 * O que empurra o prazo e a UNIAO das janelas, nao a soma das duracoes. Um
 * caso pode ter varias pendencias com `suspendePrazo` ao mesmo tempo - cada
 * uma abre a sua janela, com seu proprio `origemId`, e nada impede que se
 * sobreponham. Somando, uma semana de espera com duas pendencias viraria duas
 * semanas de folga, e o indicador de "atraso laboratorial" do M10 passaria a
 * mentir a favor do laboratorio.
 */
export function aplicarSuspensoes(
  previsaoOriginal: Date,
  suspensoes: readonly JanelaSuspensao[],
  agora: Date,
  calendario: CalendarioInstitucional = CALENDARIO_PADRAO,
): Date {
  const diasSuspensos = unirJanelas(suspensoes, agora).reduce(
    (total, janela) => total + contarDiasUteis(janela.inicio, janela.fim, calendario),
    0,
  );

  return somarDiasUteis(previsaoOriginal, diasSuspensos, calendario);
}
