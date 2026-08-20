import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import * as TOTP from 'otpauth';
import { PERFIS_PADRAO } from '@lapato/shared';
import { criarBaseInstitucional } from '../base-institucional.js';
import { comTenant, criarConexao } from '../client.js';
import * as s from '../schema/index.js';

/**
 * Provisionamento de uma instituicao real (Blueprint secao 16, item 12).
 *
 * E a contraparte de producao do `seed`: cria a instituicao, a unidade sede, os
 * setores, as tabelas mestres, os servicos, o workflow, os perfis e **um unico
 * usuario administrador** - e nada mais. Nenhum cliente, veterinario, paciente
 * ou caso ficticio entra no banco.
 *
 * Diferencas deliberadas em relacao ao seed:
 *
 * - **Senha nunca e conhecida de antemao.** Ou vem de `PROVISION_ADMIN_SENHA`
 *   (secret manager), ou e sorteada aqui e impressa **uma unica vez**. Nao ha
 *   como recupera-la depois: o banco guarda apenas o hash Argon2id.
 * - **MFA vem ligado.** O Blueprint secao 6 exige TOTP para administradores, e
 *   ainda nao existe rota de auto-cadastro de MFA. Se o segredo nao for salvo
 *   agora, a conta fica inacessivel. Ele tambem e impresso uma unica vez.
 * - **Roda em producao.** E o unico comando de escrita que roda.
 *
 * Uso:
 *
 *   PROVISION_TENANT_SLUG=lapato \
 *   PROVISION_RAZAO_SOCIAL="LAPATO Necropsia Veterinária LTDA" \
 *   PROVISION_ADMIN_NOME="Fulano de Tal" \
 *   PROVISION_ADMIN_EMAIL=fulano@exemplo.com.br \
 *   pnpm db:provision
 */

/** Tamanho minimo aceito quando a senha vem de fora. */
const MINIMO_SENHA = 16;

function obrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) {
    throw new Error(`${nome} nao definida. Ela identifica a instituicao ou o administrador.`);
  }
  return valor;
}

/**
 * Senha aleatoria de 144 bits em base64url. Forte o bastante para nao precisar
 * de politica de complexidade e curta o bastante para ser digitada uma vez
 * antes de o proprio administrador troca-la.
 */
function sortearSenha(): string {
  return randomBytes(18).toString('base64url');
}

/** Slug e o que o usuario digita no login; mantenha previsivel. */
function validarSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
    throw new Error(
      `PROVISION_TENANT_SLUG invalido: "${slug}". Use minusculas, numeros e hifen (3 a 32 caracteres).`,
    );
  }
  return slug;
}

interface Entrada {
  slug: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string | null;
  fusoHorario: string;
  unidadeNome: string;
  laboratorioApoio: string | null;
  adminNome: string;
  adminEmail: string;
  adminSenha: string;
  senhaSorteada: boolean;
  adminConselho: string | null;
  mfaLigado: boolean;
  mfaIssuer: string;
}

