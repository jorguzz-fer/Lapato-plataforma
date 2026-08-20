import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { PERFIS_PADRAO, TODAS_PERMISSOES } from '@lapato/shared';
import { criarBaseInstitucional, PERFIS } from './base-institucional.js';
import { comTenant, criarConexao, type Database } from './client.js';
import * as s from './schema/index.js';

/**
 * Contrato da configuracao institucional.
 *
 * `seed` (desenvolvimento) e `provision` (producao) partem daqui. Se os dois
 * comecassem de bases diferentes, o ambiente de teste deixaria de provar
 * qualquer coisa sobre producao - e o jeito de garantir que nao divirjam e
 * testar a base, nao cada comando.
 */

const URL_OWNER =
  process.env.DATABASE_MIGRATION_URL_TESTE ??
  'postgres://lapato_owner:lapato@127.0.0.1:5432/lapato';

/** Ordem de remocao respeitando as dependencias entre as tabelas criadas. */
const TABELAS_CRIADAS = [
  'perfil_permissao',
  'perfil',
  'etapa_workflow',
  'definicao_workflow',
  'modelo_etiqueta',
  'servico',
  'termo',
  'tabela_mestre',
  'setor',
  'unidade',
  'politica_ia',
];

let db: Database;
let encerrar: () => Promise<void>;
let tenantId: string;

