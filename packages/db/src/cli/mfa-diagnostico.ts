import * as TOTP from 'otpauth';

/** Passo do TOTP, em segundos. O padrao do RFC 6238 e o de todo autenticador. */
export const PERIODO_TOTP = 30;

/**
 * Folga que o LOGIN aceita. Precisa acompanhar `codigoConfere` da API: se as
 * duas divergirem, o diagnostico passa a mentir sobre o que a tela faria.
 */
export const JANELA_LOGIN = 1;

/**
 * Folga do diagnostico: +-20 passos, ou dez minutos para cada lado.
 *
 * Larga de proposito. Aqui ela nao autentica ninguem - serve para MEDIR quanto
 * os relogios se afastaram, e uma janela apertada devolveria "invalido" sem
 * dizer o motivo, que e exatamente o problema que este comando existe para
 * resolver.
 */
export const JANELA_DIAGNOSTICO = 20;

export type VereditoMfa =
  /** Nem chegou a ser conferido: nao sao seis digitos. */
  | { tipo: 'formato' }
  /** Passaria no login agora. */
  | { tipo: 'aceito' }
  /**
   * O segredo esta certo, os relogios e que nao estao.
   * `segundos` e o desvio do SERVIDOR: positivo = atrasado, negativo = adiantado.
   */
  | { tipo: 'desalinhado'; segundos: number }
  /** Nao confere em nenhum momento proximo - e outro segredo. */
  | { tipo: 'invalido' };

/**
 * Separa as tres causas de "codigo invalido".
 *
 * Pura e sem banco de proposito: e a parte que precisa de teste, e um teste que
 * dependesse de conexao nao conseguiria simular um relogio fora de hora.
 */
export function diagnosticarCodigo(
  segredoBase32: string,
  codigo: string,
  agora: Date = new Date(),
): VereditoMfa {
  if (!/^\d{6}$/.test(codigo)) return { tipo: 'formato' };

  const totp = new TOTP.TOTP({
    secret: TOTP.Secret.fromBase32(segredoBase32),
    period: PERIODO_TOTP,
  });

  const timestamp = agora.getTime();

  const noLogin = totp.validate({ token: codigo, window: JANELA_LOGIN, timestamp });
  if (noLogin !== null) return { tipo: 'aceito' };

  const largo = totp.validate({ token: codigo, window: JANELA_DIAGNOSTICO, timestamp });
  if (largo === null) return { tipo: 'invalido' };

  /**
   * `delta` conta passos e ja vem no sinal que interessa: negativo quando o
   * codigo pertence a um instante ANTERIOR ao "agora" do servidor - o que
   * significa que o servidor correu demais, ou seja, esta adiantado. E do
   * servidor que `segundos` fala, porque e sobre ele que o operador vai agir.
   */
  return { tipo: 'desalinhado', segundos: largo * PERIODO_TOTP };
}
