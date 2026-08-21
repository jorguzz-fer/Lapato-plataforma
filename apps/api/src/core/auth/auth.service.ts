import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as TOTP from 'otpauth';
import { exigeMfa, SENHA_TAMANHO_MINIMO, type EstagioSessao } from '@lapato/shared';
import { sessao, tenant, unidade, usuario, type Transacao } from '@lapato/db';
import { DbService } from '../db/db.service.js';
import { ENV, type Env } from '../config/env.js';
import { resolverPermissoes, type PermissoesResolvidas } from './permissoes.resolver.js';

/** Numero de falhas consecutivas antes do bloqueio temporario. */
const LIMITE_TENTATIVAS = 5;
const MINUTOS_BLOQUEIO = 15;

export interface DadosSessao {
  tokenBruto: string;
  usuarioId: string;
  tenantId: string;
  expiraEm: Date;
  /** Em que ponto do funil de entrada a sessao parou. */
  estagio: EstagioSessao;
}

export interface SessaoResolvida {
  tenantId: string;
  usuarioId: string;
  unidadeId: string | null;
  setorId: string | null;
  clienteId: string | null;
  /** M09: preenchido quando a unidade ativa e um laboratorio de apoio. */
  laboratorioApoioId: string | null;
  permissoes: PermissoesResolvidas;
  estagio: EstagioSessao;
  mfaAtivo: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Autentica por instituicao + e-mail + senha.
   *
   * O `slugTenant` e obrigatorio de proposito: resolver a instituicao ANTES de
   * procurar o usuario permite que toda consulta a dado de dominio ja rode
   * escopada, e por isso o sistema nao precisa de nenhuma funcao de bypass da
   * RLS (ver comentario em `comTenant`).
   */
  async autenticar(
    slugTenant: string,
    email: string,
    senha: string,
  ): Promise<DadosSessao> {
    const [instituicao] = await this.db.raw
      .select({ id: tenant.id })
      .from(tenant)
      .where(and(eq(tenant.slug, slugTenant), isNull(tenant.inativadoEm)))
      .limit(1);

    // Blueprint secao 6: sem enumeracao. Instituicao inexistente, usuario
    // inexistente e senha errada devolvem exatamente a mesma resposta.
    if (!instituicao) throw new UnauthorizedException('Credenciais invalidas.');

    const resultado = await this.db.executarComTenant(instituicao.id, async (tx) => {
      const [conta] = await tx
        .select()
        .from(usuario)
        .where(and(eq(usuario.tenantId, instituicao.id), eq(usuario.email, email.toLowerCase())))
        .limit(1);

      if (!conta?.senhaHash) {
        // Gasta tempo comparavel ao caminho feliz, para nao vazar existencia da
        // conta pelo tempo de resposta.
        await argonHash('senha-inexistente-para-igualar-o-tempo');
        throw new UnauthorizedException('Credenciais invalidas.');
      }

      this.garantirNaoBloqueado(conta.tentativasFalhas);

      const senhaCorreta = await argonVerify(conta.senhaHash, senha);
      if (!senhaCorreta) {
        /**
         * A falha e devolvida, nao lancada.
         *
         * Lancar aqui derrubaria a transacao - e com ela o incremento do
         * contador de tentativas, que e o proprio ponto do bloqueio. O registro
         * acontece depois, numa transacao propria que chega a commitar.
         */
        return { tipo: 'falha' as const, usuarioId: conta.id, estado: conta.tentativasFalhas };
      }

      // M02 secao 8: cada status tem comportamento proprio. Só `ativo` entra.
      if (conta.status !== 'ativo') {
        throw new UnauthorizedException(`Conta com status "${conta.status}".`);
      }

      if (conta.acessoExpiraEm && conta.acessoExpiraEm < new Date()) {
        throw new UnauthorizedException('Acesso expirado.');
      }

      await tx
        .update(usuario)
        .set({
          tentativasFalhas: { contador: 0, bloqueadoAte: null },
          ultimoAcessoEm: new Date(),
        })
        .where(eq(usuario.id, conta.id));

      const dados = await this.criarSessao(tx, instituicao.id, conta.id, {
        unidadeId: conta.unidadePrincipalId,
        mfaPendente: conta.mfaAtivo,
      });

      return {
        tipo: 'ok' as const,
        sessao: {
          ...dados,
          estagio: await this.calcularEstagio(tx, instituicao.id, conta.id, {
            mfaAtivo: conta.mfaAtivo,
            mfaValidado: !conta.mfaAtivo,
            senhaTrocaObrigatoria: conta.senhaTrocaObrigatoria,
          }),
        },
      };
    });

    if (resultado.tipo === 'falha') {
      await this.db.executarComTenant(instituicao.id, (tx) =>
        this.registrarFalha(tx, resultado.usuarioId, resultado.estado),
      );
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    return resultado.sessao;
  }

  /** M02: valida o segundo fator e libera a sessao. */
  async validarMfa(tokenBruto: string, codigo: string): Promise<EstagioSessao> {
    const resolvida = await this.buscarSessaoBruta(tokenBruto);
    if (!resolvida) throw new UnauthorizedException('Sessao invalida.');

    const resultado = await this.db.executarComTenant(resolvida.tenantId, async (tx) => {
      const [conta] = await tx
        .select({
          mfaSegredo: usuario.mfaSegredo,
          mfaAtivo: usuario.mfaAtivo,
          senhaTrocaObrigatoria: usuario.senhaTrocaObrigatoria,
          tentativasFalhas: usuario.tentativasFalhas,
        })
        .from(usuario)
        .where(eq(usuario.id, resolvida.usuarioId))
        .limit(1);

      if (!conta?.mfaSegredo) throw new UnauthorizedException('MFA nao configurado.');

      /**
       * O segundo fator entra no mesmo lockout da senha.
       *
       * Sem isto o TOTP seria o elo fraco: seis digitos, janela de 90 segundos e
       * tentativas ilimitadas caem em minutos para quem ja tem a senha - e quem
       * chegou ate aqui ja tem. Compartilhar o contador com a senha e
       * deliberado: as duas falhas sao a mesma tentativa de invasao da mesma
       * conta, e somar as duas bloqueia mais cedo.
       */
      this.garantirNaoBloqueado(conta.tentativasFalhas);

      // Devolve em vez de lancar, pelo mesmo motivo de `autenticar`: a excecao
      // desfaria o incremento do contador.
      if (!this.codigoConfere(conta.mfaSegredo, codigo)) {
        return { tipo: 'falha' as const, estado: conta.tentativasFalhas };
      }

      await tx
        .update(usuario)
        .set({ tentativasFalhas: { contador: 0, bloqueadoAte: null } })
        .where(eq(usuario.id, resolvida.usuarioId));

      await tx
        .update(sessao)
        .set({ mfaValidado: true })
        .where(eq(sessao.tokenHash, this.hashToken(tokenBruto)));

      return {
        tipo: 'ok' as const,
        estagio: await this.calcularEstagio(tx, resolvida.tenantId, resolvida.usuarioId, {
          mfaAtivo: conta.mfaAtivo,
          mfaValidado: true,
          senhaTrocaObrigatoria: conta.senhaTrocaObrigatoria,
        }),
      };
    });

    if (resultado.tipo === 'falha') {
      await this.db.executarComTenant(resolvida.tenantId, (tx) =>
        this.registrarFalha(tx, resolvida.usuarioId, resultado.estado),
      );
      throw new UnauthorizedException('Codigo invalido.');
    }

    return resultado.estagio;
  }

  /**
   * Troca da propria senha.
   *
   * Exige a senha atual mesmo com sessao valida: sem isso, um cookie roubado
   * viraria posse permanente da conta, porque o atacante trocaria a senha e
   * expulsaria o dono. A senha atual e a prova de que quem pede e o titular.
   */
  async trocarSenha(tokenBruto: string, senhaAtual: string, senhaNova: string): Promise<void> {
    const bruta = await this.buscarSessaoBruta(tokenBruto);
    if (!bruta) throw new UnauthorizedException('Sessao invalida.');

    if (senhaNova.length < SENHA_TAMANHO_MINIMO) {
      throw new BadRequestException(
        `A nova senha precisa de pelo menos ${SENHA_TAMANHO_MINIMO} caracteres.`,
      );
    }

    await this.db.executarComTenant(bruta.tenantId, async (tx) => {
      const [conta] = await tx
        .select({ senhaHash: usuario.senhaHash })
        .from(usuario)
        .where(eq(usuario.id, bruta.usuarioId))
        .limit(1);

      if (!conta?.senhaHash) throw new UnauthorizedException('Conta sem senha definida.');

      if (!(await argonVerify(conta.senhaHash, senhaAtual))) {
        throw new UnauthorizedException('Senha atual incorreta.');
      }

      if (await argonVerify(conta.senhaHash, senhaNova)) {
        throw new BadRequestException('A nova senha precisa ser diferente da atual.');
      }

      await tx
        .update(usuario)
        .set({
          senhaHash: await argonHash(senhaNova),
          senhaTrocaObrigatoria: false,
          senhaAlteradaEm: new Date(),
        })
        .where(eq(usuario.id, bruta.usuarioId));

      /**
       * Blueprint secao 6: trocar a senha derruba as outras sessoes. Se a troca
       * aconteceu porque a senha vazou, deixar a sessao do atacante viva
       * esvaziaria o proprio motivo da troca. A sessao corrente sobrevive para
       * o usuario nao ser deslogado ao fazer a coisa certa.
       */
      await tx
        .update(sessao)
        .set({ revogadaEm: new Date() })
        .where(
          and(
            eq(sessao.usuarioId, bruta.usuarioId),
            ne(sessao.id, bruta.sessaoId),
            isNull(sessao.revogadaEm),
          ),
        );
    });
  }

  /**
   * Passo 1 do cadastro de MFA: gera o segredo e devolve a URI `otpauth://`.
   *
   * O segredo e gravado com `mfa_ativo = false`. Ate a confirmacao ele nao
   * protege nem atrapalha: se o usuario abandonar o processo, uma nova chamada
   * sorteia outro segredo e o anterior morre sem nunca ter valido.
   */
  async iniciarCadastroMfa(tokenBruto: string): Promise<{ segredo: string; uri: string }> {
    const bruta = await this.buscarSessaoBruta(tokenBruto);
    if (!bruta) throw new UnauthorizedException('Sessao invalida.');

    return this.db.executarComTenant(bruta.tenantId, async (tx) => {
      const [conta] = await tx
        .select({ email: usuario.email, mfaAtivo: usuario.mfaAtivo })
        .from(usuario)
        .where(eq(usuario.id, bruta.usuarioId))
        .limit(1);

      if (!conta) throw new UnauthorizedException('Sessao invalida.');

      /**
       * Trocar um MFA ja ativo e outra operacao: exige provar posse do fator
       * antigo. Sem essa rota, cookie roubado trocaria o segundo fator.
       */
      if (conta.mfaAtivo) {
        throw new ConflictException(
          'MFA ja esta ativo nesta conta. A substituicao do segundo fator ainda nao tem rota propria.',
        );
      }

      const segredo = new TOTP.Secret({ size: 20 }).base32;

      await tx.update(usuario).set({ mfaSegredo: segredo }).where(eq(usuario.id, bruta.usuarioId));

      const uri = new TOTP.TOTP({
        issuer: this.env.MFA_ISSUER,
        label: conta.email,
        secret: TOTP.Secret.fromBase32(segredo),
      }).toString();

      return { segredo, uri };
    });
  }

  /**
   * Passo 2: confirma que o aplicativo autenticador foi mesmo configurado.
   *
   * Sem esta prova, um erro de digitacao ao copiar o segredo produziria uma
   * conta com MFA ativo e nenhum jeito de gerar o codigo - ou seja, perdida.
   */
  async confirmarCadastroMfa(tokenBruto: string, codigo: string): Promise<void> {
    const bruta = await this.buscarSessaoBruta(tokenBruto);
    if (!bruta) throw new UnauthorizedException('Sessao invalida.');

    await this.db.executarComTenant(bruta.tenantId, async (tx) => {
      const [conta] = await tx
        .select({ mfaSegredo: usuario.mfaSegredo, mfaAtivo: usuario.mfaAtivo })
        .from(usuario)
        .where(eq(usuario.id, bruta.usuarioId))
        .limit(1);

      if (conta?.mfaAtivo) throw new ConflictException('MFA ja esta ativo nesta conta.');
      if (!conta?.mfaSegredo) {
        throw new BadRequestException('Nenhum cadastro de MFA em andamento.');
      }

      this.conferirCodigo(conta.mfaSegredo, codigo);

      await tx.update(usuario).set({ mfaAtivo: true }).where(eq(usuario.id, bruta.usuarioId));

      // A sessao corrente ja provou posse do fator agora mesmo.
      await tx.update(sessao).set({ mfaValidado: true }).where(eq(sessao.id, bruta.sessaoId));
    });
  }

  /**
   * Estagio da sessao sem exigir que ela esteja completa.
   *
   * Existe para que o front saiba **para onde mandar o usuario** logo no boot,
   * inclusive depois de um F5 no meio do segundo fator. Nao devolve permissao,
   * identificador nem qualquer dado de dominio: so o proximo passo.
   */
  async estagioDaSessao(tokenBruto: string): Promise<EstagioSessao> {
    const bruta = await this.buscarSessaoBruta(tokenBruto);
    if (!bruta) return 'anonimo';

    return this.db.executarComTenant(bruta.tenantId, async (tx) => {
      const [conta] = await tx
        .select({
          status: usuario.status,
          mfaAtivo: usuario.mfaAtivo,
          senhaTrocaObrigatoria: usuario.senhaTrocaObrigatoria,
        })
        .from(usuario)
        .where(eq(usuario.id, bruta.usuarioId))
        .limit(1);

      if (!conta || conta.status !== 'ativo') return 'anonimo';

      return this.calcularEstagio(tx, bruta.tenantId, bruta.usuarioId, {
        mfaAtivo: conta.mfaAtivo,
        mfaValidado: bruta.mfaValidado,
        senhaTrocaObrigatoria: conta.senhaTrocaObrigatoria,
      });
    });
  }

  /**
   * Resolve a sessao a partir do cookie e monta o contexto do request.
   * Devolve `null` quando a sessao nao existe, expirou ou foi revogada.
   */
  async resolverSessao(tokenBruto: string): Promise<SessaoResolvida | null> {
    const bruta = await this.buscarSessaoBruta(tokenBruto);
    if (!bruta) return null;

    return this.db.executarComTenant(bruta.tenantId, async (tx) => {
      const [conta] = await tx
        .select({
          status: usuario.status,
          unidadePrincipalId: usuario.unidadePrincipalId,
          setorPrincipalId: usuario.setorPrincipalId,
          clienteId: usuario.clienteId,
          mfaAtivo: usuario.mfaAtivo,
          senhaTrocaObrigatoria: usuario.senhaTrocaObrigatoria,
        })
        .from(usuario)
        .where(eq(usuario.id, bruta.usuarioId))
        .limit(1);

      // Status revogado invalida a sessao imediatamente, sem esperar expirar.
      if (!conta || conta.status !== 'ativo') return null;

      /**
       * MFA pendente nao produz contexto - nem sequer um contexto restrito.
       *
       * Os outros estagios incompletos (`troca_senha_obrigatoria`,
       * `mfa_cadastro_obrigatorio`) devolvem contexto e sao barrados pelo
       * `SessaoGuard`, que so aceita os estagios declarados na rota. Este aqui
       * nao, e a diferenca e proposital: enquanto o segundo fator nao foi
       * provado, a identidade ainda nao esta estabelecida. Um defeito no guard
       * viraria acesso indevido; sem contexto, vira 401.
       */
      if (conta.mfaAtivo && !bruta.mfaValidado) return null;

      const permissoes = await resolverPermissoes(tx, bruta.tenantId, bruta.usuarioId);

      /**
       * M09: o parceiro e isolado pela unidade dele, e o tipo vem do banco.
       *
       * Ler o tipo aqui - e nao confiar no perfil - mantem a regra ancorada no
       * dado: quem opera de dentro de um laboratorio de apoio ve os lotes
       * daquele laboratorio, independentemente de que perfil lhe deram.
       */
      const unidadeAtiva = bruta.unidadeAtivaId ?? conta.unidadePrincipalId;
      let laboratorioApoioId: string | null = null;

      if (unidadeAtiva) {
        const [dadosUnidade] = await tx
          .select({ tipo: unidade.tipo })
          .from(unidade)
          .where(eq(unidade.id, unidadeAtiva))
          .limit(1);

        if (dadosUnidade?.tipo === 'laboratorio_apoio') laboratorioApoioId = unidadeAtiva;
      }

      await tx
        .update(sessao)
        .set({ ultimoUsoEm: new Date() })
        .where(eq(sessao.id, bruta.sessaoId));

      return {
        tenantId: bruta.tenantId,
        usuarioId: bruta.usuarioId,
        unidadeId: unidadeAtiva,
        setorId: conta.setorPrincipalId,
        clienteId: conta.clienteId,
        laboratorioApoioId,
        permissoes,
        mfaAtivo: conta.mfaAtivo,
        estagio: this.estagioComPermissoes(
          {
            mfaAtivo: conta.mfaAtivo,
            mfaValidado: bruta.mfaValidado,
            senhaTrocaObrigatoria: conta.senhaTrocaObrigatoria,
          },
          permissoes.permissoes,
        ),
      };
    });
  }

  /** Revogacao imediata (Blueprint secao 6). */
  async encerrarSessao(tokenBruto: string): Promise<void> {
    const bruta = await this.buscarSessaoBruta(tokenBruto);
    if (!bruta) return;

    await this.db.executarComTenant(bruta.tenantId, async (tx) => {
      await tx
        .update(sessao)
        .set({ revogadaEm: new Date() })
        .where(eq(sessao.id, bruta.sessaoId));
    });
  }

  // --- internos ------------------------------------------------------------

  /**
   * Confere um codigo TOTP.
   *
   * `window: 1` tolera um passo de 30s de diferenca de relogio - o suficiente
   * para celular dessincronizado, sem transformar a janela de validade num
   * intervalo confortavel para forca bruta.
   */
  private codigoConfere(segredoBase32: string, codigo: string): boolean {
    const totp = new TOTP.TOTP({
      issuer: this.env.MFA_ISSUER,
      secret: TOTP.Secret.fromBase32(segredoBase32),
    });

    return totp.validate({ token: codigo, window: 1 }) !== null;
  }

  private conferirCodigo(segredoBase32: string, codigo: string): void {
    if (!this.codigoConfere(segredoBase32, codigo)) {
      throw new UnauthorizedException('Codigo invalido.');
    }
  }

  /**
   * Decide o estagio quando as permissoes ja foram resolvidas.
   *
   * Separado de `calcularEstagio` para que `resolverSessao` - que ja pagou o
   * custo de resolver permissoes - nao resolva de novo a cada request.
   */
  private estagioComPermissoes(
    conta: { mfaAtivo: boolean; mfaValidado: boolean; senhaTrocaObrigatoria: boolean },
    permissoes: ReadonlySet<string>,
  ): EstagioSessao {
    if (conta.mfaAtivo && !conta.mfaValidado) return 'mfa_pendente';
    if (conta.senhaTrocaObrigatoria) return 'troca_senha_obrigatoria';
    if (!conta.mfaAtivo && exigeMfa(permissoes)) return 'mfa_cadastro_obrigatorio';
    return 'ativa';
  }

  /**
   * Decide o estagio resolvendo permissoes so quando for indispensavel.
   *
   * Os dois primeiros testes nao dependem de permissao nenhuma; quem para neles
   * - o caso comum no login - nao paga a consulta de perfis.
   */
  private async calcularEstagio(
    tx: Transacao,
    tenantId: string,
    usuarioId: string,
    conta: { mfaAtivo: boolean; mfaValidado: boolean; senhaTrocaObrigatoria: boolean },
  ): Promise<EstagioSessao> {
    if (conta.mfaAtivo && !conta.mfaValidado) return 'mfa_pendente';
    if (conta.senhaTrocaObrigatoria) return 'troca_senha_obrigatoria';
    if (conta.mfaAtivo) return 'ativa';

    const { permissoes } = await resolverPermissoes(tx, tenantId, usuarioId);
    return exigeMfa(permissoes) ? 'mfa_cadastro_obrigatorio' : 'ativa';
  }

  private async criarSessao(
    tx: Transacao,
    tenantId: string,
    usuarioId: string,
    opcoes: { unidadeId: string | null; mfaPendente: boolean },
  ): Promise<Omit<DadosSessao, 'estagio'>> {
    const tokenBruto = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);

    await tx.insert(sessao).values({
      tenantId,
      usuarioId,
      // Guardamos o HASH: vazamento do banco nao permite sequestrar sessoes.
      tokenHash: this.hashToken(tokenBruto),
      unidadeAtivaId: opcoes.unidadeId,
      expiraEm,
      mfaValidado: !opcoes.mfaPendente,
    });

    return { tokenBruto, usuarioId, tenantId, expiraEm };
  }