/** Cria uma instituicao vazia. Slug unico: o teste nao depende de banco limpo. */
async function criarTenant(prefixo: string): Promise<string> {
  const [novo] = await db
    .insert(s.tenant)
    .values({
      slug: `${prefixo}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      razaoSocial: 'Instituição de Teste LTDA',
      nomeFantasia: 'Teste',
    })
    .returning();
  return novo!.id;
}

/**
 * Remove tudo que a base criou. O owner tambem esta sujeito a policy
 * (FORCE ROW LEVEL SECURITY), entao a limpeza roda dentro de `comTenant`.
 */
async function removerTenant(id: string): Promise<void> {
  await comTenant(db, id, async (tx) => {
    for (const tabela of TABELAS_CRIADAS) {
      await tx.execute(sql`delete from ${sql.identifier(tabela)} where tenant_id = ${id}`);
    }
  });
  await db.execute(sql`delete from tenant where id = ${id}`);
}

beforeAll(async () => {
  ({ db, encerrar } = criarConexao({ url: URL_OWNER, max: 2 }));
  tenantId = await criarTenant('base-teste');
  await comTenant(db, tenantId, (tx) => criarBaseInstitucional(tx, tenantId));
});

afterAll(async () => {
  if (tenantId) await removerTenant(tenantId);
  await encerrar?.();
});

describe('configuracao institucional minima', () => {
  test('cria uma unica unidade quando nao ha laboratorio de apoio', async () => {
    const unidades = await comTenant(db, tenantId, (tx) =>
      tx.select().from(s.unidade).where(eq(s.unidade.tenantId, tenantId)),
    );

    expect(unidades).toHaveLength(1);
    expect(unidades[0]!.tipo).toBe('sede');
  });

  test('cria os cinco setores do fluxo', async () => {
    const setores = await comTenant(db, tenantId, (tx) =>
      tx.select({ tipo: s.setor.tipo }).from(s.setor).where(eq(s.setor.tenantId, tenantId)),
    );

    expect(setores.map((x) => x.tipo).sort()).toEqual([
      'histotecnica',
      'macroscopia',
      'microscopia',
      'recepcao',
      'triagem',
    ]);
  });

  test('cria os tres servicos com as flags que o motor de fluxo consulta', async () => {
    const servicos = await comTenant(db, tenantId, (tx) =>
      tx.select().from(s.servico).where(eq(s.servico.tenantId, tenantId)),
    );

    expect(servicos).toHaveLength(3);

    const histo = servicos.find((x) => x.codigo === 'HISTO');
    expect(histo?.exigeMacroscopia).toBe(true);
    expect(histo?.exigeProcessamento).toBe(true);

    // M08: citologia nao passa por macroscopia. E a flag que faz o M07 pular a
    // etapa sem codigo especial - se ela inverter, o fluxo trava.
    const cito = servicos.find((x) => x.codigo === 'CITO');
    expect(cito?.exigeMacroscopia).toBe(false);
    expect(cito?.exigeProcessamento).toBe(false);
  });

  test('cria o workflow de histopatologia com as oito etapas em ordem', async () => {
    const etapas = await comTenant(db, tenantId, (tx) =>
      tx
        .select({ etapa: s.etapaWorkflow.etapa })
        .from(s.etapaWorkflow)
        .where(eq(s.etapaWorkflow.tenantId, tenantId))
        .orderBy(s.etapaWorkflow.ordem),
    );

    expect(etapas.map((x) => x.etapa)).toEqual([
      'aguardando_recebimento',
      'aguardando_triagem',
      'aguardando_macroscopia',
      'aguardando_processamento',
      'aguardando_microscopia',
      'aguardando_revisao',
      'aguardando_assinatura',
      'liberado',
    ]);
  });

  test('cria todos os perfis padrao', async () => {
    const perfis = await comTenant(db, tenantId, (tx) =>
      tx.select({ chave: s.perfil.chave }).from(s.perfil).where(eq(s.perfil.tenantId, tenantId)),
    );

    expect(perfis.map((x) => x.chave).sort()).toEqual(PERFIS.map((x) => x.chave).sort());
  });

  test('o administrador geral recebe todas as permissoes, com escopo de instituicao', async () => {
    const permissoes = await comTenant(db, tenantId, (tx) =>
      tx
        .select({ permissao: s.perfilPermissao.permissao, escopo: s.perfilPermissao.escopo })
        .from(s.perfilPermissao)
        .innerJoin(s.perfil, eq(s.perfil.id, s.perfilPermissao.perfilId))
        .where(eq(s.perfil.chave, PERFIS_PADRAO.ADMINISTRADOR_GERAL)),
    );

    expect(permissoes).toHaveLength(TODAS_PERMISSOES.length);
    expect(permissoes.every((x) => x.escopo === 'instituicao')).toBe(true);
  });

  test('o residente nao recebe permissao de assinar nem de liberar laudo', async () => {
    const permissoes = await comTenant(db, tenantId, (tx) =>
      tx
        .select({ permissao: s.perfilPermissao.permissao })
        .from(s.perfilPermissao)
        .innerJoin(s.perfil, eq(s.perfil.id, s.perfilPermissao.perfilId))
        .where(eq(s.perfil.chave, PERFIS_PADRAO.RESIDENTE)),
    );

    const chaves = permissoes.map((x) => x.permissao);
    // M11: o residente elabora, mas nao assina. Se isto passar a existir, a
    // supervisao vira decoracao.
    expect(chaves).not.toContain('laudo.assinar');
    expect(chaves).not.toContain('laudo.liberar');
  });

  test('nao cria nenhum dado de negocio', async () => {
    // O que separa `provision` de `seed`: nada ficticio entra no banco real.
    const vazias = await comTenant(db, tenantId, async (tx) => ({
      cliente: await tx.select().from(s.cliente).where(eq(s.cliente.tenantId, tenantId)),
      veterinario: await tx
        .select()
        .from(s.veterinario)
        .where(eq(s.veterinario.tenantId, tenantId)),
      paciente: await tx.select().from(s.paciente).where(eq(s.paciente.tenantId, tenantId)),
      caso: await tx.select().from(s.caso).where(eq(s.caso.tenantId, tenantId)),
      usuario: await tx.select().from(s.usuario).where(eq(s.usuario.tenantId, tenantId)),
    }));

    expect(vazias.cliente).toHaveLength(0);
    expect(vazias.veterinario).toHaveLength(0);
    expect(vazias.paciente).toHaveLength(0);
    expect(vazias.caso).toHaveLength(0);
    expect(vazias.usuario).toHaveLength(0);
  });

  test('cria a unidade de laboratorio de apoio somente quando pedida', async () => {
    const outro = await criarTenant('base-apoio');

    try {
      const base = await comTenant(db, outro, (tx) =>
        criarBaseInstitucional(tx, outro, {
          laboratorioApoio: { nome: 'Histolab Parceiro' },
        }),
      );

      expect(base.apoioId).not.toBeNull();

      const unidades = await comTenant(db, outro, (tx) =>
        tx.select({ tipo: s.unidade.tipo }).from(s.unidade).where(eq(s.unidade.tenantId, outro)),
      );

      expect(unidades.map((x) => x.tipo).sort()).toEqual(['laboratorio_apoio', 'sede']);
    } finally {
      await removerTenant(outro);
    }
  });
});
