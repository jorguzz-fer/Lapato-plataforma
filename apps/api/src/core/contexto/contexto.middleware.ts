import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { ENV, type Env } from '../config/env.js';
import { executarComContexto, type ContextoRequisicao } from './contexto-requisicao.js';

/**
 * Resolve a sessao e abre o AsyncLocalStorage para todo o request.
 *
 * Precisa ser middleware, e nao guard: o `als.run()` mantem o contexto apenas
 * durante a execucao do callback. Num guard, o contexto morreria antes de o
 * controller rodar. Envolvendo `next()`, ele cobre a cadeia inteira - guards,
 * interceptors, controller e services - inclusive atravessando `await`.
 *
 * Nao rejeita request sem sessao: quem decide se a rota exige autenticacao e o
 * `SessaoGuard`. Aqui apenas se estabelece o contexto quando ele existe.
 */
@Injectable()
export class ContextoMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    const token = (req.cookies as Record<string, string> | undefined)?.[
      this.env.SESSION_COOKIE_NAME
    ];

    if (!token) {
      next();
      return;
    }

    const sessao = await this.auth.resolverSessao(token);
    if (!sessao) {
      // Cookie invalido ou expirado: segue sem contexto. O guard devolve 401
      // nas rotas protegidas.
      next();
      return;
    }

    const contexto: ContextoRequisicao = {
      requestId,
      tenantId: sessao.tenantId,
      usuarioId: sessao.usuarioId,
      unidadeId: sessao.unidadeId,
      setorId: sessao.setorId,
      clienteId: sessao.clienteId,
      permissoes: sessao.permissoes.permissoes,
      unidadesPermitidas: sessao.permissoes.unidadesPermitidas,
      exigeSupervisao: sessao.permissoes.exigeSupervisao,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };

    executarComContexto(contexto, () => {
      next();
    });
  }
}
