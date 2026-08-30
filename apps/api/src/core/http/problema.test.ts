import { describe, expect, test } from 'vitest';
import { descreverErro } from './problema.filter.js';

describe('descricao de erro nao tratado', () => {
  /**
   * O caso real: o Drizzle embrulha toda falha de consulta num `Failed query`
   * e guarda a mensagem do Postgres em `cause`. Logar so a camada de fora dava
   * uma pagina de SQL sem uma palavra sobre o motivo.
   */
  test('mostra a causa, e nao so a camada de fora', () => {
    const raiz = new Error('column "cadastrado_em" must appear in the GROUP BY clause');
    const embrulhado = new Error('Failed query: select ...', { cause: raiz });

    const texto = descreverErro(embrulhado);

    expect(texto).toContain('Failed query');
    expect(texto).toContain('must appear in the GROUP BY clause');
  });

  test('percorre a cadeia inteira de causas', () => {
    const fundo = new Error('ECONNREFUSED');
    const meio = new Error('driver', { cause: fundo });
    const topo = new Error('Failed query', { cause: meio });

    const texto = descreverErro(topo);

    expect(texto).toContain('driver');
    expect(texto).toContain('ECONNREFUSED');
  });

  /** Uma cadeia circular nao pode virar log infinito. */
  test('para num ciclo em vez de rodar para sempre', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    const texto = descreverErro(b);

    expect(texto.length).toBeLessThan(10_000);
  });

  test('aguenta erro que nao e Error', () => {
    expect(descreverErro('quebrou')).toBe('quebrou');
    expect(descreverErro(undefined)).toBe('undefined');
  });
});
