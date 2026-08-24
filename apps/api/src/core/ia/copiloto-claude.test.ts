import { describe, expect, test } from 'vitest';
import { validarCartoesDoModelo } from './copiloto-claude.provider.js';

/**
 * A fronteira de confianca do Copiloto real.
 *
 * A saida de um LLM e entrada nao confiavel como qualquer outra: estes testes
 * provam que o que nao cabe no contrato morre na validacao - em especial a
 * regra de que **um modelo probabilistico nunca emite `critico`**, porque
 * bloquear acao e atribuicao do Guardian deterministico (ADR 0007).
 */

const cartaoValido = {
  nivel: 'sugestao',
  titulo: 'Descrever as margens',
  corpo: 'O material tem margens cirúrgicas identificáveis; considere descrevê-las por quadrante.',
  fontes: ['caso_atual'],
  inferencia: true,
};

describe('validarCartoesDoModelo', () => {
  test('cartão válido passa e ganha id próprio', () => {
    const cartoes = validarCartoesDoModelo({ cartoes: [cartaoValido] });
    expect(cartoes).toHaveLength(1);
    expect(cartoes[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cartoes[0]!.nivel).toBe('sugestao');
  });

  test('nível "critico" é recusado — bloquear é papel do Guardian', () => {
    expect(
      validarCartoesDoModelo({ cartoes: [{ ...cartaoValido, nivel: 'critico' }] }),
    ).toHaveLength(0);
  });

  test('fonte fora do enum é recusada — conhecimento externo não se disfarça', () => {
    expect(
      validarCartoesDoModelo({ cartoes: [{ ...cartaoValido, fontes: ['prontuario_do_tutor'] }] }),
    ).toHaveLength(0);
  });

  test('estrutura fora do contrato vira lista vazia, nunca exceção', () => {
    expect(validarCartoesDoModelo(null)).toHaveLength(0);
    expect(validarCartoesDoModelo('um texto solto')).toHaveLength(0);
    expect(validarCartoesDoModelo({ cartoes: 'não é lista' })).toHaveLength(0);
  });

  test('mais de 4 cartões é recusado por inteiro — o painel não é um feed', () => {
    expect(
      validarCartoesDoModelo({ cartoes: Array(5).fill(cartaoValido) }),
    ).toHaveLength(0);
  });
});
