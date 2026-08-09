import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { criarConexao, comTenant, type Database } from './client.js';
import { tabelasSemPolitica } from './rls.js';
import { cliente, tenant } from './schema/index.js';

/**
 * Teste de isolamento multi-instituicao.
 *
 * Blueprint secao 7 exige, literalmente: "Teste automatizado: tenant A nunca le
 * tenant B". Sem este teste verde, nao ha merge.
 *
 * O ponto central: a conexao usada aqui e a do usuario da APLICACAO
 * (`lapato_app`, criado com NOBYPASSRLS). Se a RLS nao estivesse valendo, os
 * SELECTs abaixo - que **nao tem filtro por tenant_id** - devolveriam dados das
 * duas instituicoes.
 */

const URL_APP =
  process.env.DATABASE_URL_TESTE ?? 'postgres://lapato_app:lapato@127.0.0.1:5432/lapato';
const URL_OWNER =
  process.env.DATABASE_MIGRATION_URL_TESTE ??
  'postgres://lapato_owner:lapato@127.0.0.1:5432/lapato';

let dbApp: Database;
let dbOwner: Database;
let encerrarApp: () => Promise<void>;
let encerrarOwner: () => Promise<void>;

/**
 * Concatena a mensagem do erro e de toda a cadeia de `cause`.
 *
 * A partir do Drizzle 0.45 o erro do driver vem embrulhado num
 * `Failed query: ...`, com o erro real do Postgres em `cause`. Asserir apenas
 * sobre `message` faria o teste passar com QUALQUER falha de query - inclusive
 * um typo - em vez de provar que foi a RLS ou o trigger que barrou.
 */
async function mensagemCompleta(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '';
  } catch (erro) {
    const partes: string[] = [];
    let atual: unknown = erro;
    while (atual instanceof Error) {
      partes.push(atual.message);
      atual = (atual as Error).cause;
    }
    return partes.join(' | ');
  }
}

let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  ({ db: dbApp, encerrar: encerrarApp } = criarConexao({ url: URL_APP, max: 2 }));
  ({ db: dbOwner, encerrar: encerrarOwner } = criarConexao({ url: URL_OWNER, max: 2 }));

  // As instituicoes sao criadas pelo owner: `tenant` fica fora da RLS por
  // tenant, e o provisionamento e operacao administrativa, nao de aplicacao.
  const sufixo = Date.now();
  const [a] = await dbOwner
    .insert(tenant)
    .values({
      slug: `teste-a-${sufixo}`,
      razaoSocial: 'Laboratorio A LTDA',
      nomeFantasia: 'Lab A',
    })
    .returning({ id: tenant.id });
  const [b] = await dbOwner
    .insert(tenant)
    .values({
      slug: `teste-b-${sufixo}`,
      razaoSocial: 'Laboratorio B LTDA',
      nomeFantasia: 'Lab B',
    })
    .returning({ id: tenant.id });

  tenantA = a!.id;
  tenantB = b!.id;

  await comTenant(dbApp, tenantA, async (tx) => {
    await tx.insert(cliente).values({
      tenantId: tenantA,
      nomeFantasia: 'Clinica do Tenant A',
      tipo: 'clinica',
      codigo: 'CA',
    });
  });

  await comTenant(dbApp, tenantB, async (tx) => {
    await tx.insert(cliente).values({
      tenantId: tenantB,
      nomeFantasia: 'Clinica do Tenant B',
      tipo: 'clinica',
      codigo: 'CB',
    });
  });
});

afterAll(async () => {
  if (tenantA && tenantB) {
    // Limpeza pelo owner, que tambem esta sujeito a policy (FORCE RLS); por
    // isso a remocao e feita por tenant.
    for (const id of [tenantA, tenantB]) {
      await comTenant(dbOwner, id, async (tx) => {
        await tx.execute(sql`DELETE FROM cliente WHERE tenant_id = ${id}`);
      });
      await dbOwner.execute(sql`DELETE FROM tenant WHERE id = ${id}`);
    }
  }
  await encerrarApp?.();
  await encerrarOwner?.();
});

