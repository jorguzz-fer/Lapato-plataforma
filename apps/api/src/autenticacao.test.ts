import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as TOTP from 'otpauth';
import { hash } from '@node-rs/argon2';
import { eq, and } from 'drizzle-orm';
import { criarConexao, comTenant, perfil, tenant, usuario, usuarioPerfil } from '@lapato/db';
import { AppModule } from './app.module.js';
import { ProblemaFilter } from './core/http/problema.filter.js';

/**
 * Funil de entrada (M02, Blueprint secao 6).
 *
 * Entrar nao e um passo so, e o que este arquivo prova e que **cada estagio
 * prende de verdade**: uma sessao parada em qualquer degrau nao alcanca rota de
 * negocio nenhuma, e so a acao daquele degrau a faz avancar.
 *
 * O caso que originou estes testes: o `provision` criava o administrador com MFA
 * ligado, o front ignorava o estagio devolvido pelo login e chamava `/auth/eu`,
 * que respondia 401 - e a tela de login voltava sem explicar nada. A conta
 * recem-criada era inacessivel.
 */

const BASE = '/api/v1';
const SEGREDO_MFA_DEMO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

let app: INestApplication;
let servidor: string;

function codigo(segredo = SEGREDO_MFA_DEMO): string {
  return new TOTP.TOTP({
    issuer: process.env.MFA_ISSUER ?? 'LAPATO',
    secret: TOTP.Secret.fromBase32(segredo),
  }).generate();
}

/** Sessao isolada: cada teste carrega o proprio cookie, sem estado global. */
function sessao() {
  let cookie = '';

  return {
    get cookie() {
      return cookie;
    },
    async req(metodo: string, caminho: string, corpo?: unknown) {
      const resposta = await fetch(`${servidor}${BASE}${caminho}`, {
        method: metodo,
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });

      const setCookie = resposta.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0]!;

      const texto = await resposta.text();
      return { status: resposta.status, body: texto ? JSON.parse(texto) : null };
    },
  };
}

/**
 * Usuario descartavel para os testes que alteram a propria conta.
 *
 * Criar em vez de reaproveitar o seed e o que mantem o arquivo re-executavel:
 * trocar a senha do `admin@lapato.local` faria a segunda rodada falhar no login.
 */
