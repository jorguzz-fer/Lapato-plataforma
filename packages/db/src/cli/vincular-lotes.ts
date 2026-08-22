import { and, eq, isNull } from 'drizzle-orm';
import { comTenant, criarConexao } from '../client.js';
import * as s from '../schema/index.js';

/**
 * Vincula lotes orfaos ao laboratorio de apoio (M09).
 *
 * Ate o portal externo existir, `laboratorio_apoio_id` era opcional no envio do
 * lote. Depois que o parceiro passou a enxergar apenas os proprios lotes, um
 * lote sem destino ficou invisivel dos dois lados: nao aparece para nenhum
 * laboratorio, e nao ha tela que permita corrigi-lo - o envio acontece uma vez.
 *
 * Carta sem endereco, ja no correio. Este comando escreve o endereco.
 *
 * Por que um comando, e nao um `UPDATE` no terminal do banco: o schema roda com
 * `FORCE ROW LEVEL SECURITY`, entao ate o dono das tabelas enxerga zero linhas
 * sem declarar o tenant antes. Um `UPDATE` colado a mao responde "0 rows" e
 * parece ter encontrado nada, quando na verdade nem chegou a olhar.
 *
 * Nao adivinha o destino quando ha mais de um laboratorio cadastrado: escolher
 * errado manda material para o parceiro errado, e desfazer isso exige outro
 * comando. Nesse caso ele lista as opcoes e para.
 *
 * Uso em producao - a imagem nao leva `tsx` nem codigo-fonte, entao roda-se o
 * JavaScript compilado, como os demais comandos administrativos:
 *
 *   node node_modules/@lapato/db/dist/cli/vincular-lotes.js
 *
 * Em desenvolvimento:
 *
 *   pnpm --filter @lapato/db vincular-lotes
 *
 * Variaveis:
 *
 *   VINCULO_TENANT_SLUG      instituicao; sem ela, o comando lista as
 *                            existentes e para
 *   VINCULO_LABORATORIO_ID   destino, quando ha mais de um laboratorio
 *   VINCULO_SIMULAR=sim      mostra o que faria, sem gravar
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. O vinculo roda com o usuario dono do schema.',
    );
  }

  const slug = process.env.VINCULO_TENANT_SLUG?.trim().toLowerCase();
  const laboratorioInformado = process.env.VINCULO_LABORATORIO_ID?.trim();
  const simular = process.env.VINCULO_SIMULAR?.toLowerCase() === 'sim';

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    /**
     * Sem o slug, listar as instituicoes em vez de so recusar.
     *
     * Quem roda isto esta num terminal de container, num deploy, resolvendo um
     * problema - e nao com o `docs/` aberto ao lado. "VINCULO_TENANT_SLUG nao
     * definida" obrigaria a sair daqui para descobrir um dado que este mesmo
     * comando ja tem em maos.
     */
    if (!slug) {
      const instituicoes = await db
        .select({ slug: s.tenant.slug, nome: s.tenant.nomeFantasia })
        .from(s.tenant);

      console.warn('');
      console.warn('VINCULO_TENANT_SLUG nao definida. Instituicoes existentes:');
      console.warn('');
      for (const i of instituicoes) {
        console.warn(`  ${i.slug}${' '.repeat(Math.max(1, 24 - i.slug.length))}${i.nome}`);
      }
      console.warn('');
      throw new Error('Rode de novo com VINCULO_TENANT_SLUG igual a um destes.');
    }

    const [instituicao] = await db
      .select({ id: s.tenant.id })
      .from(s.tenant)
      .where(eq(s.tenant.slug, slug))
      .limit(1);

    if (!instituicao) throw new Error(`Instituicao "${slug}" nao existe.`);

    await comTenant(db, instituicao.id, async (tx) => {
      const orfaos = await tx
        .select({
          id: s.loteEnvio.id,
          identificador: s.loteEnvio.identificador,
          dataEnvio: s.loteEnvio.dataEnvio,
          status: s.loteEnvio.status,
        })
        .from(s.loteEnvio)
        .where(
          and(
            eq(s.loteEnvio.tenantId, instituicao.id),
            isNull(s.loteEnvio.laboratorioApoioId),
          ),
        );

      if (orfaos.length === 0) {
        console.warn('');
        console.warn(`Nenhum lote sem destino em "${slug}". Nada a fazer.`);
        return;
      }

      const laboratorios = await tx
        .select({ id: s.unidade.id, nome: s.unidade.nome, codigo: s.unidade.codigo })
        .from(s.unidade)
        .where(
          and(
            eq(s.unidade.tenantId, instituicao.id),
            eq(s.unidade.tipo, 'laboratorio_apoio'),
            isNull(s.unidade.inativadoEm),
          ),
        );

      if (laboratorios.length === 0) {
        throw new Error(
          `Nenhum laboratorio de apoio ativo em "${slug}". ` +
            'Cadastre a unidade antes de vincular os lotes.',
        );
      }

      const destino = laboratorioInformado
        ? laboratorios.find((l) => l.id === laboratorioInformado)
        : laboratorios.length === 1
          ? laboratorios[0]
          : undefined;

      if (!destino) {
        console.warn('');
        console.warn(
          laboratorioInformado
            ? `VINCULO_LABORATORIO_ID nao corresponde a um laboratorio de apoio de "${slug}".`
            : `Ha ${laboratorios.length} laboratorios de apoio. Escolher por conta propria mandaria material para o parceiro errado.`,
        );
        console.warn('');
        console.warn('  Rode de novo com VINCULO_LABORATORIO_ID igual a um destes:');
        for (const l of laboratorios) {
          console.warn(`    ${l.id}  ${l.nome}${l.codigo ? ` (${l.codigo})` : ''}`);
        }
        console.warn('');
        throw new Error('Destino nao determinado.');
      }

      console.warn('');
      console.warn(`${orfaos.length} lote(s) sem destino em "${slug}":`);
      for (const l of orfaos) {
        console.warn(`  ${l.identificador}  enviado em ${l.dataEnvio}  [${l.status}]`);
      }
      console.warn('');
      console.warn(`Destino: ${destino.nome}${destino.codigo ? ` (${destino.codigo})` : ''}`);

      if (simular) {
        console.warn('');
        console.warn('VINCULO_SIMULAR=sim: nada foi gravado.');
        return;
      }

      await tx
        .update(s.loteEnvio)
        .set({ laboratorioApoioId: destino.id })
        .where(
          and(
            eq(s.loteEnvio.tenantId, instituicao.id),
            isNull(s.loteEnvio.laboratorioApoioId),
          ),
        );

      console.warn('');
      console.warn(`${orfaos.length} lote(s) vinculado(s). O parceiro ja os enxerga.`);
    });
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
