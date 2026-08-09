import { test, describe, expect } from 'vitest';
import {
  CALENDARIO_PADRAO,
  alertaDePrazo,
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
});
