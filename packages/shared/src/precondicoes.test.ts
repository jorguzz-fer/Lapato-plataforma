import { describe, expect, test } from 'vitest';
import { motivoBancadaBloqueada } from './precondicoes.js';

/**
 * M05 secao 12: solicitado, cadastrado, recebido e triado sao quatro momentos
 * distintos. O caso que originou esta funcao passava dos quatro para a bancada
 * sem nenhum deles alem do cadastro.
 */
const APTO = {
  recebidoEm: new Date('2026-08-20'),
  triadoEm: new Date('2026-08-21'),
  resultadoTriagem: 'apto',
  exigeTriagem: true,
};

describe('precondicoes da bancada', () => {
  test('caso recebido e triado como apto libera', () => {
    expect(motivoBancadaBloqueada(APTO, 'macroscopia')).toBeNull();
    expect(motivoBancadaBloqueada(APTO, 'microscopia')).toBeNull();
  });

  test('sem recebimento nao entra, e a mensagem diz qual etapa falta', () => {
    const motivo = motivoBancadaBloqueada({ ...APTO, recebidoEm: null }, 'macroscopia');
    expect(motivo).toContain('ainda não foi recebido');
    expect(motivo).toContain('a macroscopia');
  });

  test('triagem que NUNCA aconteceu barra - resultado nulo nao e liberacao', () => {
    // Este e o buraco original: a checagem antiga so recusava "bloqueado" e
    // "recusado", entao o caso recem cadastrado passava.
    expect(
      motivoBancadaBloqueada(
        { ...APTO, triadoEm: null, resultadoTriagem: null },
        'microscopia',
      ),
    ).toContain('triagem ainda não foi concluída');
  });

  test('triagem bloqueada ou recusada barra mesmo com o caso recebido', () => {
    for (const resultado of ['bloqueado', 'recusado']) {
      expect(motivoBancadaBloqueada({ ...APTO, resultadoTriagem: resultado }, 'macroscopia'))
        .toContain(resultado);
    }
  });

  test('bloqueio da amostra tem prioridade sobre a triagem em andamento', () => {
    // Uma amostra pode estar bloqueada com a triagem do caso ainda aberta. O
    // motivo util e o bloqueio, nao "a triagem nao terminou".
    const motivo = motivoBancadaBloqueada(
      { ...APTO, triadoEm: null, resultadoTriagem: 'bloqueado' },
      'macroscopia',
    );
    expect(motivo).toContain('bloqueado');
  });

  test('servico que dispensa triagem exige apenas o recebimento', () => {
    const semTriagem = { ...APTO, exigeTriagem: false, triadoEm: null, resultadoTriagem: null };
    expect(motivoBancadaBloqueada(semTriagem, 'microscopia')).toBeNull();
    expect(motivoBancadaBloqueada({ ...semTriagem, recebidoEm: null }, 'microscopia'))
      .toContain('ainda não foi recebido');
  });
});
