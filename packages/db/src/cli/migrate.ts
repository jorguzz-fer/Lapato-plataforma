import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { criarConexao } from '../client.js';
import { aplicarPoliticas } from '../rls.js';

/**
 * Chave da trava consultiva que serializa quem migra.
 *
 * Qualquer constante serve, desde que seja a mesma em todo processo que roda
 * este arquivo. Esta nao colide com nenhuma outra trava do sistema.
 */
const TRAVA_MIGRATIONS = 7_202_611_230;

/**
 * Aplica as migrations e, em seguida, as politicas de RLS.
 *
 * Roda com `DATABASE_MIGRATION_URL` (usuario dono do schema), nunca com o
 * usuario da aplicacao - que nao tem permissao para criar objetos (ADR 0002).
 *
 * A ordem importa: as policies sao descobertas a partir das colunas
 * `tenant_id`, entao as tabelas precisam existir antes.
 *
 * **Um processo por vez** (ADR 0011). Desde que a API migra ao subir, cada
 * container novo roda este arquivo - e duas subidas simultaneas (duas
 * replicas, ou um restart cruzando um deploy) aplicariam as mesmas migrations
 * em paralelo. O drizzle nao se protege disso: os dois leem o mesmo "ultimo
 * aplicado" e um deles morre em `duplicate key value violates unique
 * constraint "pg_type_typname_nsp_index"` - reproduzido, tres em tres
 * rodadas. Com a trava, o segundo espera o primeiro terminar e encontra tudo
 * aplicado.
 *
 * A trava e de SESSAO e a conexao e unica (`max: 1`), entao ela cobre a
 * transacao do drizzle e as politicas, que tambem mexem no catalogo. Fechar a
 * conexao a libera - inclusive quando algo falha no meio.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. Migrations rodam com o usuario dono do schema.',
    );
  }

  const usuarioApp = process.env.POSTGRES_USER ?? 'lapato_app';
  const pastaMigrations = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    await db.execute(sql`select pg_advisory_lock(${TRAVA_MIGRATIONS})`);

    console.warn('> aplicando migrations...');
    await migrate(db, { migrationsFolder: pastaMigrations });

    console.warn('> aplicando RLS, triggers de imutabilidade e grants...');
    await aplicarPoliticas(db, usuarioApp);

    console.warn('migrations concluidas.');
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error('falha nas migrations:', erro);
  process.exitCode = 1;
});