function lerEntrada(): Entrada {
  const slug = validarSlug(obrigatoria('PROVISION_TENANT_SLUG').toLowerCase());
  const razaoSocial = obrigatoria('PROVISION_RAZAO_SOCIAL');
  const adminEmail = obrigatoria('PROVISION_ADMIN_EMAIL').toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error(`PROVISION_ADMIN_EMAIL invalido: "${adminEmail}".`);
  }

  const informada = process.env.PROVISION_ADMIN_SENHA;
  if (informada !== undefined && informada.length < MINIMO_SENHA) {
    throw new Error(
      `PROVISION_ADMIN_SENHA tem menos de ${MINIMO_SENHA} caracteres. ` +
        'Deixe a variavel ausente para que uma senha forte seja sorteada.',
    );
  }

  return {
    slug,
    razaoSocial,
    nomeFantasia: process.env.PROVISION_NOME_FANTASIA?.trim() || razaoSocial,
    cnpj: process.env.PROVISION_CNPJ?.trim() || null,
    fusoHorario: process.env.PROVISION_FUSO?.trim() || 'America/Fortaleza',
    unidadeNome: process.env.PROVISION_UNIDADE_NOME?.trim() || 'Unidade Sede',
    laboratorioApoio: process.env.PROVISION_LAB_APOIO_NOME?.trim() || null,
    adminNome: obrigatoria('PROVISION_ADMIN_NOME'),
    adminEmail,
    adminSenha: informada ?? sortearSenha(),
    senhaSorteada: informada === undefined,
    adminConselho: process.env.PROVISION_ADMIN_CONSELHO?.trim() || null,
    // Desligar MFA e possivel, mas contraria o Blueprint secao 6. Precisa ser explicito.
    mfaLigado: process.env.PROVISION_MFA?.toLowerCase() !== 'off',
    mfaIssuer: process.env.MFA_ISSUER?.trim() || 'LAPATO',
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. O provisionamento roda com o usuario dono do schema.',
    );
  }

  const entrada = lerEntrada();

  const segredoMfa = entrada.mfaLigado ? new TOTP.Secret({ size: 20 }).base32 : null;
  const uriMfa =
    segredoMfa === null
      ? null
      : new TOTP.TOTP({
          issuer: entrada.mfaIssuer,
          label: entrada.adminEmail,
          secret: TOTP.Secret.fromBase32(segredoMfa),
        }).toString();

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    const existente = await db
      .select({ id: s.tenant.id })
      .from(s.tenant)
      .where(eq(s.tenant.slug, entrada.slug))
      .limit(1);

    if (existente.length > 0) {
      // Nao e erro de operacao: normalmente e o mesmo comando rodado duas vezes.
      // Recriar sobre uma instituicao existente duplicaria perfis e servicos.
      throw new Error(
        `A instituicao "${entrada.slug}" ja existe. Provisionamento nao sobrescreve dados.`,
      );
    }

    const senhaHash = await hash(entrada.adminSenha);

    const [novo] = await db
      .insert(s.tenant)
      .values({
        slug: entrada.slug,
        razaoSocial: entrada.razaoSocial,
        nomeFantasia: entrada.nomeFantasia,
        cnpj: entrada.cnpj,
        preferencias: { idioma: 'pt-BR', fusoHorario: entrada.fusoHorario },
      })
      .returning();

    const tenantId = novo!.id;

    await comTenant(db, tenantId, async (tx) => {
      const base = await criarBaseInstitucional(tx, tenantId, {
        unidadeSede: { nome: entrada.unidadeNome },
        laboratorioApoio: entrada.laboratorioApoio ? { nome: entrada.laboratorioApoio } : null,
      });

      const [admin] = await tx
        .insert(s.usuario)
        .values({
          tenantId,
          nomeCompleto: entrada.adminNome,
          email: entrada.adminEmail,
          senhaHash,
          mfaSegredo: segredoMfa,
          mfaAtivo: segredoMfa !== null,
          status: 'ativo',
          categoria: 'interno',
          unidadePrincipalId: base.sedeId,
          setorPrincipalId: base.setores.find((x) => x.tipo === 'recepcao')?.id ?? null,
          dadosProfissionais: entrada.adminConselho ? { conselho: entrada.adminConselho } : {},
        })
        .returning();

      await tx.insert(s.usuarioPerfil).values({
        tenantId,
        usuarioId: admin!.id,
        perfilId: base.perfis.get(PERFIS_PADRAO.ADMINISTRADOR_GERAL)!,
      });

      await tx.insert(s.usuarioUnidade).values({
        tenantId,
        usuarioId: admin!.id,
        unidadeId: base.sedeId,
        nivelAcesso: 'total',
      });

      /**
       * M02: a assinatura e pessoal. So faz sentido para quem tem registro
       * profissional - um administrador puramente administrativo nao assina
       * laudo, e criar uma assinatura vazia seria dado falso.
       */
      if (entrada.adminConselho) {
        await tx.insert(s.assinaturaProfissional).values({
          tenantId,
          usuarioId: admin!.id,
          identificacaoProfissional: entrada.adminConselho,
          tipo: 'eletronica',
        });
      }
    });

    // Saida em stderr (console.warn) para nao acabar num pipe de log estruturado.
    console.warn('');
    console.warn(`instituicao "${entrada.slug}" provisionada.`);
    console.warn(`  razao social : ${entrada.razaoSocial}`);
    console.warn(`  unidade      : ${entrada.unidadeNome}`);
    console.warn(`  administrador: ${entrada.adminNome} <${entrada.adminEmail}>`);
    console.warn('');

    if (entrada.senhaSorteada) {
      console.warn('  SENHA INICIAL (aparece uma unica vez):');
      console.warn(`    ${entrada.adminSenha}`);
      console.warn('');
    }

    if (uriMfa) {
      console.warn('  MFA (TOTP) - cadastre no aplicativo autenticador AGORA:');
      console.warn(`    ${uriMfa}`);
      console.warn('');
      console.warn('  Sem este segredo nao ha login: ainda nao existe rota de recuperacao de MFA.');
    } else {
      console.warn('  ATENCAO: MFA desligado por PROVISION_MFA=off.');
      console.warn('  O Blueprint secao 6 exige TOTP para administradores.');
    }

    console.warn('');
    console.warn('  Limpe o historico do shell se a senha foi passada por variavel de ambiente.');
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error('falha no provisionamento:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
