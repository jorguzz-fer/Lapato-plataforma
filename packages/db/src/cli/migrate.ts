import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { criarConexao } from '../client.js';
import { aplicarPoliticas } from '../rls.js';

/**
 * Aplica as migrations e, em seguida, as politicas de RLS.
 *
 * Roda com `DATABASE_MIGRATION_URL` (usuario dono do schema), nunca com o
 * usuario da aplicacao - que nao tem permissao para criar objetos (ADR 0002).
 *
 * A ordem importa: as policies sao descobertas a partir das colunas
 * `tenant_id`, entao as tabelas precisam existir antes.
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
