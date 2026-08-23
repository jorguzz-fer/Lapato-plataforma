import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Compara as migrations que existem no codigo com as que o banco registrou.
 *
 * Existe por causa de um incidente real: o M16 subiu com a coluna
 * `miniatura_chave`, a migration nao rodou em producao, e a API subiu sem
 * reclamar. Cada upload de imagem quebrava com 500 e o unico sinal era o log de
 * erro do Postgres. Codigo novo nao pode aceitar schema velho em silencio.
 */

interface EntradaJournal {
  idx: number;
  when: number;
  tag: string;
}

export interface EstadoMigrations {
  /** Quantas migrations existem no codigo. */
  total: number;
  /** Tags que o codigo tem e o banco nao registrou, em ordem. */
  pendentes: string[];
  /**
   * Preenchido quando o estado nao pode ser lido - tipicamente porque a role da
   * aplicacao ainda nao tem SELECT em `drizzle.__drizzle_migrations` (o grant e
   * aplicado pelo proprio migrate). Nao e o mesmo que "esta em dia".
   */
  indeterminado: string | null;
}

/** Pasta `drizzle/` do pacote, resolvida a partir do arquivo compilado. */
export function pastaMigrationsPadrao(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
}

function lerJournal(pasta: string): EntradaJournal[] {
  const bruto = readFileSync(resolve(pasta, 'meta/_journal.json'), 'utf8');
  const journal = JSON.parse(bruto) as { entries?: EntradaJournal[] };
  return [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
}

/**
 * O migrator do Drizzle grava uma linha por migration aplicada, com `created_at`
 * igual ao `when` do journal. Comparar por esse carimbo - e nao por contagem -
 * detecta tambem o caso em que o banco esta a frente do codigo (rollback do
 * container sem rollback do banco).
 */
async function carimbosAplicados(db: Database): Promise<Set<string>> {
  const linhas = await db.execute<{ created_at: string | number | null }>(
    sql`select created_at from drizzle.__drizzle_migrations`,
  );
  return new Set(
    [...linhas]
      .map((l) => (l.created_at === null ? null : String(l.created_at)))
      .filter((v): v is string => v !== null),
  );
}

function codigoPostgres(erro: unknown): string | undefined {
  for (let atual: unknown = erro; atual instanceof Error; atual = atual.cause) {
    const codigo = (atual as { code?: unknown }).code;
    if (typeof codigo === 'string') return codigo;
  }
  return undefined;
}

export async function estadoMigrations(
  db: Database,
  pasta: string = pastaMigrationsPadrao(),
): Promise<EstadoMigrations> {
  let entradas: EntradaJournal[];
  try {
    entradas = lerJournal(pasta);
  } catch (erro: unknown) {
    return {
      total: 0,
      pendentes: [],
      indeterminado: `journal de migrations ilegivel em ${pasta}: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    };
  }

  let aplicados: Set<string>;
  try {
    aplicados = await carimbosAplicados(db);
  } catch (erro: unknown) {
    const codigo = codigoPostgres(erro);
    // Schema ou tabela inexistente: banco virgem, tudo pendente. Isso e um
    // estado conhecido, nao uma incerteza.
    if (codigo === '42P01' || codigo === '3F000') {
      return { total: entradas.length, pendentes: entradas.map((e) => e.tag), indeterminado: null };
    }
    return {
      total: entradas.length,
      pendentes: [],
      indeterminado:
        codigo === '42501'
          ? 'sem permissao para ler drizzle.__drizzle_migrations (rode as migrations uma vez para aplicar o grant)'
          : erro instanceof Error
            ? erro.message
            : String(erro),
    };
  }

  return {
    total: entradas.length,
    pendentes: entradas.filter((e) => !aplicados.has(String(e.when))).map((e) => e.tag),
    indeterminado: null,
  };
}