  /**
   * A busca da sessao roda sem escopo de tenant porque `sessao.token_hash` e
   * unico globalmente e o proprio registro carrega o `tenant_id` que sera usado
   * dali em diante. Nenhum dado de dominio e lido aqui.
   */
  private async buscarSessaoBruta(tokenBruto: string): Promise<{
    sessaoId: string;
    tenantId: string;
    usuarioId: string;
    unidadeAtivaId: string | null;
    mfaValidado: boolean;
  } | null> {
    if (!tokenBruto) return null;

    const linhas = await this.db.raw.execute<{
      id: string;
      tenant_id: string;
      usuario_id: string;
      unidade_ativa_id: string | null;
      mfa_validado: boolean;
    }>(sql`
      SELECT id, tenant_id, usuario_id, unidade_ativa_id, mfa_validado
      FROM sessao
      WHERE token_hash = ${this.hashToken(tokenBruto)}
        AND revogada_em IS NULL
        AND expira_em > now()
      LIMIT 1
    `);

    const linha = Array.from(linhas)[0];
    if (!linha) return null;

    return {
      sessaoId: linha.id,
      tenantId: linha.tenant_id,
      usuarioId: linha.usuario_id,
      unidadeAtivaId: linha.unidade_ativa_id,
      mfaValidado: linha.mfa_validado,
    };
  }

