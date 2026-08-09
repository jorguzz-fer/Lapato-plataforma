import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { comTenant, criarConexao, type Database, type Transacao } from '@lapato/db';
import { ENV, type Env } from '../config/env.js';
import { contextoAtual } from '../contexto/contexto-requisicao.js';

/**
 * Acesso ao banco, sempre escopado por tenant.
 *
 * A unica forma normal de consultar dado de dominio e `executar()`, que abre a
 * transacao com `SET LOCAL app.current_tenant` a partir do contexto do request.
 * Isso torna o isolamento o caminho de menor esforco, em vez de algo que cada
 * servico precisa lembrar de fazer (ADR 0002).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly conexao: ReturnType<typeof criarConexao>;

  constructor(@Inject(ENV) env: Env) {
    this.conexao = criarConexao({
      url: env.DATABASE_URL,
      debug: env.NODE_ENV === 'development' && env.LOG_LEVEL === 'debug',
    });
  }

  /** Conexao crua. Use apenas para healthcheck e para o fluxo de login. */
  get raw(): Database {
    return this.conexao.db;
  }

  /**
   * Executa dentro do tenant do request.
   * Lanca se nao houver contexto - falha fechada.
   */
  async executar<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
    const ctx = contextoAtual();
    if (!ctx) {
      throw new Error(
        'Tentativa de acessar dados de dominio sem contexto de requisicao. ' +
          'Use executarComTenant() para tarefas de sistema.',
      );
    }
    return comTenant(this.conexao.db, ctx.tenantId, fn);
  }

  /**
   * Executa num tenant explicito, para caminhos que rodam fora de um request:
   * login (apos resolver o tenant pelo slug) e jobs do worker.
   */
  async executarComTenant<T>(tenantId: string, fn: (tx: Transacao) => Promise<T>): Promise<T> {
    return comTenant(this.conexao.db, tenantId, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.conexao.encerrar();
  }
}
