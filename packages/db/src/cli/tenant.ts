import type { Database } from '../client.js';
import * as s from '../schema/index.js';

export interface InstituicaoResumo {
  id: string;
  slug: string;
  nome: string | null;
}

/**
 * Decide em qual instituicao o comando de manutencao vai operar.
 *
 * O LAPATO e multi-instituicao por construcao (ADR 0002), entao nenhum comando
 * pode adivinhar o alvo quando ha mais de uma - errar aqui e mexer no banco de
 * outro cliente. Mas a instalacao de instituicao unica e o caso comum, e nela a
 * variavel de ambiente nao desambigua nada: so obriga o operador a rodar o
 * comando duas vezes, uma para descobrir o slug e outra para usa-lo. E um
 * degrau que se repete a cada deploy com permissao nova.
 *
 * Por isso o que manda e a **ambiguidade**, nao a variavel:
 *
 * - slug informado → usa ele, e falha se nao existir;
 * - sem slug e **uma** instituicao → usa ela, dizendo qual;
 * - sem slug e **varias** → lista e para;
 * - nenhuma instituicao → diz que falta provisionar.
 *
 * `variavel` entra como parametro porque cada comando tem a sua
 * (`SINCRONIZAR_TENANT_SLUG`, `EQUIPE_TENANT_SLUG`, `VINCULO_TENANT_SLUG`) e a
 * mensagem precisa nomear a certa - quem esta no terminal de um container, no
 * meio de um deploy, nao vai adivinhar qual delas o comando le.
 *
 * Separada de `resolverInstituicao` para ser testavel: a decisao nao depende de
 * banco, e um teste que dependesse veria os tenants que os outros testes
 * deixam para tras.
 */
export function escolherInstituicao(
  instituicoes: InstituicaoResumo[],
  slug: string | undefined,
  variavel: string,
): InstituicaoResumo {
  if (slug) {
    const escolhida = instituicoes.find((i) => i.slug === slug);
    if (!escolhida) throw new Error(`Instituicao "${slug}" nao existe.`);
    return escolhida;
  }

  if (instituicoes.length === 0) {
    throw new Error('Nenhuma instituicao provisionada neste banco. Rode o provision antes.');
  }

  if (instituicoes.length === 1) {
    const unica = instituicoes[0]!;
    console.warn(`Instituicao unica: "${unica.slug}"${unica.nome ? ` (${unica.nome})` : ''}.`);
    console.warn(`Para escolher outra, defina ${variavel}.`);
    console.warn('');
    return unica;
  }

  console.warn('');
  console.warn(`${variavel} nao definida e ha mais de uma instituicao:`);
  console.warn('');
  for (const i of instituicoes) {
    console.warn(`  ${i.slug}${' '.repeat(Math.max(1, 24 - i.slug.length))}${i.nome ?? ''}`);
  }
  console.warn('');
  throw new Error(`Rode de novo com ${variavel} igual a um destes.`);
}

/** Busca as instituicoes e aplica `escolherInstituicao`. */
export async function resolverInstituicao(
  db: Database,
  slug: string | undefined,
  variavel: string,
): Promise<InstituicaoResumo> {
  const instituicoes = await db
    .select({ id: s.tenant.id, slug: s.tenant.slug, nome: s.tenant.nomeFantasia })
    .from(s.tenant);

  return escolherInstituicao(instituicoes, slug, variavel);
}