describe('cobertura das politicas', () => {
  test('nenhuma tabela de dominio ficou sem RLS', async () => {
    const semPolitica = await tabelasSemPolitica(dbOwner);
    expect(semPolitica).toEqual([]);
  });

  test('o usuario da aplicacao nao tem BYPASSRLS', async () => {
    const resultado = await dbOwner.execute<{ rolbypassrls: boolean }>(
      sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'lapato_app'`,
    );
    expect(Array.from(resultado)[0]?.rolbypassrls).toBe(false);
  });
});

describe('isolamento entre instituicoes', () => {
  /**
   * A consulta nao filtra por tenant_id de proposito. E exatamente o "where
   * esquecido" que a defesa em profundidade do Blueprint secao 7 existe para
   * conter.
   */
  test('tenant A ve apenas os proprios clientes, mesmo sem filtro na consulta', async () => {
    const linhas = await comTenant(dbApp, tenantA, async (tx) =>
      tx.execute<{ nome_fantasia: string }>(sql`SELECT nome_fantasia FROM cliente`),
    );
    const nomes = Array.from(linhas).map((l) => l.nome_fantasia);

    expect(nomes).toContain('Clinica do Tenant A');
    expect(nomes).not.toContain('Clinica do Tenant B');
  });

  test('tenant B ve apenas os proprios clientes', async () => {
    const linhas = await comTenant(dbApp, tenantB, async (tx) =>
      tx.execute<{ nome_fantasia: string }>(sql`SELECT nome_fantasia FROM cliente`),
    );
    const nomes = Array.from(linhas).map((l) => l.nome_fantasia);

    expect(nomes).toContain('Clinica do Tenant B');
    expect(nomes).not.toContain('Clinica do Tenant A');
  });

  /** Buscar pelo id exato de outra instituicao tambem nao devolve nada. */
  test('acesso direto por id a registro de outro tenant nao retorna nada', async () => {
    const idDoB = await comTenant(dbApp, tenantB, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`SELECT id FROM cliente LIMIT 1`);
      return Array.from(r)[0]!.id;
    });

    const linhas = await comTenant(dbApp, tenantA, async (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM cliente WHERE id = ${idDoB}`),
    );

    expect(Array.from(linhas)).toHaveLength(0);
  });

  /**
   * O `WITH CHECK` da policy impede gravar em nome de outra instituicao - o
   * caso em que o atacante controla o corpo do request e tenta forcar o
   * tenant_id.
   */
  test('nao e possivel inserir registro no tenant alheio', async () => {
    const mensagem = await mensagemCompleta(() =>
      comTenant(dbApp, tenantA, async (tx) => {
        await tx.insert(cliente).values({
          tenantId: tenantB,
          nomeFantasia: 'Invasor',
          tipo: 'clinica',
          codigo: 'XX',
        });
      }),
    );

    expect(mensagem).toMatch(/row-level security/i);
  });

  test('nao e possivel atualizar registro do tenant alheio', async () => {
    const afetadas = await comTenant(dbApp, tenantA, async (tx) => {
      const r = await tx.execute(
        sql`UPDATE cliente SET nome_fantasia = 'sequestrado' WHERE tenant_id = ${tenantB}`,
      );
      return r.count;
    });

    expect(afetadas).toBe(0);
  });

  /**
   * Falha fechada: sem tenant definido, `current_setting` devolve NULL e a
   * comparacao e sempre falsa. Uma consulta que escapasse do `comTenant`
   * retorna vazio em vez de retornar tudo.
   */
  test('consulta sem tenant definido nao retorna nada', async () => {
    const linhas = await dbApp.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM cliente`,
    );
    expect(Array.from(linhas)[0]?.total).toBe('0');
  });

  /** O tenant nao vaza pela conexao devolvida ao pool entre transacoes. */
  test('o tenant nao persiste apos o fim da transacao', async () => {
    await comTenant(dbApp, tenantA, async (tx) => {
      await tx.execute(sql`SELECT 1`);
    });

    const linhas = await dbApp.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM cliente`,
    );
    expect(Array.from(linhas)[0]?.total).toBe('0');
  });
});

describe('imutabilidade da trilha de auditoria', () => {
  /**
   * DIRETRIZES secao 13 e Introducao secao 6.6: eventos e auditoria sao
   * append-only. Erro gera correcao, nunca exclusao. A regra e trigger, e nao
   * so codigo da aplicacao, porque trilha que o sistema pode reescrever nao
   * serve de trilha.
   */
  test('evento de dominio nao pode ser alterado nem removido', async () => {
    await comTenant(dbApp, tenantA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO evento_dominio (tenant_id, tipo, modulo_origem, visibilidade)
        VALUES (${tenantA}, 'caso.criado', 'M05_RECEBIMENTO', 'interno')
      `);
    });

    const aoAtualizar = await mensagemCompleta(() =>
      comTenant(dbApp, tenantA, async (tx) => {
        await tx.execute(sql`UPDATE evento_dominio SET tipo = 'adulterado'`);
      }),
    );
    expect(aoAtualizar).toMatch(/append-only/i);

    const aoRemover = await mensagemCompleta(() =>
      comTenant(dbApp, tenantA, async (tx) => {
        await tx.execute(sql`DELETE FROM evento_dominio`);
      }),
    );
    expect(aoRemover).toMatch(/append-only/i);
  });

  test('registro de auditoria nao pode ser alterado', async () => {
    await comTenant(dbApp, tenantA, async (tx) => {
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, entidade, entidade_id, acao)
        VALUES (${tenantA}, 'cliente', gen_random_uuid(), 'criar')
      `);
    });

    const mensagem = await mensagemCompleta(() =>
      comTenant(dbApp, tenantA, async (tx) => {
        await tx.execute(sql`UPDATE audit_log SET acao = 'adulterado'`);
      }),
    );
    expect(mensagem).toMatch(/append-only/i);
  });
});
