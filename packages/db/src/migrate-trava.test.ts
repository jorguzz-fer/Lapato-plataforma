import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import postgres from 'postgres';

/**
 * ADR 0011: a API aplica as migrations ao subir - e quem migra, migra um por vez.
 *
 * Cada container novo da API roda `migrate.js` antes de abrir a porta. Duas
 * subidas ao mesmo tempo (duas replicas, ou um restart cruzando um deploy)
 * aplicariam as mesmas migrations em paralelo. Sem a trava consultiva, um dos
 * dois morre em `duplicate key value violates unique constraint
 * "pg_type_typname_nsp_index"` - e, como o Dockerfile so sobe a API depois de
 * a migration terminar bem, aquele container nao sobe.
 *
 * O teste usa um banco descartavel: a corrida so existe num banco vazio, e as
 * travas consultivas sao por banco, entao ele nao esbarra nos outros testes.
 */

const executar = promisify(execFile);

const URL_DONO =
  process.env.DATABASE_MIGRATION_URL_TESTE ??
  'postgres://lapato_owner:lapato@127.0.0.1:5432/lapato';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizDoPacote = resolve(aqui, '..');
const journal = JSON.parse(
  readFileSync(resolve(raizDoPacote, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: unknown[] };

const banco = `lapato_trava_${Date.now()}`;
const urlDoBanco = (() => {
  const url = new URL(URL_DONO);
  url.pathname = `/${banco}`;
  return url.toString();
})();

let dono: postgres.Sql;

beforeAll(async () => {
  dono = postgres(URL_DONO, { max: 1, onnotice: () => {} });
  await dono.unsafe(`CREATE DATABASE "${banco}"`);
});

afterAll(async () => {
  await dono.unsafe(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`);
  await dono.end();
});

/** O mesmo arquivo que o container roda, pelo fonte - sem depender do `dist`. */
function migrar() {
  return executar(process.execPath, ['--import', 'tsx', 'src/cli/migrate.ts'], {
    cwd: raizDoPacote,
    env: { ...process.env, DATABASE_MIGRATION_URL: urlDoBanco },
  });
}

describe('ADR 0011: quem migra, migra um por vez', () => {
  test('duas subidas simultaneas terminam bem, e cada migration entra uma vez', async () => {
    const subidas = await Promise.allSettled([migrar(), migrar()]);

    for (const subida of subidas) {
      expect(
        subida.status,
        subida.status === 'rejected' ? String((subida.reason as { stderr?: string }).stderr) : '',
      ).toBe('fulfilled');
    }

    const conexao = postgres(urlDoBanco, { max: 1, onnotice: () => {} });
    try {
      const [linha] = await conexao<{ total: number }[]>`
        select count(*)::int as total from drizzle.__drizzle_migrations
      `;
      expect(linha?.total).toBe(journal.entries.length);
    } finally {
      await conexao.end();
    }
  }, 120_000);
});
