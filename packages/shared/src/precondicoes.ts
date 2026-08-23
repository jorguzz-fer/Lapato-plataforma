/**
 * Precondicoes pre-analiticas das etapas de bancada.
 *
 * O M05 secao 12 separa quatro momentos que **nao sao o mesmo**: solicitado,
 * cadastrado, recebido e triado. Cadastrar um caso e registrar que alguem pediu
 * o exame; nao significa que o material chegou, nem que alguem o conferiu.
 *
 * Descrever macroscopia ou abrir laudo de material que o laboratorio nunca
 * registrou ter recebido quebra a cadeia de custodia: os cassetes passam a ser
 * numerados contra material sem recebimento, e o laudo se apoia numa amostra
 * que ninguem conferiu.
 *
 * A regra vive aqui, e nao dentro de um dos modulos, porque vale para os dois
 * (M08 e M11) e valera para os proximos - e porque um modulo nao chama o outro
 * (DIRETRIZES secao 17). Cada modulo le o estado do caso, que e dado comum, e
 * pergunta a esta funcao.
 */

export type EtapaBancada = 'macroscopia' | 'microscopia';

export interface ContextoPreAnalitico {
  /** `caso.recebidoEm`. Nulo enquanto o material nao foi registrado como recebido. */
  recebidoEm: Date | string | null;
  /** `caso.triadoEm`. Nulo enquanto a triagem nao foi concluida. */
  triadoEm: Date | string | null;
  /**
   * Resultado da triagem que vale para a etapa. Na macroscopia e o da amostra
   * (`amostra.resultadoTriagem`), porque a bancada trabalha uma amostra por vez;
   * na microscopia e o agregado do caso.
   */
  resultadoTriagem: string | null;
  /** `servico.exigeTriagem` (M01). Servico que dispensa triagem nao a exige aqui. */
  exigeTriagem: boolean;
}

const NOME: Record<EtapaBancada, string> = {
  macroscopia: 'a macroscopia',
  microscopia: 'a microscopia',
};

/**
 * Devolve o motivo pelo qual a etapa nao pode comecar, ou `null` se puder.
 *
 * Devolver o motivo em vez de um booleano e deliberado: quem chama repassa o
 * texto ao usuario, e "nao pode" sem dizer por que e o tipo de mensagem que faz
 * a pessoa recarregar a pagina achando que e defeito.
 */
export function motivoBancadaBloqueada(
  contexto: ContextoPreAnalitico,
  etapa: EtapaBancada,
): string | null {
  const alvo = NOME[etapa];

  if (!contexto.recebidoEm) {
    return `O material ainda não foi recebido. Registre o recebimento antes de iniciar ${alvo}.`;
  }

  /**
   * A checagem do resultado vem antes da de conclusao porque uma amostra pode
   * estar bloqueada com a triagem do caso ainda em andamento - e nesse caso o
   * motivo util e o bloqueio, nao "a triagem nao terminou".
   */
  if (contexto.resultadoTriagem === 'bloqueado' || contexto.resultadoTriagem === 'recusado') {
    return `Amostra com triagem "${contexto.resultadoTriagem}" não pode iniciar ${alvo}.`;
  }

  if (contexto.exigeTriagem && !contexto.triadoEm) {
    return `A triagem ainda não foi concluída. Conclua a triagem antes de iniciar ${alvo}.`;
  }

  return null;
}
