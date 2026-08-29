import { describe, expect, test } from 'vitest';
import {
  STATUS_EXTERNO_LOGISTICO,
  STATUS_LOGISTICO_ABERTO,
  STATUS_SOLICITACAO_LOGISTICA,
  statusExternoDe,
} from './logistica.js';

describe('status externo da solicitação logística (M19 §26-27)', () => {
  /**
   * A tradução mora no M19 porque §27 diz que "o Portal não deverá criar status
   * logísticos independentes". Se algum status interno novo escapar do `switch`,
   * o TypeScript já reclama; este teste cobre o outro lado - que a tradução
   * exista para TODOS eles, e não devolva algo fora do vocabulário externo.
   */
  test('todo status interno tem tradução, e ela é sempre um status externo válido', () => {
    for (const interno of STATUS_SOLICITACAO_LOGISTICA) {
      const externo = statusExternoDe(interno);
      if (externo === null) continue;
      expect(STATUS_EXTERNO_LOGISTICO, `${interno} traduziu para algo inválido`).toContain(
        externo,
      );
    }
  });

  /** §26: o cliente não vê rascunho interno - o pedido dele ainda não existe. */
  test('rascunho não aparece para o cliente', () => {
    expect(statusExternoDe('rascunho')).toBeNull();
  });

  /**
   * O que o cliente NÃO deve distinguir: triagem logística e espera de aceite
   * são a mesma coisa para quem está do lado de fora - "aguardando confirmação".
   * Vazar a diferença exporia decisão interna de planejamento (§89).
   */
  test('a espera interna vira uma coisa só do lado de fora', () => {
    expect(statusExternoDe('aguardando_triagem')).toBe('aguardando_confirmacao');
    expect(statusExternoDe('aguardando_aceite')).toBe('aguardando_confirmacao');
  });

  test('não realizada e cancelada chegam iguais ao cliente', () => {
    expect(statusExternoDe('nao_realizada')).toBe('cancelada');
    expect(statusExternoDe('cancelada')).toBe('cancelada');
  });

  test('coletada e em transporte ainda são "coletada" para o cliente', () => {
    expect(statusExternoDe('coletada')).toBe('coletada');
    expect(statusExternoDe('em_transporte')).toBe('coletada');
  });

  /** Encerradas não ocupam ninguém; tudo o mais ainda é trabalho de alguém. */
  test('a lista de abertas é o complemento exato das encerradas', () => {
    const encerradas = STATUS_SOLICITACAO_LOGISTICA.filter(
      (s) => !STATUS_LOGISTICO_ABERTO.includes(s),
    );
    expect([...encerradas].sort()).toEqual(['cancelada', 'concluida', 'nao_realizada']);
  });
});
