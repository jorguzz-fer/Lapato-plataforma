import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { PERFIS_PADRAO } from '@lapato/shared';
import { comTenant, criarConexao } from '../client.js';
import * as s from '../schema/index.js';
import { resolverInstituicao } from './tenant.js';

/**
 * Cria a equipe inicial de uma instituicao: um usuario por perfil padrao,
 * exceto o administrador (que o `provision` ja cria).
 *
 * Nao e o `seed`: o seed e de desenvolvimento, usa senha conhecida e se recusa
 * a rodar em producao. Aqui cada conta nasce com **senha provisoria aleatoria e
 * troca obrigatoria** (M02 secao 31) - impressa UMA vez, na tela de quem rodou;
 * o banco guarda so o hash. MFA nao e semeado: quem assina cadastra o proprio
 * TOTP no primeiro acesso, guiado pelo funil de sessao.
 *
 * **Idempotente por e-mail**: rodar de novo pula quem ja existe. As contas
 * nascem com o nome do perfil ("Patologista (conta inicial)") - renomeie para a
 * pessoa real na tela de Usuarios, ou crie as contas individuais por la e
 * bloqueie estas. M02 secao 3: uma conta e uma pessoa, nao uma funcao - estas
 * existem para a instituicao COMECAR, nao para ficar.
 *
 * Uso em producao (a imagem nao leva tsx nem codigo-fonte):
 *
 *   EQUIPE_TENANT_SLUG=lapato EQUIPE_EMAIL_DOMINIO=minhaclinica.com.br \
 *   node node_modules/@lapato/db/dist/cli/popular-equipe.js
 *
 * Opcional: EQUIPE_CRMV="CRMV-CE 12345" registra a identificacao profissional
 * do patologista - e ela que sai na assinatura do PDF do laudo (M11 secao 82).
 * Sem EQUIPE_TENANT_SLUG: com uma unica instituicao, usa ela; com varias, lista
 * e para.
 */

