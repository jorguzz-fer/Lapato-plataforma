import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { Contexto, Publica } from './guards.js';
import { ENV, type Env } from '../config/env.js';
import { validarCorpo } from '../http/validacao.js';
import type { ContextoRequisicao } from '../contexto/contexto-requisicao.js';

const loginSchema = z.object({
  /** Slug da instituicao. Ver ADR 0002: e o que dispensa bypass de RLS. */
  instituicao: z.string().min(1),
  email: z.string().email(),
  senha: z.string().min(1),
});

const mfaSchema = z.object({ codigo: z.string().length(6) });

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Publica()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Autentica por instituição, e-mail e senha',
    description:
      'A sessão é devolvida em cookie httpOnly; o token nunca fica acessível ao JavaScript.',
  })
  async login(
    @Body() corpo: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ mfaPendente: boolean }> {
    const dados = validarCorpo(loginSchema, corpo);
    const sessao = await this.auth.autenticar(dados.instituicao, dados.email, dados.senha);

    /**
     * Blueprint secao 6: cookie httpOnly + Secure + SameSite, token fora do JS.
     * `sameSite: 'lax'` protege contra CSRF em navegacao de terceiros mantendo o
     * fluxo de login por link funcional.
     */
    res.cookie(this.env.SESSION_COOKIE_NAME, sessao.tokenBruto, {
      httpOnly: true,
      secure: this.env.SESSION_COOKIE_SECURE,
      sameSite: 'lax',
      expires: sessao.expiraEm,
      path: '/',
    });

    return { mfaPendente: sessao.mfaPendente };
  }

  @Publica()
  @Post('mfa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valida o segundo fator (TOTP) da sessão corrente' })
  async mfa(@Body() corpo: unknown, @Req() req: Request): Promise<{ ok: true }> {
    const dados = validarCorpo(mfaSchema, corpo);
    const token = (req.cookies as Record<string, string>)?.[this.env.SESSION_COOKIE_NAME] ?? '';
    await this.auth.validarMfa(token, dados.codigo);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string>)?.[this.env.SESSION_COOKIE_NAME] ?? '';
    await this.auth.encerrarSessao(token);
    res.clearCookie(this.env.SESSION_COOKIE_NAME, { path: '/' });
  }

  @Get('eu')
  @ApiOperation({ summary: 'Dados da sessão corrente e permissões efetivas' })
  eu(@Contexto() ctx: ContextoRequisicao) {
    return {
      usuarioId: ctx.usuarioId,
      tenantId: ctx.tenantId,
      unidadeId: ctx.unidadeId,
      setorId: ctx.setorId,
      clienteId: ctx.clienteId,
      exigeSupervisao: ctx.exigeSupervisao,
      permissoes: [...ctx.permissoes].sort(),
      unidadesPermitidas: [...ctx.unidadesPermitidas],
    };
  }
}
