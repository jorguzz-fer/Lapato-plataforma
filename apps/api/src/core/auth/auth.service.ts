import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as TOTP from 'otpauth';
import { sessao, tenant, usuario, type Transacao } from '@lapato/db';
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
  /** True quando o usuario tem MFA e ainda nao validou o codigo. */
  mfaPendente: boolean;
}

export interface SessaoResolvida {
  tenantId: string;
  usuarioId: string;
  unidadeId: string | null;
  setorId: string | null;
  clienteId: string | null;
  permissoes: PermissoesResolvidas;
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

    return this.db.executarComTenant(instituicao.id, async (tx) => {
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
        await this.registrarFalha(tx, conta.id, conta.tentativasFalhas);
        throw new UnauthorizedException('Credenciais invalidas.');
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

      return this.criarSessao(tx, instituicao.id, conta.id, {
        unidadeId: conta.unidadePrincipalId,
        mfaPendente: conta.mfaAtivo,
      });
    });
  }

  /** M02: valida o segundo fator e libera a sessao. */
  async validarMfa(tokenBruto: string, codigo: string): Promise<void> {
    const resolvida = await this.buscarSessaoBruta(tokenBruto);
    if (!resolvida) throw new UnauthorizedException('Sessao invalida.');

    await this.db.executarComTenant(resolvida.tenantId, async (tx) => {
      const [conta] = await tx
        .select({ mfaSegredo: usuario.mfaSegredo })
        .from(usuario)
        .where(eq(usuario.id, resolvida.usuarioId))
        .limit(1);

      if (!conta?.mfaSegredo) throw new UnauthorizedException('MFA nao configurado.');

      const totp = new TOTP.TOTP({
        issuer: this.env.MFA_ISSUER,
        secret: TOTP.Secret.fromBase32(conta.mfaSegredo),
      });

      // `window: 1` tolera um passo de 30s de diferenca de relogio.
      if (totp.validate({ token: codigo, window: 1 }) === null) {
        throw new UnauthorizedException('Codigo invalido.');
      }

      await tx
        .update(sessao)
        .set({ mfaValidado: true })
        .where(eq(sessao.tokenHash, this.hashToken(tokenBruto)));
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
        })
        .from(usuario)
        .where(eq(usuario.id, bruta.usuarioId))
        .limit(1);

      // Status revogado invalida a sessao imediatamente, sem esperar expirar.
      if (!conta || conta.status !== 'ativo') return null;
      if (conta.mfaAtivo && !bruta.mfaValidado) return null;

      const permissoes = await resolverPermissoes(tx, bruta.tenantId, bruta.usuarioId);

      await tx
        .update(sessao)
        .set({ ultimoUsoEm: new Date() })
        .where(eq(sessao.id, bruta.sessaoId));

      return {
        tenantId: bruta.tenantId,
        usuarioId: bruta.usuarioId,
        unidadeId: bruta.unidadeAtivaId ?? conta.unidadePrincipalId,
        setorId: conta.setorPrincipalId,
        clienteId: conta.clienteId,
        permissoes,
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

  private async criarSessao(
    tx: Transacao,
    tenantId: string,
    usuarioId: string,
    opcoes: { unidadeId: string | null; mfaPendente: boolean },
  ): Promise<DadosSessao> {
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

    return {
      tokenBruto,
      usuarioId,
      tenantId,
      expiraEm,
      mfaPendente: opcoes.mfaPendente,
    };
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