/** Um por perfil, na ordem em que a operacao precisa deles. */
const EQUIPE: Array<{
  chave: string;
  rotulo: string;
  prefixoEmail: string;
  externo?: boolean;
}> = [
  { chave: PERFIS_PADRAO.RECEPCAO, rotulo: 'Recepção', prefixoEmail: 'recepcao' },
  {
    chave: PERFIS_PADRAO.TECNICO_LABORATORIO,
    rotulo: 'Técnico de Laboratório',
    prefixoEmail: 'tecnico',
  },
  { chave: PERFIS_PADRAO.PATOLOGISTA, rotulo: 'Patologista', prefixoEmail: 'patologista' },
  { chave: PERFIS_PADRAO.RESIDENTE, rotulo: 'Residente', prefixoEmail: 'residente' },
  {
    chave: PERFIS_PADRAO.LABORATORIO_APOIO,
    rotulo: 'Laboratório de Apoio',
    prefixoEmail: 'apoio',
    externo: true,
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. O comando roda com o usuario dono do schema.',
    );
  }

  const slugPedido = process.env.EQUIPE_TENANT_SLUG?.trim().toLowerCase();
  const dominio = process.env.EQUIPE_EMAIL_DOMINIO?.trim().toLowerCase();
  const crmv = process.env.EQUIPE_CRMV?.trim();

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    /**
     * O dominio vem antes da instituicao de proposito: ele nao tem como ser
     * adivinhado, e descobrir a instituicao para so depois esbarrar nele
     * gastaria uma rodada do comando a toa.
     */
    if (!dominio || !dominio.includes('.')) {
      throw new Error(
        'EQUIPE_EMAIL_DOMINIO nao definida (ex.: minhaclinica.com.br). ' +
          'Os e-mails saem como recepcao@<dominio>, patologista@<dominio>...',
      );
    }

    const resolvida = await resolverInstituicao(db, slugPedido, 'EQUIPE_TENANT_SLUG');
    const [instituicao] = await db
      .select({ id: s.tenant.id, nome: s.tenant.nomeFantasia })
      .from(s.tenant)
      .where(eq(s.tenant.id, resolvida.id))
      .limit(1);

    if (!instituicao) throw new Error(`Instituicao "${resolvida.slug}" nao existe.`);

    const credenciais: Array<{ rotulo: string; email: string; senha: string }> = [];
    const pulados: string[] = [];
    const avisos: string[] = [];

    await comTenant(db, instituicao.id, async (tx) => {
      const unidades = await tx
        .select({ id: s.unidade.id, tipo: s.unidade.tipo, nome: s.unidade.nome })
        .from(s.unidade)
        .where(and(eq(s.unidade.tenantId, instituicao.id), isNull(s.unidade.inativadoEm)));

      const sede = unidades.find((u) => u.tipo === 'sede') ?? unidades[0];
      const apoio = unidades.find((u) => u.tipo === 'laboratorio_apoio');

      for (const def of EQUIPE) {
        const email = `${def.prefixoEmail}@${dominio}`;

        const [existente] = await tx
          .select({ id: s.usuario.id })
          .from(s.usuario)
          .where(and(eq(s.usuario.tenantId, instituicao.id), eq(s.usuario.email, email)))
          .limit(1);
        if (existente) {
          pulados.push(email);
          continue;
        }

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
        if (!perfil) {
          avisos.push(`Perfil "${def.chave}" nao existe na instituicao - conta nao criada.`);
          continue;
        }

        /**
         * M09: o isolamento do parceiro deriva da UNIDADE do tipo
         * laboratorio_apoio. Sem uma, a conta de apoio nao teria o que ver -
         * criar a unidade primeiro (tela de Administracao) e rodar de novo.
         */
        if (def.externo && !apoio) {
          avisos.push(
            'Nenhuma unidade do tipo laboratorio_apoio - conta de apoio nao criada. ' +
              'Crie a unidade em Administração → Unidades e rode de novo.',
          );
          continue;
        }

        // 12 bytes -> 16 chars base64url: entropia alta, sem +, / ou =.
        const senha = randomBytes(12).toString('base64url');

        const [novo] = await tx
          .insert(s.usuario)
          .values({
            tenantId: instituicao.id,
            nomeCompleto: `${def.rotulo} (conta inicial)`,
            email,
            senhaHash: await hash(senha),
            senhaTrocaObrigatoria: true,
            status: 'ativo',
            categoria: def.externo ? 'externo' : 'interno',
            unidadePrincipalId: (def.externo ? apoio!.id : sede?.id) ?? null,
            ...(def.chave === PERFIS_PADRAO.PATOLOGISTA && crmv
              ? { dadosProfissionais: { conselho: crmv } }
              : {}),
          })
          .returning({ id: s.usuario.id });

        await tx.insert(s.usuarioPerfil).values({
          tenantId: instituicao.id,
          usuarioId: novo!.id,
          perfilId: perfil.id,
        });

        if (def.chave === PERFIS_PADRAO.PATOLOGISTA && crmv) {
          // M11 secao 82: e esta identificacao que sai na assinatura do PDF.
          await tx.insert(s.assinaturaProfissional).values({
            tenantId: instituicao.id,
            usuarioId: novo!.id,
            identificacaoProfissional: crmv,
            tipo: 'eletronica',
          });
        }

        credenciais.push({ rotulo: def.rotulo, email, senha });
      }
    });

    console.warn('');
    console.warn(`Equipe inicial de "${instituicao.nome}" (${resolvida.slug}):`);
    console.warn('');

    if (credenciais.length > 0) {
      console.warn('  ANOTE AGORA - as senhas provisorias nao aparecem de novo.');
      console.warn('  O primeiro acesso exige troca de senha; quem assina cadastra o MFA.');
      console.warn('');
      for (const c of credenciais) {
        const espaco = ' '.repeat(Math.max(1, 26 - c.rotulo.length));
        console.warn(`  ${c.rotulo}${espaco}${c.email}  ${c.senha}`);
      }
      console.warn('');
      console.warn('  Renomeie cada conta para a pessoa real na tela de Usuários - ou crie');
      console.warn('  as contas individuais por lá e bloqueie estas (M02 seção 3).');
    } else {
      console.warn('  Nenhuma conta nova criada.');
    }

    if (pulados.length > 0) {
      console.warn('');
      console.warn(`  Já existiam (pulados): ${pulados.join(', ')}`);
    }
    for (const a of avisos) {
      console.warn('');
      console.warn(`  AVISO: ${a}`);
    }
    if (
      credenciais.some((c) => c.rotulo === 'Patologista') &&
      !crmv
    ) {
      console.warn('');
      console.warn(
        '  AVISO: patologista criado sem EQUIPE_CRMV - a assinatura do PDF sai sem a ' +
          'identificação profissional até o registro ser criado.',
      );
    }
    console.warn('');
  } finally {
    await encerrar();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  // A causa raiz do driver (permissao, coluna, conexao) fica em `cause`.
  if (erro instanceof Error && erro.cause) console.error(String(erro.cause));
  process.exit(1);
});
