import { and, eq, isNull } from 'drizzle-orm';
import { comTenant, criarConexao } from '../client.js';
import { WORKFLOWS_PADRAO } from '../base-institucional.js';
import * as s from '../schema/index.js';
import { resolverInstituicao } from './tenant.js';

/**
 * Cria os workflows padrao de modalidade que faltam numa instituicao existente
 * (M07).
 *
 * Mesma razao do `sincronizar-perfis`: a base institucional evolui, mas o
 * `provision` so cria - quem foi provisionado antes fica com a foto daquele
 * dia. Uma instituicao provisionada antes do M12 tem o workflow da
 * histopatologia e nao tem o da citopatologia; sem ele, cadastrar um caso
 * citologico devolve "Nenhum workflow ativo para a modalidade citopatologia".
 *
 * **Nao toca no que ja existe.** Se a modalidade ja tem workflow padrao ativo,
 * ele e deixado como esta, inclusive com etapas alteradas pela instituicao - o
 * fluxo configurado e decisao dela (M01: a configuracao e centralizada, a
 * utilizacao e distribuida). Este comando so preenche ausencia.
 *
 * Uso em producao (a imagem nao leva tsx nem codigo-fonte):
 *
 *   node node_modules/@lapato/db/dist/cli/sincronizar-workflows.js
 *
 * Sem SINCRONIZAR_TENANT_SLUG: com uma unica instituicao, usa ela; com varias,
 * lista e para.
 * SINCRONIZAR_SIMULAR=sim mostra o que faria, sem gravar.
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. A sincronizacao roda com o usuario dono do schema.',
    );
  }

  const slugPedido = process.env.SINCRONIZAR_TENANT_SLUG?.trim().toLowerCase();
  const simular = process.env.SINCRONIZAR_SIMULAR?.toLowerCase() === 'sim';

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    const instituicao = await resolverInstituicao(db, slugPedido, 'SINCRONIZAR_TENANT_SLUG');

    await comTenant(db, instituicao.id, async (tx) => {
      let criados = 0;

      for (const definicao of WORKFLOWS_PADRAO) {
        const [existente] = await tx
          .select({ id: s.definicaoWorkflow.id, nome: s.definicaoWorkflow.nome })
          .from(s.definicaoWorkflow)
          .where(
            and(
              eq(s.definicaoWorkflow.tenantId, instituicao.id),
              eq(s.definicaoWorkflow.modalidade, definicao.modalidade),
              isNull(s.definicaoWorkflow.servicoId),
              eq(s.definicaoWorkflow.ativo, true),
            ),
          )
          .limit(1);

        if (existente) {
          console.warn(`  ${definicao.modalidade}: já existe ("${existente.nome}") - mantido.`);
          continue;
        }

        console.warn(
          `  ${definicao.modalidade}: criando "${definicao.nome}" com ${definicao.etapas.length} etapas.`,
        );
        criados += 1;

        if (simular) continue;

        const [workflow] = await tx
          .insert(s.definicaoWorkflow)
          .values({
            tenantId: instituicao.id,
            nome: definicao.nome,
            servicoId: null,
            modalidade: definicao.modalidade,
          })
          .returning();

        await tx.insert(s.etapaWorkflow).values(
          definicao.etapas.map((etapa) => ({
            ...etapa,
            tenantId: instituicao.id,
            workflowId: workflow!.id,
          })),
        );
      }

      console.warn('');
      if (criados === 0) {
        console.warn(`Workflows de "${instituicao.slug}" ja estao em dia com a base. Nada a fazer.`);
      } else if (simular) {
        console.warn(`${criados} workflow(s) faltando. SINCRONIZAR_SIMULAR=sim: nada gravado.`);
      } else {
        console.warn(`${criados} workflow(s) criado(s). Vale para casos cadastrados a partir de agora.`);
      }
    });
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  // A causa raiz do driver (permissao, coluna, conexao) fica em `cause`.
  if (erro instanceof Error && erro.cause) console.error(String(erro.cause));
  process.exit(1);
});
