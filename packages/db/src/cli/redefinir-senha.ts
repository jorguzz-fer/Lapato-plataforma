import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { comTenant, criarConexao } from '../client.js';
import * as s from '../schema/index.js';

/**
 * Redefinicao administrativa de senha (M02).
 *
 * Existe para o caso em que o acesso se perdeu e nao ha ninguem de dentro para
 * restaurar: a senha do provisionamento foi anotada errado, o administrador
 * saiu, a conta travou. Sem isto, a alternativa e editar `senha_hash` a mao no
 * banco - e um `$argon2id$...` colado em shell com aspas duplas vira hash
 * corrompido, que produz "credenciais invalidas" sem nenhuma pista.
 *
 * O que faz, numa transacao so:
 *
 * - troca a senha (sorteada, ou a de `RESET_SENHA`);
 * - marca `senha_troca_obrigatoria`, porque uma senha definida por terceiro
 *   vale para um acesso;
 * - zera o contador de tentativas, que e o que sustenta o bloqueio temporario.
 *
 * O que NAO faz sem pedido explicito: mexer no `status` e no segundo fator.
 * Conta suspensa foi suspensa por um motivo, e limpar MFA de quem nao pediu
 * enfraquece a conta em vez de recupera-la.
 *
 * Uso:
 *
 *   RESET_TENANT_SLUG=lapato RESET_EMAIL=alguem@exemplo.com \
 *   node node_modules/@lapato/db/dist/cli/redefinir-senha.js
 */

/** Igual ao do provisionamento: senha digitada uma vez, vinda de fora. */
const MINIMO_SENHA = 16;

function obrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`${nome} nao definida.`);
  return valor;
}

function sortearSenha(): string {
  return randomBytes(18).toString('base64url');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. A redefinicao roda com o usuario dono do schema.',
    );
  }

  const slug = obrigatoria('RESET_TENANT_SLUG').toLowerCase();
  const email = obrigatoria('RESET_EMAIL').toLowerCase();

  const informada = process.env.RESET_SENHA;
  if (informada !== undefined && informada.length < MINIMO_SENHA) {
    throw new Error(
      `RESET_SENHA tem menos de ${MINIMO_SENHA} caracteres. ` +
        'Deixe a variavel ausente para que uma senha forte seja sorteada.',
    );
  }

  const senha = informada ?? sortearSenha();
  const limparMfa = process.env.RESET_MFA?.toLowerCase() === 'limpar';
  const reativar = process.env.RESET_REATIVAR?.toLowerCase() === 'sim';

  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    const [instituicao] = await db
      .select({ id: s.tenant.id })
      .from(s.tenant)
      .where(eq(s.tenant.slug, slug))
      .limit(1);

    if (!instituicao) throw new Error(`Instituicao "${slug}" nao existe.`);

    const senhaHash = await hash(senha);

    const conta = await comTenant(db, instituicao.id, async (tx) => {
      const [antes] = await tx
        .select({ id: s.usuario.id, nome: s.usuario.nomeCompleto, status: s.usuario.status })
        .from(s.usuario)
        .where(and(eq(s.usuario.tenantId, instituicao.id), eq(s.usuario.email, email)))
        .limit(1);

      if (!antes) return null;

      await tx
        .update(s.usuario)
        .set({
          senhaHash,
          senhaTrocaObrigatoria: true,
          // O bloqueio por tentativas some junto: de nada adianta senha nova
          // se a conta continua travada pelos erros anteriores.
          tentativasFalhas: { contador: 0, bloqueadoAte: null },
          ...(limparMfa ? { mfaSegredo: null, mfaAtivo: false } : {}),
          ...(reativar ? { status: 'ativo' as const } : {}),
        })
        .where(eq(s.usuario.id, antes.id));

      return antes;
    });

    if (!conta) throw new Error(`Nenhum usuario "${email}" na instituicao "${slug}".`);

    console.warn('');
    console.warn(`senha redefinida: ${conta.nome} <${email}> @ ${slug}`);
    console.warn('');
    console.warn('  SENHA (aparece uma unica vez):');
    console.warn(`    ${senha}`);
    console.warn('');
    console.warn('  Ela vale para um acesso: o primeiro login exige definir outra.');

    if (limparMfa) {
      console.warn('  MFA removido - o proximo login pedira novo cadastro do TOTP.');
    }

    /**
     * O status e reportado mesmo quando nao foi alterado. Sem isto, redefinir a
     * senha de uma conta suspensa pareceria resolver, e o login seguiria
     * falhando por outro motivo - com outra mensagem, ja fora deste comando.
     */
    const statusFinal = reativar ? 'ativo' : conta.status;
    if (statusFinal !== 'ativo') {
      console.warn('');
      console.warn(`  ATENCAO: a conta esta com status "${statusFinal}" e nao entra assim.`);
      console.warn('  Rode de novo com RESET_REATIVAR=sim se a reativacao for intencional.');
    }
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error('falha na redefinicao:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
