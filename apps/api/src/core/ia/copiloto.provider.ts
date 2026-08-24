import { Inject, Injectable } from '@nestjs/common';
import type {
  ContextoCopiloto,
  CopilotProvider,
  RespostaCopiloto,
} from '@lapato/shared';
import { ENV, type Env } from '../config/env.js';
import { CopilotoClaudeProvider } from './copiloto-claude.provider.js';

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
 * As telas e os servicos de dominio conhecem apenas a interface
 * `CopilotProvider`: trocar de provedor e trocar uma variavel de ambiente,
 * nunca uma tela (ADR 0007).
 */
@Injectable()
export class CopilotoFactory {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly stub: CopilotoStubProvider,
    private readonly claude: CopilotoClaudeProvider,
  ) {}

  criar(): CopilotProvider {
    switch (this.env.COPILOT_PROVIDER) {
      case 'claude':
        return this.claude;
      case 'stub':
      default:
        return this.stub;
    }
  }
}
