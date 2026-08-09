import { and, eq, isNull, or, gt } from 'drizzle-orm';
import {
  perfil,
  perfilPermissao,
  permissaoIndividual,
  usuarioPerfil,
  usuarioUnidade,
  type Transacao,
} from '@lapato/db';
import type { Permissao } from '@lapato/shared';

export interface PermissoesResolvidas {
  permissoes: Set<Permissao>;
  unidadesPermitidas: Set<string>;
  exigeSupervisao: boolean;
}

/**
 * Resolve as permissoes efetivas de um usuario (M02).
 *
 * M02 define a ordem de prioridade exata:
 *   bloqueio institucional -> restricao do caso -> restricao de unidade ->
 *   restricao do perfil -> permissao individual -> delegacao temporaria
 *
 * O que e resolvido aqui: perfil + permissao individual (positiva e negativa),
 * com expiracao. As restricoes por caso dependem do registro concreto e sao
 * aplicadas na hora da acao, pelos servicos de dominio.
 *
 * Ponto importante: **permissao individual NEGATIVA vence a do perfil**. E o
 * que permite tirar `laudo:liberar` de um patologista especifico sem precisar
 * criar um perfil so para ele, exatamente o cenario do M02 secao 10.
 */
export async function resolverPermissoes(
  tx: Transacao,
  tenantId: string,
  usuarioId: string,
  agora: Date = new Date(),
): Promise<PermissoesResolvidas> {
  const doPerfil = await tx
    .select({
      permissao: perfilPermissao.permissao,
      exigeSupervisao: perfil.exigeSupervisao,
    })
    .from(usuarioPerfil)
    .innerJoin(perfil, eq(perfil.id, usuarioPerfil.perfilId))
    .innerJoin(perfilPermissao, eq(perfilPermissao.perfilId, perfil.id))
    .where(
      and(
        eq(usuarioPerfil.tenantId, tenantId),
        eq(usuarioPerfil.usuarioId, usuarioId),
        // M01: inativacao em vez de exclusao - perfil inativo nao concede nada.
        isNull(perfil.inativadoEm),
      ),
    );

  const permissoes = new Set<Permissao>();
  let exigeSupervisao = false;

  for (const linha of doPerfil) {
    permissoes.add(linha.permissao as Permissao);
    if (linha.exigeSupervisao) exigeSupervisao = true;
  }

  const individuais = await tx
    .select({
      permissao: permissaoIndividual.permissao,
      concedida: permissaoIndividual.concedida,
    })
    .from(permissaoIndividual)
    .where(
      and(
        eq(permissaoIndividual.tenantId, tenantId),
        eq(permissaoIndividual.usuarioId, usuarioId),
        // M02: permissoes temporarias expiram automaticamente.
        or(isNull(permissaoIndividual.validoAte), gt(permissaoIndividual.validoAte, agora)),
      ),
    );

  // Aplicadas depois do perfil, e as negativas por ultimo, para vencerem.
  for (const linha of individuais) {
    if (linha.concedida) permissoes.add(linha.permissao as Permissao);
  }
  for (const linha of individuais) {
    if (!linha.concedida) permissoes.delete(linha.permissao as Permissao);
  }

  const unidades = await tx
    .select({ unidadeId: usuarioUnidade.unidadeId })
    .from(usuarioUnidade)
    .where(
      and(
        eq(usuarioUnidade.tenantId, tenantId),
        eq(usuarioUnidade.usuarioId, usuarioId),
        or(isNull(usuarioUnidade.validoAte), gt(usuarioUnidade.validoAte, agora)),
      ),
    );

  return {
    permissoes,
    unidadesPermitidas: new Set(unidades.map((u) => u.unidadeId)),
    exigeSupervisao,
  };
}
