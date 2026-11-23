import type { CasoPrioritario, DemandaMinha, Painel, PendenciaMinha } from '../api';

/**
 * Leitura da resposta de `/painel`, tolerante a API mais antiga que a tela.
 *
 * Front e API sao imagens publicadas separadamente. Durante um deploy - ou
 * quando a API nova nao sobe porque o guarda do schema (ADR 0010) a recusa e o
 * Coolify mantem a anterior no ar - a tela de chegada nova conversa com uma API
 * velha. Em 23/11/2026 foi exatamente isso: a API anterior ao #90 nao mandava
 * `minhasDemandas`, a tela leu `dados.minhasDemandas.pendencias` e o sistema
 * inteiro caiu na tela de erro, com a navegacao junto, para todos os usuarios.
 *
 * A regra separa o que sempre existiu do que veio depois:
 *
 * - **Nucleo** (`volumetria`, `atencao`, `funil`, `serie`): existe desde a
 *   criacao do painel (#57). Se falta, a resposta nao e um painel - e
 *   preencher com zero seria mentir ("0 casos em andamento"). Vira erro.
 * - **Blocos recentes** (`prioridades`, `minhasDemandas`): acrescentados na
 *   quarta e na quinta revisao. Se faltam, a tela desenha o resto e diz quais
 *   blocos ficaram de fora e por que.
 */

/** Na ordem em que aparecem na tela. */
export const BLOCOS_RECENTES = ['prioridades', 'pendencias', 'minhasDemandas'] as const;

export type BlocoRecente = (typeof BLOCOS_RECENTES)[number];

/** Como cada bloco se chama na tela - e o que a pessoa vai sentir falta. */
export const NOME_DO_BLOCO: Record<BlocoRecente, string> = {
  prioridades: 'Prioridades',
  pendencias: 'Minhas pendências',
  minhasDemandas: 'Para mim / Pedi e estou esperando',
};

export interface RespostaDoPainel {
  dados: Painel;
  /** Blocos que esta tela espera e a API nao mandou. Vazio: API em dia. */
  ausentes: BlocoRecente[];
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function lista<T>(valor: unknown): T[] | null {
  return Array.isArray(valor) ? (valor as T[]) : null;
}

export function lerRespostaDoPainel(bruto: unknown): RespostaDoPainel {
  const r = objeto(bruto);
  if (!r) throw new Error('A resposta do painel não é um objeto.');

  const nucleoFaltando = [
    objeto(r.volumetria) ? null : 'volumetria',
    lista(r.atencao) ? null : 'atencao',
    lista(r.funil) ? null : 'funil',
    lista(r.serie) ? null : 'serie',
  ].filter((campo): campo is string => campo !== null);

  if (nucleoFaltando.length > 0) {
    throw new Error(`A resposta do painel veio sem ${nucleoFaltando.join(', ')}.`);
  }

  const ausentes = new Set<BlocoRecente>();

  const prioridades = lista<CasoPrioritario>(r.prioridades);
  if (!prioridades) ausentes.add('prioridades');

  // `paraMim` e `pedi` entraram juntos (#90); `pendencias` veio depois (#98).
  const demandas = objeto(r.minhasDemandas);
  const paraMim = lista<DemandaMinha>(demandas?.paraMim);
  const pedi = lista<DemandaMinha>(demandas?.pedi);
  const pendencias = lista<PendenciaMinha>(demandas?.pendencias);
  if (!paraMim || !pedi) ausentes.add('minhasDemandas');
  if (!pendencias) ausentes.add('pendencias');

  return {
    dados: {
      ...(r as unknown as Painel),
      prioridades: prioridades ?? [],
      minhasDemandas: {
        paraMim: paraMim ?? [],
        pedi: pedi ?? [],
        pendencias: pendencias ?? [],
      },
    },
    ausentes: BLOCOS_RECENTES.filter((bloco) => ausentes.has(bloco)),
  };
}
