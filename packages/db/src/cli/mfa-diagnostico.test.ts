import { describe, expect, test } from 'vitest';
import * as TOTP from 'otpauth';
import { PERIODO_TOTP, diagnosticarCodigo } from './mfa-diagnostico.js';

const SEGREDO = new TOTP.Secret({ size: 20 }).base32;

function codigoEm(instante: Date): string {
  return new TOTP.TOTP({
    secret: TOTP.Secret.fromBase32(SEGREDO),
    period: PERIODO_TOTP,
  }).generate({ timestamp: instante.getTime() });
}

const AGORA = new Date('2026-08-27T12:00:00Z');

describe('diagnostico do segundo fator', () => {
  test('codigo do momento passaria no login', () => {
    expect(diagnosticarCodigo(SEGREDO, codigoEm(AGORA), AGORA)).toEqual({ tipo: 'aceito' });
  });

  test('espaco e tamanho errado sao recusados antes da conferencia', () => {
    expect(diagnosticarCodigo(SEGREDO, '123 456', AGORA).tipo).toBe('formato');
    expect(diagnosticarCodigo(SEGREDO, '12345', AGORA).tipo).toBe('formato');
    expect(diagnosticarCodigo(SEGREDO, 'abcdef', AGORA).tipo).toBe('formato');
  });

  /**
   * O caso que o comando existe para nomear: o codigo esta certo, o relogio e
   * que nao. Sem esta distincao, a tela e o operador veem "invalido" nos dois
   * casos e a conta acaba sendo resetada a toa.
   */
  test('relogio do servidor adiantado: o codigo do celular ficou para tras', () => {
    // O aplicativo, com a hora certa, gerou o codigo 3 minutos "atras" na
    // contagem do servidor, porque o servidor correu demais.
    const doCelular = codigoEm(new Date(AGORA.getTime() - 180_000));
    const veredito = diagnosticarCodigo(SEGREDO, doCelular, AGORA);

    expect(veredito.tipo).toBe('desalinhado');
    if (veredito.tipo !== 'desalinhado') return;
    expect(veredito.segundos).toBe(-180);
  });

  test('relogio do servidor atrasado tem o sinal oposto', () => {
    const doCelular = codigoEm(new Date(AGORA.getTime() + 120_000));
    const veredito = diagnosticarCodigo(SEGREDO, doCelular, AGORA);

    expect(veredito.tipo).toBe('desalinhado');
    if (veredito.tipo !== 'desalinhado') return;
    expect(veredito.segundos).toBe(120);
  });

  test('segredo diferente nao confere em nenhum momento proximo', () => {
    const outro = new TOTP.Secret({ size: 20 }).base32;
    const doOutro = new TOTP.TOTP({
      secret: TOTP.Secret.fromBase32(outro),
      period: PERIODO_TOTP,
    }).generate({ timestamp: AGORA.getTime() });

    expect(diagnosticarCodigo(SEGREDO, doOutro, AGORA).tipo).toBe('invalido');
  });

  /** Meio minuto e a folga que o login ja dava; nao pode virar "desalinhado". */
  test('um passo de diferenca continua sendo aceito, como no login', () => {
    const umPassoAtras = codigoEm(new Date(AGORA.getTime() - PERIODO_TOTP * 1000));
    expect(diagnosticarCodigo(SEGREDO, umPassoAtras, AGORA).tipo).toBe('aceito');
  });
});
