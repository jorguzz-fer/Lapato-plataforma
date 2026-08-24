import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PERFIS_PADRAO, TODAS_PERMISSOES } from '@lapato/shared';
import { comTenant, criarConexao } from '../client.js';
import { PERFIS } from '../base-institucional.js';
import * as s from '../schema/index.js';
import { resolverInstituicao } from './tenant.js';

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
      let inseridas = 0;
      let criados = 0;

      for (const def of PERFIS) {
        let [perfil] = await tx
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

        if (!perfil) {
          /**
           * Distinguir "a instituicao removeu" de "a versao trouxe depois".
           *
           * Perfil INATIVADO foi decisao administrativa, e recria-lo por baixo
           * seria desfaze-la em silencio. Perfil que nunca existiu - nenhuma
           * linha, nem inativada - e a base tendo evoluido depois do
           * provisionamento: foi o caso dos perfis do Portal, que chegaram com
           * o M04. Sem criar, a instituicao existente nunca teria como dar
           * acesso externo a ninguem.
           */
          const [inativado] = await tx
            .select({ id: s.perfil.id })
            .from(s.perfil)
            .where(
              and(eq(s.perfil.tenantId, instituicao.id), eq(s.perfil.chave, def.chave)),
            )
            .limit(1);

          if (inativado) {
            console.warn(`  perfil "${def.chave}" esta inativado em "${instituicao.slug}" - mantido.`);
            continue;
          }

          console.warn(`  perfil "${def.chave}" nao existe em "${instituicao.slug}" - criando.`);
          criados += 1;

          if (simular) continue;

          [perfil] = await tx
            .insert(s.perfil)
            .values({
              tenantId: instituicao.id,
              chave: def.chave,
              nome: def.nome,
              exigeSupervisao: def.exigeSupervisao ?? false,
            })
            .returning({ id: s.perfil.id });
        }

        if (!perfil) continue;

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
      const resumo = [
        criados > 0 ? `${criados} perfil(s) criado(s)` : '',
        inseridas > 0 ? `${inseridas} permissao(oes) adicionada(s)` : '',
      ]
        .filter(Boolean)
        .join(', ');

      if (!resumo) {
        console.warn(`Perfis de "${instituicao.slug}" ja estao em dia com a base. Nada a fazer.`);
      } else if (simular) {
        console.warn(`${resumo}. SINCRONIZAR_SIMULAR=sim: nada gravado.`);
      } else {
        console.warn(`${resumo}. Vale na proxima sessao de cada usuario.`);
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
