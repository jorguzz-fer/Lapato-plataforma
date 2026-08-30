import { and, eq } from 'drizzle-orm';
import { comTenant, criarConexao } from '../client.js';
import * as s from '../schema/index.js';
import { resolverInstituicao } from './tenant.js';
import { PERIODO_TOTP, diagnosticarCodigo } from './mfa-diagnostico.js';

/**
 * Por que o segundo fator nao passa (M02).
 *
 * "Codigo invalido" tem duas causas muito diferentes e a tela nao consegue
 * distinguir: ou o aplicativo esta apontando para outro segredo, ou os relogios
 * se afastaram. O login aceita um passo de 30 s de folga; alem disso, todo
 * codigo do mundo falha - e quem esta olhando a tela ve a mesma mensagem que
 * veria digitando numeros ao acaso.
 *
 * Este comando mede em vez de adivinhar. Ele revalida o codigo numa janela
 * larga e, se o codigo bater fora da janela do login, diz de quantos segundos e
 * a diferenca e para que lado - o que transforma "nao passa" em "o relogio do
 * servidor esta 2 minutos adiantado".
 *
 * O segredo NUNCA e impresso. Quem roda isto ja tem o banco na mao, mas
 * despejar o segredo na tela o levaria para o historico do shell e para o log
 * do terminal, onde ele nao tem como ser revogado.
 *
 * Uso:
 *
 *   DIAG_EMAIL=alguem@exemplo.com DIAG_CODIGO=123456 \
 *   node node_modules/@lapato/db/dist/cli/diagnostico-mfa.js
 *
 * `DIAG_CODIGO` e opcional: sem ele, o comando so relata a hora do servidor e
 * o estado do MFA da conta.
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATION_URL nao definida. O diagnostico roda com o usuario dono do schema.',
    );
  }

  const email = process.env.DIAG_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('DIAG_EMAIL nao definida.');

  const codigo = process.env.DIAG_CODIGO?.trim().replace(/\s+/g, '');
  const slugPedido = process.env.DIAG_TENANT_SLUG?.trim().toLowerCase();

  const agora = new Date();
  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    const instituicao = await resolverInstituicao(db, slugPedido, 'DIAG_TENANT_SLUG');

    const conta = await comTenant(db, instituicao.id, async (tx) => {
      const [linha] = await tx
        .select({
          nome: s.usuario.nomeCompleto,
          status: s.usuario.status,
          mfaAtivo: s.usuario.mfaAtivo,
          mfaSegredo: s.usuario.mfaSegredo,
          tentativasFalhas: s.usuario.tentativasFalhas,
        })
        .from(s.usuario)
        .where(and(eq(s.usuario.tenantId, instituicao.id), eq(s.usuario.email, email)))
        .limit(1);

      return linha ?? null;
    });

    if (!conta) throw new Error(`Nenhum usuario "${email}" na instituicao "${instituicao.slug}".`);

    console.warn('');
    console.warn(`conta: ${conta.nome} <${email}> @ ${instituicao.slug}`);
    console.warn(`  status ............ ${conta.status}`);
    console.warn(`  MFA ativo ......... ${conta.mfaAtivo ? 'sim' : 'nao'}`);
    console.warn(`  segredo gravado ... ${conta.mfaSegredo ? 'sim' : 'nao'}`);

    /**
     * O bloqueio por tentativas e a outra causa que se disfarca de codigo
     * errado: depois do limite, mesmo o codigo certo e recusado.
     */
    const bloqueio = conta.tentativasFalhas;
    const bloqueadoAte = bloqueio?.bloqueadoAte ? new Date(bloqueio.bloqueadoAte) : null;
    console.warn(`  tentativas falhas . ${bloqueio?.contador ?? 0}`);
    if (bloqueadoAte && bloqueadoAte > agora) {
      console.warn('');
      console.warn(`  ATENCAO: conta bloqueada ate ${bloqueadoAte.toISOString()}.`);
      console.warn('  Ate la o codigo CERTO tambem e recusado. Espere, ou rode');
      console.warn('  redefinir-senha.js, que zera o contador.');
    }

    console.warn('');
    console.warn(`hora do servidor .... ${agora.toISOString()} (UTC)`);
    console.warn(`                      ${agora.toString()}`);
    console.warn('  Compare com https://time.is no celular do usuario. Uma diferenca');
    console.warn(`  maior que ${PERIODO_TOTP} s ja e suficiente para recusar todo codigo.`);

    if (!codigo) {
      console.warn('');
      console.warn('Sem DIAG_CODIGO: rode de novo com o codigo que o aplicativo mostra');
      console.warn('AGORA para medir a diferenca de relogio.');
      return;
    }

    if (!conta.mfaSegredo) {
      console.warn('');
      console.warn('Sem segredo gravado, nao ha o que conferir.');
      return;
    }

    const veredito = diagnosticarCodigo(conta.mfaSegredo, codigo);

    console.warn('');
    console.warn(`codigo informado .... ${codigo}`);

    if (veredito.tipo === 'formato') {
      console.warn('  RECUSADO ANTES DA CONFERENCIA: o codigo precisa ter 6 digitos.');
      console.warn('  Aplicativos mostram "123 456" - o espaco no meio nao entra.');
      return;
    }

    if (veredito.tipo === 'aceito') {
      console.warn('  VALIDO. Este codigo passaria no login agora.');
      console.warn('  Se mesmo assim a tela recusa, o codigo ja tinha expirado quando');
      console.warn('  chegou ao servidor, ou a conta esta bloqueada (veja acima).');
      return;
    }

    if (veredito.tipo === 'desalinhado') {
      const { segundos } = veredito;
      const lado = segundos > 0 ? 'ATRASADO' : 'ADIANTADO';
      console.warn(`  INVALIDO NO LOGIN, mas confere com ${Math.abs(segundos)} s de diferenca.`);
      console.warn('');
      console.warn(`  O relogio do SERVIDOR esta ${lado} ${Math.abs(segundos)} s em relacao`);
      console.warn('  ao aplicativo. E isto que recusa o codigo - o segredo esta certo.');
      console.warn('  Acerte o relogio do host (NTP) e o login volta sem mexer na conta.');
      return;
    }

    console.warn('  INVALIDO, e nao confere em nenhum momento proximo.');
    console.warn('');
    console.warn('  Nao e relogio: o aplicativo esta gerando de OUTRO segredo.');
    console.warn('  Costuma ser uma entrada antiga do autenticador, de antes de um');
    console.warn('  novo provisionamento. Para recadastrar:');
    console.warn('');
    console.warn(`    RESET_EMAIL=${email} RESET_MFA=limpar \\`);
    console.warn('      node node_modules/@lapato/db/dist/cli/redefinir-senha.js');
    console.warn('');
    console.warn('  O proximo login pede senha nova e um novo cadastro do segundo fator.');
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
