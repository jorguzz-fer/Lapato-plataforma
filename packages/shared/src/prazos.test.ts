import { test, describe, expect } from 'vitest';
import {
  CALENDARIO_PADRAO,
  alertaDePrazo,
  alertaDoCaso,
  aplicarSuspensoes,
  contarDiasUteis,
  ehDiaUtil,
  somarDiasUteis,
  type CalendarioInstitucional,
} from './prazos.js';

const utc = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

// 2026-08-10 e uma segunda-feira.
const SEGUNDA = utc('2026-08-10');
const SEXTA = utc('2026-08-14');
const SABADO = utc('2026-08-15');

describe('ehDiaUtil', () => {
  test('segunda a sexta sao uteis no calendario padrao', () => {
    expect(ehDiaUtil(SEGUNDA, CALENDARIO_PADRAO)).toBe(true);
    expect(ehDiaUtil(SEXTA, CALENDARIO_PADRAO)).toBe(true);
  });

  test('fim de semana nao e util', () => {
    expect(ehDiaUtil(SABADO, CALENDARIO_PADRAO)).toBe(false);
  });

  test('feriado do calendario institucional nao e util (M01 secao 14)', () => {
    const calendario: CalendarioInstitucional = {
      ...CALENDARIO_PADRAO,
      naoUteis: new Set(['2026-08-12']),
    };
    expect(ehDiaUtil(utc('2026-08-12'), calendario)).toBe(false);
  });
});

describe('somarDiasUteis', () => {
  test('o dia de inicio nao conta', () => {
    expect(somarDiasUteis(SEGUNDA, 1, CALENDARIO_PADRAO).toISOString().slice(0, 10)).toBe('2026-08-11');
  });

  test('prazo de 5 dias uteis aberto na segunda vence na segunda seguinte', () => {
    const venc = somarDiasUteis(SEGUNDA, 5, CALENDARIO_PADRAO);
    expect(venc.toISOString().slice(0, 10)).toBe('2026-08-17');
  });

  test('pula o fim de semana', () => {
    // Quinta + 2 uteis = segunda.
    const venc = somarDiasUteis(utc('2026-08-13'), 2, CALENDARIO_PADRAO);
    expect(venc.toISOString().slice(0, 10)).toBe('2026-08-17');
  });

  test('pula feriado institucional', () => {
    const calendario: CalendarioInstitucional = {
      ...CALENDARIO_PADRAO,
      naoUteis: new Set(['2026-08-11']),
    };
    const venc = somarDiasUteis(SEGUNDA, 1, calendario);
    expect(venc.toISOString().slice(0, 10)).toBe('2026-08-12');
  });

  test('prazo zero devolve a propria data', () => {
    expect(somarDiasUteis(SEGUNDA, 0).getTime()).toBe(SEGUNDA.getTime());
  });

  test('calendario sem dia util nenhum falha em vez de travar', () => {
    const impossivel: CalendarioInstitucional = {
      naoUteis: new Set(),
      diasUteisDaSemana: new Set(),
    };
    expect(() => somarDiasUteis(SEGUNDA, 1, impossivel)).toThrow(/calendario institucional/i);
  });
});

describe('contarDiasUteis', () => {
  test('conta apenas os dias uteis do intervalo', () => {
    // Segunda -> sexta = ter, qua, qui, sex = 4.
    expect(contarDiasUteis(SEGUNDA, SEXTA, CALENDARIO_PADRAO)).toBe(4);
  });

  test('intervalo invertido conta zero', () => {
    expect(contarDiasUteis(SEXTA, SEGUNDA, CALENDARIO_PADRAO)).toBe(0);
  });
});

describe('alertaDePrazo', () => {
  test('prazo vencido e atrasado', () => {
    expect(alertaDePrazo(SEGUNDA, SEXTA)).toBe('atrasado');
  });

  test('vencendo amanha e critico', () => {
    expect(alertaDePrazo(utc('2026-08-11'), SEGUNDA)).toBe('critico');
  });

  test('dois dias uteis de folga pede atencao', () => {
    expect(alertaDePrazo(utc('2026-08-12'), SEGUNDA)).toBe('atencao');
  });

  test('folga confortavel e normal', () => {
    expect(alertaDePrazo(utc('2026-08-20'), SEGUNDA)).toBe('normal');
  });
});

