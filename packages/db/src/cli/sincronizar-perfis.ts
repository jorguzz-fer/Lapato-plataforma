import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PERFIS_PADRAO, TODAS_PERMISSOES } from '@lapato/shared';
import { comTenant, criarConexao } from '../client.js';
import { PERFIS } from '../base-institucional.js';
import * as s from '../schema/index.js';

/**
 * Sincroniza os perfis padrao de uma instituicao existente com a base
 * institucional (M02).
 *
 * A base evolui - uma permissao nova entra no perfil de patologista, por
 * exemplo - mas o seed e o provision so criam; instituicao existente fica com a
 * foto do dia em que foi provisionada. Sem isto, cada evolucao da base viraria
 * um UPDATE artesanal por cliente.
 *
 * **Estritamente aditivo.** Insere as permissoes que faltam nos perfis padrao
 * (identificados pela `chave`) e nao remove nada: o que a instituicao
 * acrescentou por conta propria e configuracao dela, nao residuo. Remocao de
 * permissao e decisao administrativa, com tela e auditoria - nao um efeito
 * colateral de deploy.
 *
 * Uso em producao (a imagem nao leva tsx nem codigo-fonte):
 *
 *   node node_modules/@lapato/db/dist/cli/sincronizar-perfis.js
 *
 * Sem SINCRONIZAR_TENANT_SLUG, lista as instituicoes e para.
 * SINCRONIZAR_SIMULAR=sim mostra o que faria, sem gravar.
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. A sincronizacao roda com o usuario dono do schema.',
    );
  }

  const slug = process.env.SINCRONIZAR_TENANT_SLUG?.trim().toLowerCase();
  const simular = process.env.SINCRONIZAR_SIMULAR?.toLowerCase() === 'sim';

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    if (!slug) {
      const instituicoes = await db
        .select({ slug: s.tenant.slug, nome: s.tenant.nomeFantasia })
        .from(s.tenant);

      console.warn('');
      console.warn('SINCRONIZAR_TENANT_SLUG nao definida. Instituicoes existentes:');
      console.warn('');
      for (const i of instituicoes) {
        console.warn(`  ${i.slug}${' '.repeat(Math.max(1, 24 - i.slug.length))}${i.nome}`);
      }
      console.warn('');
      throw new Error('Rode de novo com SINCRONIZAR_TENANT_SLUG igual a um destes.');
    }

    const [instituicao] = await db
      .select({ id: s.tenant.id })
      .from(s.tenant)
      .where(eq(s.tenant.slug, slug))
      .limit(1);

    if (!instituicao) throw new Error(`Instituicao "${slug}" nao existe.`);

    await comTenant(db, instituicao.id, async (tx) => {
      let inseridas = 0;

      for (const def of PERFIS) {
        const [perfil] = await tx
          .select({ id: s.perfil.id })
          .from(s.perfil)
          .where(
            and(
              eq(s.perfil.tenantId, instituicao.id),
              eq(s.perfil.chave, def.chave),
              isNull(s.perfil.inativadoEm),
            ),
          )
          .limit(1);

        /**
         * Perfil padrao que nao existe na instituicao NAO e criado aqui.
         * Ausencia pode ser escolha (a instituicao o removeu); recria-lo por
         * baixo seria desfazer uma decisao administrativa em silencio.
         */
        if (!perfil) {
          console.warn(`  perfil "${def.chave}" nao existe em "${slug}" - pulado.`);
          continue;
        }

        const esperadas = def.permissoes === 'todas' ? TODAS_PERMISSOES : def.permissoes;

        const atuais = new Set(
          (
            await tx
              .select({ permissao: s.perfilPermissao.permissao })
              .from(s.perfilPermissao)
              .where(
                and(
                  eq(s.perfilPermissao.tenantId, instituicao.id),
                  eq(s.perfilPermissao.perfilId, perfil.id),
                  inArray(s.perfilPermissao.permissao, [...esperadas]),
                ),
              )
          ).map((l) => l.permissao),
        );

        const faltantes = esperadas.filter((permissao) => !atuais.has(permissao));
        if (faltantes.length === 0) continue;

        console.warn(`  ${def.chave}: +${faltantes.join(', +')}`);
        inseridas += faltantes.length;

        if (!simular) {
          await tx.insert(s.perfilPermissao).values(
            faltantes.map((permissao) => ({
              tenantId: instituicao.id,
              perfilId: perfil.id,
              permissao,
              escopo:
                def.chave === PERFIS_PADRAO.ADMINISTRADOR_GERAL ? 'instituicao' : 'unidade',
            })),
          );
        }
      }

      console.warn('');
      if (inseridas === 0) {
        console.warn(`Perfis de "${slug}" ja estao em dia com a base. Nada a fazer.`);
      } else if (simular) {
        console.warn(`${inseridas} permissao(oes) faltando. SINCRONIZAR_SIMULAR=sim: nada gravado.`);
      } else {
        console.warn(
          `${inseridas} permissao(oes) adicionada(s). Vale na proxima sessao de cada usuario.`,
        );
      }
    });
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
