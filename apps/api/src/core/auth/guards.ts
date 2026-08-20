import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EstagioSessao, Permissao } from '@lapato/shared';
import { contextoAtual, exigirContexto } from '../contexto/contexto-requisicao.js';

/** Marca a rota como publica (login, health, validacao de laudo). */
export const PUBLICA = 'rota_publica';
export const Publica = () => SetMetadata(PUBLICA, true);

/**
 * Estagios de sessao que a rota aceita.
 *
 * O padrao, quando a rota nao declara nada, e aceitar apenas `ativa`. Isso faz
 * com que uma rota nova nasca fechada para sessao incompleta: esquecer o
 * decorador nega acesso, nunca concede.
 *
 * Usado pelas rotas que existem justamente para destravar a sessao - trocar a
 * senha provisoria, cadastrar o segundo fator.
 */
export const ESTAGIOS_META = 'estagios_permitidos';
export const PermiteEstagio = (...estagios: EstagioSessao[]) =>
  SetMetadata(ESTAGIOS_META, estagios);

/** Exige as permissoes indicadas (M02 secao 12: controle granular por acao). */
export const PERMISSOES_META = 'permissoes_exigidas';
export const ExigePermissao = (...permissoes: Permissao[]) =>
  SetMetadata(PERMISSOES_META, permissoes);

/** Injeta o contexto ja resolvido no handler. */
export const Contexto = createParamDecorator(() => exigirContexto());

/**
 * Guard de sessao.
 *
 * Blueprint secao 6: "cada request valida sessao/credencial + permissao. Nada de
 * 'protegido so no front'."
 *
 * O contexto em si e montado pelo `ContextoMiddleware`; aqui apenas se recusa o
 * request quando ele nao existe. Negar por padrao: rota sem `@Publica` exige
 * sessao.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contextoExec: ExecutionContext): boolean {
    const publica = this.reflector.getAllAndOverride<boolean>(PUBLICA, [
      contextoExec.getHandler(),
      contextoExec.getClass(),
    ]);
    if (publica) return true;

    const ctx = contextoAtual();
    if (!ctx) {
      throw new UnauthorizedException('Sessao ausente, invalida ou expirada.');
    }

    const permitidos = this.reflector.getAllAndOverride<EstagioSessao[]>(ESTAGIOS_META, [
      contextoExec.getHandler(),
      contextoExec.getClass(),
    ]);

    // Sem declaracao explicita, so sessao completa passa.
    if (!(permitidos ?? ['ativa']).includes(ctx.estagio)) {
      throw new ForbiddenException({
        title: 'Sessão incompleta',
        detail: 'Conclua a etapa pendente de acesso antes de usar o sistema.',
        estagio: ctx.estagio,
      });
    }

    return true;
  }
}

/**
 * Guard de permissao (M02).
 *
 * Confere o conjunto de permissoes ja resolvido - a hierarquia de precedencia
 * (perfil, individual positiva, individual negativa, expiracao) mora em
 * `resolverPermissoes`, para existir num lugar so.
 */
@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contextoExec: ExecutionContext): boolean {
    const exigidas = this.reflector.getAllAndOverride<Permissao[]>(PERMISSOES_META, [
      contextoExec.getHandler(),
      contextoExec.getClass(),
    ]);

    if (!exigidas || exigidas.length === 0) return true;

    const ctx = exigirContexto();
    const faltando = exigidas.filter((p) => !ctx.permissoes.has(p));

    if (faltando.length > 0) {
      throw new ForbiddenException(
        `Permissao insuficiente. Necessario: ${faltando.join(', ')}.`,
      );
    }

    return true;
  }
}
