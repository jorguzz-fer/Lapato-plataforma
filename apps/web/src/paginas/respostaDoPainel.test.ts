import { describe, expect, test } from 'vitest';
import { lerRespostaDoPainel } from './respostaDoPainel';

/** Resposta completa, no formato da API atual. */
function painelAtual() {
  return {
    geradoEm: '2026-11-23T12:00:00.000Z',
    fuso: 'America/Sao_Paulo',
    volumetria: {
      emAndamento: 42,
      entraramHoje: 3,
      liberadosHoje: 5,
      tempoMedioDias: 4.2,
      diasDaMedia: 30,
    },
    atencao: [
      {
        chave: 'casos_atrasados',
        rotulo: 'Casos fora do prazo',
        detalhe: 'A previsão de liberação já passou.',
        total: 2,
        para: '/casos',
        nivel: 'critico',
      },
    ],
    minhasDemandas: {
      paraMim: [{ id: 'd1' }],
      pedi: [{ id: 'd2' }],
      pendencias: [{ id: 'p1' }],
    },
    prioridades: [{ casoId: 'c1', identificador: 'H26-001', diasAtraso: 3 }],
    funil: [{ etapa: 'recebido', rotulo: 'Recebido', total: 4 }],
    serie: [{ dia: '2026-11-23', entradas: 3, liberacoes: 5 }],
  };
}

describe('resposta do painel', () => {
  test('API em dia: nada ausente, nada mudado', () => {
    const { dados, ausentes } = lerRespostaDoPainel(painelAtual());

    expect(ausentes).toEqual([]);
    expect(dados).toEqual(painelAtual());
  });

  /**
   * Lista vazia nao e lista ausente. Quem nao tem pedido nenhum - ou nao tem
   * permissao de ver solicitacao, e recebe as tres listas vazias da API - nao
   * pode ver o aviso de servidor desatualizado.
   */
  test('listas vazias da API atual nao contam como ausentes', () => {
    const resposta = {
      ...painelAtual(),
      minhasDemandas: { paraMim: [], pedi: [], pendencias: [] },
      prioridades: [],
    };

    expect(lerRespostaDoPainel(resposta).ausentes).toEqual([]);
  });

  /**
   * O caso de 23/11/2026, reproduzido: API anterior ao #90, sem
   * `minhasDemandas` nem `prioridades`. Antes desta mudanca a tela inteira
   * caia com "Cannot read properties of undefined (reading 'pendencias')".
   */
  test('API anterior ao #90: desenha o nucleo e aponta os tres blocos', () => {
    const antiga: Record<string, unknown> = painelAtual();
    delete antiga.minhasDemandas;
    delete antiga.prioridades;

    const { dados, ausentes } = lerRespostaDoPainel(antiga);

    expect(ausentes).toEqual(['prioridades', 'pendencias', 'minhasDemandas']);
    expect(dados.minhasDemandas).toEqual({ paraMim: [], pedi: [], pendencias: [] });
    expect(dados.prioridades).toEqual([]);
    // O nucleo passa intacto: o que a API mandou, a tela mostra.
    expect(dados.volumetria.emAndamento).toBe(42);
    expect(dados.funil).toHaveLength(1);
    expect(dados.serie).toHaveLength(1);
  });

  /** Entre #90 e #98: `minhasDemandas` existe, mas sem `pendencias`. */
  test('API entre #90 e #98: preserva o que veio e aponta so o que falta', () => {
    const resposta = {
      ...painelAtual(),
      minhasDemandas: { paraMim: [{ id: 'd1' }], pedi: [] },
    } as Record<string, unknown>;
    delete resposta.prioridades;

    const { dados, ausentes } = lerRespostaDoPainel(resposta);

    expect(ausentes).toEqual(['prioridades', 'pendencias']);
    expect(dados.minhasDemandas.paraMim).toEqual([{ id: 'd1' }]);
    expect(dados.minhasDemandas.pendencias).toEqual([]);
  });

  /**
   * Sem o nucleo nao ha painel. Completar com zeros desenharia "0 casos em
   * andamento" - um numero falso que alguem leria como verdadeiro.
   */
  test('nucleo ausente e erro, nao zero', () => {
    const semVolumetria: Record<string, unknown> = painelAtual();
    delete semVolumetria.volumetria;

    expect(() => lerRespostaDoPainel(semVolumetria)).toThrow(/volumetria/);
  });

  test('resposta que nao e objeto e erro', () => {
    expect(() => lerRespostaDoPainel(null)).toThrow();
    // Um proxy mal configurado devolvendo a pagina do front no lugar da API.
    expect(() => lerRespostaDoPainel('<!doctype html><html></html>')).toThrow();
  });
});
