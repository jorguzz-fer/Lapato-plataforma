import { Inject, Injectable } from '@nestjs/common';
import type {
  ContextoCopiloto,
  CopilotProvider,
  RespostaCopiloto,
} from '@lapato/shared';
import { ENV, type Env } from '../config/env.js';

export const COPILOT_PROVIDER = Symbol('COPILOT_PROVIDER');

/**
 * Provedor stub do LAPATO Copiloto (ADR 0007).
 *
 * M17 secoes 110-112, regra arquitetural: **o LAPATO deve continuar funcionando
 * sem IA**. Cadastrar, descrever, processar, diagnosticar, assinar e liberar
 * precisam funcionar em modo manual, com indicador de indisponibilidade.
 *
 * Este provedor devolve `disponivel: false` e nenhum cartao. Com isso, o modo
 * sem IA nao e um caminho teorico que ninguem exercita: e o padrao, e o teste
 * e2e da fatia vertical roda inteiro sobre ele.
 *
 * O Guardian NAO passa por aqui - ele e deterministico e continua ativo mesmo
 * sem Copiloto, porque as checagens que bloqueiam acao critica nao podem
 * depender de um servico externo estar de pe.
 */
@Injectable()
export class CopilotoStubProvider implements CopilotProvider {
  readonly nome = 'stub';

  disponivel(): boolean {
    return false;
  }

  async sugerir(_contexto: ContextoCopiloto): Promise<RespostaCopiloto> {
    return { cartoes: [], disponivel: false };
  }
}

/**
 * Seleciona o provedor conforme a configuracao.
 *
 * Quando `COPILOT_PROVIDER=claude` for implementado, ele entra aqui sem que
 * nenhuma tela ou servico de dominio precise mudar - eles conhecem apenas a
 * interface `CopilotProvider`.
 */
@Injectable()
export class CopilotoFactory {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly stub: CopilotoStubProvider,
  ) {}

  criar(): CopilotProvider {
    switch (this.env.COPILOT_PROVIDER) {
      case 'stub':
        return this.stub;
      case 'claude':
        /**
         * Pendencias antes de ligar o provedor real, todas exigidas pelo M17:
         * minimizacao de dados (secao 95), hierarquia de fontes (secao 99),
         * isolamento do contexto entre instituicoes, politica de retencao de
         * prompts (secao 90) e DPA com o provedor (Blueprint secao 14).
         */
        throw new Error(
          'Provedor "claude" ainda nao implementado. ' +
            'Ver docs/adr/0007 para os pre-requisitos de governanca.',
        );
      default:
        return this.stub;
    }
  }
}
