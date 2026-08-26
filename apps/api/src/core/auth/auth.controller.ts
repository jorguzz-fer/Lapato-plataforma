import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  MFA_TAMANHO_CODIGO,
  SENHA_TAMANHO_MINIMO,
  type EstagioSessao,
} from '@lapato/shared';
import { AuthService } from './auth.service.js';
import { Contexto, PermiteEstagio, Publica } from './guards.js';
import { ENV, type Env } from '../config/env.js';
import { LimiteEntrada } from '../http/rate-limit.js';
import { validarCorpo } from '../http/validacao.js';
import type { ContextoRequisicao } from '../contexto/contexto-requisicao.js';

const loginSchema = z.object({
  /** Slug da instituicao. Ver ADR 0002: e o que dispensa bypass de RLS. */
  instituicao: z.string().min(1),
  email: z.string().email(),
  senha: z.string().min(1),
});

const mfaSchema = z.object({ codigo: z.string().length(MFA_TAMANHO_CODIGO) });

const trocaSenhaSchema = z.object({
  senhaAtual: z.string().min(1),
  senhaNova: z.string().min(SENHA_TAMANHO_MINIMO),
});

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Publica()
  @LimiteEntrada()
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
  ): Promise<{ estagio: EstagioSessao }> {
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

    return { estagio: sessao.estagio };
  }

  /**
   * Onde a sessao parou.
   *
   * Publica de proposito: e chamada antes de a sessao estar completa, inclusive
   * por quem nem tem cookie. Nao devolve nada alem do proximo passo - nenhum
   * identificador, permissao ou dado de dominio - entao responder a um
   * desconhecido nao revela nada sobre a instituicao.
   */
  @Publica()
  @Get('estado')
  @ApiOperation({ summary: 'Estágio da sessão corrente (para onde o front deve levar o usuário)' })
  async estado(@Req() req: Request): Promise<{ estagio: EstagioSessao }> {
    return { estagio: await this.auth.estagioDaSessao(this.token(req)) };
  }

  @Publica()
  @LimiteEntrada()
  @Post('mfa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Valida o segundo fator (TOTP) da sessão corrente' })
  async mfa(
    @Body() corpo: unknown,
    @Req() req: Request,
  ): Promise<{ estagio: EstagioSessao }> {
    const dados = validarCorpo(mfaSchema, corpo);
    return { estagio: await this.auth.validarMfa(this.token(req), dados.codigo) };
  }

  /**
   * Troca da propria senha.
   *
   * Aceita sessao em `troca_senha_obrigatoria` porque essa e exatamente a rota
   * que destrava esse estagio - e tambem em `mfa_cadastro_obrigatorio`, para que
   * quem precise fazer as duas coisas escolha a ordem.
   */
  @PermiteEstagio('ativa', 'troca_senha_obrigatoria', 'mfa_cadastro_obrigatorio')
  @Post('senha')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Troca a própria senha',
    description:
      'Exige a senha atual. Revoga as demais sessões do usuário e preserva a sessão corrente.',
  })
  async trocarSenha(
    @Body() corpo: unknown,
    @Req() req: Request,
  ): Promise<{ estagio: EstagioSessao }> {
    const dados = validarCorpo(trocaSenhaSchema, corpo);
    const token = this.token(req);
    await this.auth.trocarSenha(token, dados.senhaAtual, dados.senhaNova);
    return { estagio: await this.auth.estagioDaSessao(token) };
  }

  @PermiteEstagio('ativa', 'mfa_cadastro_obrigatorio')
  @Post('mfa/cadastro')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Inicia o cadastro do segundo fator',
    description:
      'Devolve a URI otpauth:// para leitura por QR Code. Só vale depois de confirmada.',
  })
  async iniciarCadastroMfa(@Req() req: Request): Promise<{ segredo: string; uri: string }> {
    return this.auth.iniciarCadastroMfa(this.token(req));
  }

  @PermiteEstagio('ativa', 'mfa_cadastro_obrigatorio')
  @Post('mfa/cadastro/confirmacao')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma o cadastro do segundo fator com um código válido' })
  async confirmarCadastroMfa(
    @Body() corpo: unknown,
    @Req() req: Request,
  ): Promise<{ estagio: EstagioSessao }> {
    const dados = validarCorpo(mfaSchema, corpo);
    const token = this.token(req);
    await this.auth.confirmarCadastroMfa(token, dados.codigo);
    return { estagio: await this.auth.estagioDaSessao(token) };
  }

  /**
   * Sair precisa funcionar em qualquer estagio.
   *
   * Sem isto, quem cai em `troca_senha_obrigatoria` e nao sabe a senha atual
   * fica preso numa tela sem saida - nem opera, nem desloga.
   */
  @Publica()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.encerrarSessao(this.token(req));
    res.clearCookie(this.env.SESSION_COOKIE_NAME, { path: '/' });
  }

  @Get('eu')
  @ApiOperation({ summary: 'Dados da sessão corrente e permissões efetivas' })
  eu(@Contexto() ctx: ContextoRequisicao) {
    return {
      usuarioId: ctx.usuarioId,
      nomeCompleto: ctx.nomeCompleto,
      tenantId: ctx.tenantId,
      unidadeId: ctx.unidadeId,
      setorId: ctx.setorId,
      clienteId: ctx.clienteId,
      laboratorioApoioId: ctx.laboratorioApoioId,
      exigeSupervisao: ctx.exigeSupervisao,
      permissoes: [...ctx.permissoes].sort(),
      unidadesPermitidas: [...ctx.unidadesPermitidas],
      estagio: ctx.estagio,
      mfaAtivo: ctx.mfaAtivo,
    };
  }

  /** O token vive em cookie httpOnly; o front nunca o monta em cabecalho. */
  private token(req: Request): string {
    return (req.cookies as Record<string, string> | undefined)?.[this.env.SESSION_COOKIE_NAME] ?? '';
  }
}
