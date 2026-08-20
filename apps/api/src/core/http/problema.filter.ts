import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { BloqueioGuardianError } from '@lapato/shared';
import { contextoAtual } from '../contexto/contexto-requisicao.js';

/**
 * Erros no formato RFC 7807 (Blueprint secao 8: "erros padrao RFC 7807").
 *
 * O caso especial e o `BloqueioGuardianError`: em vez de virar um 500 opaco,
 * ele devolve 409 com os achados estruturados, para o front conseguir exibi-los
 * no painel lateral com o nivel e a evidencia de cada um - que e como o M17
 * secao 11 espera que o alerta apareca.
 */
@Catch()
export class ProblemaFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(excecao: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = contextoAtual()?.requestId;

    if (excecao instanceof BloqueioGuardianError) {
      res.status(HttpStatus.CONFLICT).json({
        type: 'https://lapato.app/erros/bloqueio-guardian',
        title: 'Ação bloqueada pelo LAPATO Guardian',
        status: HttpStatus.CONFLICT,
        detail: excecao.message,
        acao: excecao.acao,
        achados: excecao.achados,
        requestId,
      });
      return;
    }

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      const corpo = excecao.getResponse();
      const detalhes =
        typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};

      res.status(status).json({
        type: `https://lapato.app/erros/${status}`,
        title: (detalhes.title as string) ?? excecao.name,
        status,
        detail: (detalhes.detail as string) ?? (detalhes.message as string) ?? excecao.message,
        ...(detalhes.errors ? { errors: detalhes.errors } : {}),
        /**
         * O estagio acompanha o 403 do `SessaoGuard`: sem ele o front so saberia
         * que foi proibido, e mandaria o usuario para a tela de "sem permissao"
         * quando o que falta e concluir uma etapa de acesso.
         */
        ...(detalhes.estagio ? { estagio: detalhes.estagio } : {}),
        requestId,
      });
      return;
    }

    // Erro nao previsto: loga com contexto, mas nao expõe interno ao cliente.
    this.logger.error(
      { requestId, erro: excecao instanceof Error ? excecao.stack : String(excecao) },
      'erro nao tratado',
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      type: 'https://lapato.app/erros/500',
      title: 'Erro interno',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Ocorreu um erro inesperado. A equipe foi notificada.',
      requestId,
    });
  }
}
