import { describe, expect, test } from 'vitest';
import { iniciaisDe, primeiroNome } from './pessoas.js';

/**
 * Regressao de uma tela branca em producao.
 *
 * O front novo subiu antes da API que passou a devolver `nomeCompleto`, e o
 * `.trim()` sobre `undefined` derrubou o render inteiro - inclusive a lista de
 * casos, que nao tem nada a ver com o avatar. Estes testes fixam a regra: a
 * ausencia do nome empobrece o avatar, nunca derruba a tela.
 */
describe('iniciaisDe', () => {
  test('primeiro e último nome', () => {
    expect(iniciaisDe('Ana Beatriz Silva')).toBe('AS');
  });

  test('nome único usa só a primeira letra', () => {
    expect(iniciaisDe('Ana')).toBe('A');
  });

  test('espaços extras não viram iniciais vazias', () => {
    expect(iniciaisDe('  Ana   Silva  ')).toBe('AS');
  });

  test('ausente, nulo ou vazio devolve string vazia — nunca lança', () => {
    expect(iniciaisDe(undefined)).toBe('');
    expect(iniciaisDe(null)).toBe('');
    expect(iniciaisDe('')).toBe('');
    expect(iniciaisDe('   ')).toBe('');
  });
});

describe('primeiro nome', () => {
  test('devolve so o primeiro nome', () => {
    expect(primeiroNome('Ana Beatriz Silva')).toBe('Ana');
  });

  test('aguenta nome unico, vazio e ausente', () => {
    expect(primeiroNome('Ana')).toBe('Ana');
    expect(primeiroNome('   ')).toBe('');
    expect(primeiroNome(undefined)).toBe('');
    expect(primeiroNome(null)).toBe('');
  });
});
