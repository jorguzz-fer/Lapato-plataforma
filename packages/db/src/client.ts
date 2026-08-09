import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transacao = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface OpcoesConexao {
  url: string;
  /** Tamanho maximo do pool. */
  max?: number;
  /** Loga o SQL gerado. So em desenvolvimento. */
  debug?: boolean;
}

export function criarConexao(opcoes: OpcoesConexao): {
  db: Database;
  sqlClient: postgres.Sql;
  encerrar: () => Promise<void>;
} {
  const sqlClient = postgres(opcoes.url, {
    max: opcoes.max ?? 10,
    // Blueprint secao 11: nada de dado sensivel em log.
    onnotice: () => {},
  });

  const db = drizzle(sqlClient, { schema, logger: opcoes.debug ?? false });

  return { db, sqlClient, encerrar: () => sqlClient.end({ timeout: 5 }) };
}

/**
 * Executa uma funcao dentro de uma transacao com o tenant fixado.
 *
 * ADR 0002 / Blueprint secao 7: as policies de RLS leem
 * `current_setting('app.current_tenant')`. O `SET LOCAL` (via `set_config` com
 * `is_local = true`) vale ate o fim da transacao, o que garante que a conexao
 * devolvida ao pool nao carregue o tenant do request anterior - o vazamento
 * classico de multitenancy com pool de conexoes.
 *
 * A forma parametrizada de `set_config` elimina qualquer chance de injecao pelo
 * valor do tenant.
 *
 * **Nao existe funcao de bypass neste modulo, e isso e deliberado.** Um
 * `set_config('app.bypass_rls', ...)` transformaria qualquer injecao de SQL em
 * vazamento entre instituicoes. Os dois caminhos que parecem precisar de bypass
 * foram resolvidos sem ele:
 *
 * - **Login:** o tenant e resolvido antes, pelo slug (subdominio), consultando a
 *   tabela `tenant` - que nao tem `tenant_id` e por isso fica fora da RLS por
 *   tenant. Com o tenant em maos, a busca do usuario ja roda escopada.
 * - **Worker do outbox:** `outbox_evento` e tabela de infraestrutura, sem
 *   conteudo de dominio (guarda apenas FK e estado de retry) e por isso nao
 *   entra na RLS. O worker le a fila, descobre o `tenant_id` da linha e so
 *   entao abre `comTenant` para tocar em qualquer dado real.
 */
export async function comTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transacao) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}

export { schema };
export * from './schema/index.js';
