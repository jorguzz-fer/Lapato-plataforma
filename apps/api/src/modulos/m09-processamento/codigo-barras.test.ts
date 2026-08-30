import { describe, expect, test } from 'vitest';
import { code128Larguras } from './codigo-barras.js';

describe('codificador Code 128 B', () => {
  /**
   * A conta estrutural do padrão: cada símbolo tem 11 módulos (START, dados e
   * checksum), o STOP tem 13 com a barra final. Um texto de N caracteres gera
   * N+2 símbolos de 11 módulos mais o STOP.
   */
  test('a soma das larguras bate com a estrutura do padrão', () => {
    const texto = 'CV-000342/26-A01-C2';
    const larguras = code128Larguras(texto);
    const modulos = larguras.reduce((a, b) => a + b, 0);
    expect(modulos).toBe(11 * (texto.length + 2) + 13);
    // Barras e espaços alternam começando e terminando em barra: total ímpar.
    expect(larguras.length % 2).toBe(1);
  });

  test('caractere fora do ASCII imprimível é recusado com o contexto', () => {
    expect(() => code128Larguras('AÇAÍ')).toThrow(/Ç/);
  });
});