  private hashToken(tokenBruto: string): string {
    return createHash('sha256').update(tokenBruto).digest('hex');
  }

  /** Blueprint secao 6: lockout progressivo contra forca bruta. */
  private garantirNaoBloqueado(estado: { contador: number; bloqueadoAte: string | null }): void {
    if (estado.bloqueadoAte && new Date(estado.bloqueadoAte) > new Date()) {
      throw new UnauthorizedException(
        'Conta temporariamente bloqueada por tentativas de acesso. Tente novamente mais tarde.',
      );
    }
  }

  private async registrarFalha(
    tx: Transacao,
    usuarioId: string,
    estado: { contador: number; bloqueadoAte: string | null },
  ): Promise<void> {
    const contador = estado.contador + 1;
    const bloqueadoAte =
      contador >= LIMITE_TENTATIVAS
        ? new Date(Date.now() + MINUTOS_BLOQUEIO * 60_000).toISOString()
        : null;

    await tx
      .update(usuario)
      .set({ tentativasFalhas: { contador, bloqueadoAte } })
      .where(eq(usuario.id, usuarioId));

    if (bloqueadoAte) {
      this.logger.warn(`Conta ${usuarioId} bloqueada por ${MINUTOS_BLOQUEIO} minutos.`);
    }
  }

  /** Comparacao em tempo constante, para eventuais tokens fora do fluxo de sessao. */
  static compararSeguro(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