async function criarUsuarioDescartavel(opcoes: {
  senha: string;
  senhaTrocaObrigatoria?: boolean;
  perfilChave?: string;
  mfaSegredo?: string;
}): Promise<{ email: string; limpar: () => Promise<void> }> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL!;
  const { db, encerrar } = criarConexao({ url, max: 1 });

  const email = `teste-${Date.now()}-${Math.floor(performance.now() * 1000)}@lapato.local`;

  const [instituicao] = await db.select().from(tenant).where(eq(tenant.slug, 'demo')).limit(1);
  const tenantId = instituicao!.id;

  const senhaHash = await hash(opcoes.senha);

  await comTenant(db, tenantId, async (tx) => {
    const [u] = await tx
      .insert(usuario)
      .values({
        tenantId,
        nomeCompleto: 'Usuário de Teste',
        email,
        senhaHash,
        senhaTrocaObrigatoria: opcoes.senhaTrocaObrigatoria ?? false,
        mfaSegredo: opcoes.mfaSegredo ?? null,
        mfaAtivo: opcoes.mfaSegredo !== undefined,
        status: 'ativo',
        categoria: 'interno',
      })
      .returning();

    if (opcoes.perfilChave) {
      const [alvo] = await tx
        .select({ id: perfil.id })
        .from(perfil)
        .where(and(eq(perfil.tenantId, tenantId), eq(perfil.chave, opcoes.perfilChave)))
        .limit(1);

      if (!alvo) throw new Error(`perfil ${opcoes.perfilChave} nao encontrado no seed`);

      await tx.insert(usuarioPerfil).values({ tenantId, usuarioId: u!.id, perfilId: alvo.id });
    }
  });

  return {
    email,
    limpar: async () => {
      await comTenant(db, tenantId, async (tx) => {
        await tx.delete(usuario).where(and(eq(usuario.tenantId, tenantId), eq(usuario.email, email)));
      });
      await encerrar();
    },
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://lapato_app:lapato@127.0.0.1:5432/lapato';
  process.env.SESSION_SECRET ??= 'x'.repeat(48);
  process.env.COPILOT_PROVIDER = 'stub';
  process.env.NODE_ENV = 'test';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemaFilter());

  await app.listen(0);
  servidor = await app.getUrl();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('estágio da sessão', () => {
  test('sem cookie o estágio é anônimo', async () => {
    const s = sessao();
    const r = await s.req('GET', '/auth/estado');

    expect(r.status).toBe(200);
    expect(r.body.estagio).toBe('anonimo');
  });

  test('usuário com MFA para em mfa_pendente e só avança com o código', async () => {
    const s = sessao();

    const login = await s.req('POST', '/auth/login', {
      instituicao: 'demo',
      email: 'patologista@lapato.local',
      senha: 'lapato123',
    });

    expect(login.status).toBe(200);
    expect(login.body.estagio).toBe('mfa_pendente');

    // O estágio sobrevive a um F5: é lido do cookie, não da memória do front.
    const estado = await s.req('GET', '/auth/estado');
    expect(estado.body.estagio).toBe('mfa_pendente');

    // É exatamente aqui que o laço acontecia: a sessão existe, mas não vale.
    const antes = await s.req('GET', '/auth/eu');
    expect(antes.status).toBe(401);

    const errado = await s.req('POST', '/auth/mfa', { codigo: '000000' });
    expect(errado.status).toBe(401);

    const certo = await s.req('POST', '/auth/mfa', { codigo: codigo() });
    expect(certo.status).toBe(200);
    expect(certo.body.estagio).toBe('ativa');

    const depois = await s.req('GET', '/auth/eu');
    expect(depois.status).toBe(200);
    expect(depois.body.mfaAtivo).toBe(true);
  });

  /**
   * Blueprint secao 6: lockout progressivo.
   *
   * O contador de falhas era incrementado dentro da mesma transacao que a
   * excecao de credencial invalida derrubava - a gravacao voltava atras junto
   * com o rollback, e o bloqueio nunca acontecia. Este teste existe para que
   * isso nao volte silenciosamente.
   */
  test('senha errada repetida bloqueia a conta', async () => {
    const conta = await criarUsuarioDescartavel({ senha: 'uma-senha-bem-longa-2026' });

    try {
      const s = sessao();

      for (let i = 0; i < 5; i++) {
        const r = await s.req('POST', '/auth/login', {
          instituicao: 'demo',
          email: conta.email,
          senha: 'chute-errado',
        });
        expect(r.status).toBe(401);
      }

      // A senha correta não passa mais: a conta está bloqueada.
      const bloqueado = await s.req('POST', '/auth/login', {
        instituicao: 'demo',
        email: conta.email,
        senha: 'uma-senha-bem-longa-2026',
      });

      expect(bloqueado.status).toBe(401);
      expect(bloqueado.body.detail).toContain('bloqueada');
    } finally {
      await conta.limpar();
    }
  });

  test('o segundo fator entra no mesmo lockout da senha', async () => {
    const conta = await criarUsuarioDescartavel({
      senha: 'uma-senha-bem-longa-2026',
      mfaSegredo: SEGREDO_MFA_DEMO,
    });

    try {
      const s = sessao();
      await s.req('POST', '/auth/login', {
        instituicao: 'demo',
        email: conta.email,
        senha: 'uma-senha-bem-longa-2026',
      });

      // Cinco erros consecutivos: seis dígitos com janela de 90s cairiam em
      // minutos por força bruta se as tentativas fossem ilimitadas.
      for (let i = 0; i < 5; i++) {
        expect((await s.req('POST', '/auth/mfa', { codigo: '000000' })).status).toBe(401);
      }

      // Bloqueado a partir daqui: nem o código correto passa.
      const bloqueado = await s.req('POST', '/auth/mfa', { codigo: codigo() });
      expect(bloqueado.status).toBe(401);
      expect(bloqueado.body.detail).toContain('bloqueada');
    } finally {
      await conta.limpar();
    }
  });

  test('perfil sem exigência de MFA entra direto', async () => {
    const s = sessao();
    const login = await s.req('POST', '/auth/login', {
      instituicao: 'demo',
      email: 'recepcao@lapato.local',
      senha: 'lapato123',
    });

    expect(login.body.estagio).toBe('ativa');
    expect((await s.req('GET', '/auth/eu')).status).toBe(200);
  });
});

