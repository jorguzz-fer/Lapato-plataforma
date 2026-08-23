import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { criarConexao, type Database } from './client.js';
import { estadoMigrations, pastaMigrationsPadrao } from './migrations-estado.js';

/**
 * ADR 0010: a API nao pode subir contra um banco desatualizado.
 *
 * O teste roda com a conexao do usuario da APLICACAO de proposito - e ele que
 * faz a checagem na subida. Se o grant de leitura em `drizzle` faltar, o estado
 * vira `indeterminado` e este teste denuncia.
 */

const URL_APP =
  process.env.DATABASE_URL_TESTE ?? 'postgres://lapato_app:lapato@127.0.0.1:5432/lapato';

let dbApp: Database;
let encerrar: () => Promise<void>;

beforeAll(() => {
  const conexao = criarConexao({ url: URL_APP, max: 2 });
  dbApp = conexao.db;
  encerrar = conexao.encerrar;
});

afterAll(async () => {
  await encerrar();
});

/** Copia o journal real acrescentando uma migration que o banco nao tem. */
function pastaComMigrationExtra(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'lapato-migrations-'));
  mkdirSync(join(pasta, 'meta'), { recursive: true });

  const journal = JSON.parse(
    readFileSync(resolve(pastaMigrationsPadrao(), 'meta/_journal.json'), 'utf8'),
  ) as { entries: { idx: number; version: string; when: number; tag: string }[] };

  journal.entries.push({
    idx: journal.entries.length,
    version: '7',
    when: 9_999_999_999_999,
    tag: '9999_migration_que_nunca_rodou',
  });

  writeFileSync(join(pasta, 'meta/_journal.json'), JSON.stringify(journal));
  return pasta;
}

describe('estado das migrations', () => {
  test('banco migrado: nenhuma pendente e estado determinado', async () => {
    const estado = await estadoMigrations(dbApp);

    // `indeterminado` preenchido aqui significa que o usuario da aplicacao nao
    // consegue ler `drizzle.__drizzle_migrations` - o grant do `aplicarPoliticas`
    // nao chegou. Sem ele a checagem de subida vira decorativa.
    expect(estado.indeterminado).toBeNull();
    expect(estado.pendentes).toEqual([]);
    expect(estado.total).toBeGreaterThan(0);
  });

  test('migration que o codigo tem e o banco nao aparece como pendente', async () => {
    const estado = await estadoMigrations(dbApp, pastaComMigrationExtra());

    expect(estado.indeterminado).toBeNull();
    expect(estado.pendentes).toEqual(['9999_migration_que_nunca_rodou']);
  });

  test('journal ilegivel nao e confundido com banco em dia', async () => {
    const estado = await estadoMigrations(dbApp, join(tmpdir(), 'pasta-que-nao-existe'));

    expect(estado.pendentes).toEqual([]);
    expect(estado.indeterminado).toContain('journal de migrations ilegivel');
  });
});