describe('aplicarSuspensoes', () => {
  /**
   * M07: uma pendencia aguardando o cliente suspende a contagem; a previsao
   * anda para a frente pelo tempo em que o laboratorio esteve impedido.
   */
  test('empurra a previsao pelos dias uteis suspensos', () => {
    const previsao = utc('2026-08-17');
    const nova = aplicarSuspensoes(
      previsao,
      [{ inicio: utc('2026-08-10'), fim: utc('2026-08-12') }], // 2 dias uteis
      utc('2026-08-13'),
    );
    expect(nova.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  test('suspensao ainda aberta conta ate agora', () => {
    const previsao = utc('2026-08-17');
    const nova = aplicarSuspensoes(
      previsao,
      [{ inicio: utc('2026-08-10'), fim: null }],
      utc('2026-08-12'), // 2 dias uteis decorridos
    );
    expect(nova.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  test('sem suspensao a previsao nao muda', () => {
    const previsao = utc('2026-08-17');
    const nova = aplicarSuspensoes(previsao, [], utc('2026-08-12'));
    expect(nova.getTime()).toBe(previsao.getTime());
  });

  /**
   * Um caso pode ter VARIAS pendencias com `suspendePrazo` ao mesmo tempo -
   * `suspenderPrazo` insere sem checar janela aberta, e cada pendencia tem seu
   * proprio `origemId`. O que conta e o tempo em que o laboratorio esteve
   * impedido, ou seja a UNIAO das janelas; somar as duracoes daria folga que
   * ninguem esperou.
   */
  test('duas pendencias no mesmo periodo contam o periodo uma vez', () => {
    const previsao = utc('2026-08-17');
    const janela = { inicio: utc('2026-08-10'), fim: utc('2026-08-12') }; // 2 dias uteis

    const uma = aplicarSuspensoes(previsao, [janela], utc('2026-08-13'));
    const duas = aplicarSuspensoes(previsao, [janela, { ...janela }], utc('2026-08-13'));

    expect(uma.toISOString().slice(0, 10)).toBe('2026-08-19');
    // A segunda pendencia nao acrescenta espera: o periodo e o mesmo.
    expect(duas.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  test('sobreposicao parcial conta a uniao, nao a soma', () => {
    const previsao = utc('2026-08-17');
    const nova = aplicarSuspensoes(
      previsao,
      [
        { inicio: utc('2026-08-10'), fim: utc('2026-08-12') }, // 11, 12
        { inicio: utc('2026-08-11'), fim: utc('2026-08-14') }, // 12, 13, 14
      ],
      utc('2026-08-17'),
    );

    // Uniao = (10, 14] = 11, 12, 13, 14 -> 4 dias uteis, nao 5.
    expect(nova.toISOString().slice(0, 10)).toBe('2026-08-21');
  });

  test('duas suspensoes abertas contam o periodo uma vez', () => {
    const previsao = utc('2026-08-17');
    const aberta = { inicio: utc('2026-08-10'), fim: null };

    const nova = aplicarSuspensoes(previsao, [aberta, { ...aberta }], utc('2026-08-12'));

    expect(nova.toISOString().slice(0, 10)).toBe('2026-08-19');
  });

  /**
   * Guarda contra o excesso oposto: janelas que NAO se encostam continuam
   * somando. Entre 11 (ter) e 13 (qui) o laboratorio voltou a trabalhar.
   */
  test('janelas separadas continuam somando', () => {
    const previsao = utc('2026-08-17');
    const nova = aplicarSuspensoes(
      previsao,
      [
        { inicio: utc('2026-08-10'), fim: utc('2026-08-11') }, // 11
        { inicio: utc('2026-08-13'), fim: utc('2026-08-14') }, // 14
      ],
      utc('2026-08-17'),
    );

    expect(nova.toISOString().slice(0, 10)).toBe('2026-08-19');
  });
});

describe('alertaDoCaso: a cor do mapa de exames (quarta revisão)', () => {
  /**
   * "No citopatológico ele calcula em horas: entre 0 e 24 fica verde, entre 24
   * e 48 amarelo, passou de 48 vermelho. O histopatológico são sete dias... de
   * zero a três verde, três a cinco amarelo. E depois disso ele fica preto."
   */
  const cito = { atencaoHoras: 24, criticoHoras: 48 };
  const entrada = new Date('2026-08-10T08:00:00Z');
  const previsao = new Date('2026-08-14T08:00:00Z');

  test('antes do primeiro limiar fica no prazo', () => {
    const alerta = alertaDoCaso({
      entradaEm: entrada,
      previsaoLiberacao: previsao,
      agora: new Date('2026-08-10T20:00:00Z'), // 12 h
      limiares: cito,
    });
    expect(alerta).toBe('normal');
  });

  test('passou de 24 h vira atenção; passou de 48 h vira crítico', () => {
    expect(
      alertaDoCaso({
        entradaEm: entrada,
        previsaoLiberacao: previsao,
        agora: new Date('2026-08-11T09:00:00Z'), // 25 h
        limiares: cito,
      }),
    ).toBe('atencao');

    expect(
      alertaDoCaso({
        entradaEm: entrada,
        previsaoLiberacao: previsao,
        agora: new Date('2026-08-12T09:00:00Z'), // 49 h
        limiares: cito,
      }),
    ).toBe('critico');
  });

  test('vencido manda: passar da previsão é atrasado, por mais cedo que seja', () => {
    const alerta = alertaDoCaso({
      entradaEm: new Date('2026-08-14T07:00:00Z'),
      previsaoLiberacao: previsao,
      agora: new Date('2026-08-14T09:00:00Z'), // 2 h de entrada, mas já venceu
      limiares: cito,
    });
    expect(alerta).toBe('atrasado');
  });

  test('sem limiares configurados, a conta volta a ser por dias úteis', () => {
    // Segunda-feira 10/8/2026 com previsão na terça: 1 dia útil restante.
    const alerta = alertaDoCaso({
      entradaEm: entrada,
      previsaoLiberacao: new Date('2026-08-11T08:00:00Z'),
      agora: new Date('2026-08-10T09:00:00Z'),
      limiares: { atencaoHoras: null, criticoHoras: null },
    });
    expect(alerta).toBe('critico');
  });

  test('um limiar só funciona sozinho: sem atenção, vai de verde a crítico', () => {
    const limiares = { atencaoHoras: null, criticoHoras: 48 };
    expect(
      alertaDoCaso({
        entradaEm: entrada,
        previsaoLiberacao: previsao,
        agora: new Date('2026-08-11T09:00:00Z'),
        limiares,
      }),
    ).toBe('normal');
    expect(
      alertaDoCaso({
        entradaEm: entrada,
        previsaoLiberacao: previsao,
        agora: new Date('2026-08-12T09:00:00Z'),
        limiares,
      }),
    ).toBe('critico');
  });

  test('caso sem entrada registrada não inventa cor pela hora', () => {
    const alerta = alertaDoCaso({
      entradaEm: null,
      previsaoLiberacao: null,
      agora: new Date('2026-08-12T09:00:00Z'),
      limiares: cito,
    });
    expect(alerta).toBe('normal');
  });
});