describe('troca de senha obrigatória', () => {
  test('senha provisória prende a sessão e a troca destrava', async () => {
    const conta = await criarUsuarioDescartavel({
      senha: 'senha-provisoria-do-provision',
      senhaTrocaObrigatoria: true,
    });

    try {
      const s = sessao();
      const login = await s.req('POST', '/auth/login', {
        instituicao: 'demo',
        email: conta.email,
        senha: 'senha-provisoria-do-provision',
      });

      expect(login.body.estagio).toBe('troca_senha_obrigatoria');

      // Sessão existe, mas nenhuma rota de negócio responde. O `estagio` no
      // corpo prova que quem barrou foi o gate de estágio, não a permissão.
      const bloqueada = await s.req('GET', '/catalogo/servicos');
      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.estagio).toBe('troca_senha_obrigatoria');

      const semSenhaAtual = await s.req('POST', '/auth/senha', {
        senhaAtual: 'chute-errado',
        senhaNova: 'uma-senha-bem-longa-2026',
      });
      expect(semSenhaAtual.status).toBe(401);

      const curta = await s.req('POST', '/auth/senha', {
        senhaAtual: 'senha-provisoria-do-provision',
        senhaNova: 'curta',
      });
      expect(curta.status).toBe(400);

      const ok = await s.req('POST', '/auth/senha', {
        senhaAtual: 'senha-provisoria-do-provision',
        senhaNova: 'uma-senha-bem-longa-2026',
      });
      expect(ok.status).toBe(200);
      expect(ok.body.estagio).toBe('ativa');

      // A sessão corrente sobrevive à troca: quem faz a coisa certa não é expulso.
      expect((await s.req('GET', '/auth/eu')).status).toBe(200);
    } finally {
      await conta.limpar();
    }
  });

  test('a senha nova não pode ser a atual', async () => {
    const conta = await criarUsuarioDescartavel({ senha: 'uma-senha-bem-longa-2026' });

    try {
      const s = sessao();
      await s.req('POST', '/auth/login', {
        instituicao: 'demo',
        email: conta.email,
        senha: 'uma-senha-bem-longa-2026',
      });

      const r = await s.req('POST', '/auth/senha', {
        senhaAtual: 'uma-senha-bem-longa-2026',
        senhaNova: 'uma-senha-bem-longa-2026',
      });

      expect(r.status).toBe(400);
    } finally {
      await conta.limpar();
    }
  });

  test('trocar a senha revoga as outras sessões da conta', async () => {
    const conta = await criarUsuarioDescartavel({ senha: 'uma-senha-bem-longa-2026' });

    try {
      const antiga = sessao();
      const nova = sessao();

      for (const s of [antiga, nova]) {
        await s.req('POST', '/auth/login', {
          instituicao: 'demo',
          email: conta.email,
          senha: 'uma-senha-bem-longa-2026',
        });
      }

      expect((await antiga.req('GET', '/auth/eu')).status).toBe(200);

      await nova.req('POST', '/auth/senha', {
        senhaAtual: 'uma-senha-bem-longa-2026',
        senhaNova: 'outra-senha-bem-longa-2026',
      });

      // O ponto da revogação: se a senha vazou, a sessão do atacante morre aqui.
      expect((await antiga.req('GET', '/auth/eu')).status).toBe(401);
      expect((await nova.req('GET', '/auth/eu')).status).toBe(200);
    } finally {
      await conta.limpar();
    }
  });
});

describe('cadastro obrigatório de MFA', () => {
  test('quem pode assinar laudo sem MFA é levado ao cadastro', async () => {
    const conta = await criarUsuarioDescartavel({
      senha: 'uma-senha-bem-longa-2026',
      perfilChave: 'patologista',
    });

    try {
      const s = sessao();
      const login = await s.req('POST', '/auth/login', {
        instituicao: 'demo',
        email: conta.email,
        senha: 'uma-senha-bem-longa-2026',
      });

      expect(login.body.estagio).toBe('mfa_cadastro_obrigatorio');

      const bloqueada = await s.req('GET', '/catalogo/servicos');
      expect(bloqueada.status).toBe(403);
      expect(bloqueada.body.estagio).toBe('mfa_cadastro_obrigatorio');

      const inicio = await s.req('POST', '/auth/mfa/cadastro');
      expect(inicio.status).toBe(200);
      expect(inicio.body.uri).toContain('otpauth://totp/');

      const errado = await s.req('POST', '/auth/mfa/cadastro/confirmacao', { codigo: '000000' });
      expect(errado.status).toBe(401);

      // Sem confirmação o MFA não ativa - senão um erro de digitação ao copiar o
      // segredo criaria uma conta com MFA ativo e nenhum app capaz de gerar código.
      expect((await s.req('GET', '/auth/estado')).body.estagio).toBe('mfa_cadastro_obrigatorio');

      const ok = await s.req('POST', '/auth/mfa/cadastro/confirmacao', {
        codigo: codigo(inicio.body.segredo),
      });
      expect(ok.status).toBe(200);
      expect(ok.body.estagio).toBe('ativa');
      expect((await s.req('GET', '/catalogo/servicos')).status).toBe(200);
    } finally {
      await conta.limpar();
    }
  });

  test('não se cadastra um segundo fator sobre outro já ativo', async () => {
    const s = sessao();
    await s.req('POST', '/auth/login', {
      instituicao: 'demo',
      email: 'patologista@lapato.local',
      senha: 'lapato123',
    });
    await s.req('POST', '/auth/mfa', { codigo: codigo() });

    // Substituir o fator existente exige provar posse do antigo, e essa rota
    // ainda não existe. Sem este 409, cookie roubado trocaria o segundo fator.
    const r = await s.req('POST', '/auth/mfa/cadastro');
    expect(r.status).toBe(409);
  });
});

describe('saída', () => {
  test('sair funciona mesmo com a sessão presa num estágio', async () => {
    const conta = await criarUsuarioDescartavel({
      senha: 'senha-provisoria-do-provision',
      senhaTrocaObrigatoria: true,
    });

    try {
      const s = sessao();
      await s.req('POST', '/auth/login', {
        instituicao: 'demo',
        email: conta.email,
        senha: 'senha-provisoria-do-provision',
      });

      // Sem isto, quem não souber a senha atual fica numa tela sem saída.
      expect((await s.req('POST', '/auth/logout')).status).toBe(204);
      expect((await s.req('GET', '/auth/estado')).body.estagio).toBe('anonimo');
    } finally {
      await conta.limpar();
    }
  });
});
