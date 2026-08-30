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
      /**
       * O multer aborta o upload no meio do stream e o Nest traduz para 413 com
       * a mensagem em ingles do proprio multer ("File too large"). Ela chegaria
       * assim na tela.
       */
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        res.status(status).json({
          type: `https://lapato.app/erros/${status}`,
          title: 'Arquivo grande demais',
          status,
          detail: 'O arquivo excede o tamanho máximo aceito.',
          requestId,
        });
        return;
      }

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
         * M03 secao 20: a detecao de duplicidade devolve os cadastros
         * candidatos junto com o 409, para o front oferecer "abrir o
         * existente" ou "continuar mesmo assim" - sem uma segunda chamada.
         */
        ...(detalhes.duplicidades ? { duplicidades: detalhes.duplicidades } : {}),
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
    this.logger.error({ requestId, erro: descreverErro(excecao) }, 'erro nao tratado');

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      type: 'https://lapato.app/erros/500',
      title: 'Erro interno',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Ocorreu um erro inesperado. A equipe foi notificada.',
      requestId,
    });
  }
}

/**
 * Descreve o erro inteiro, e nao so a camada de fora.
 *
 * A partir do Drizzle 0.45 toda falha de consulta chega embrulhada num
 * `Failed query: select ...`, com a mensagem REAL do Postgres - "column does
 * not exist", "must appear in the GROUP BY clause" - escondida em `cause`.
 * Logar apenas `stack` produzia uma pagina de SQL sem uma palavra sobre o
 * motivo, e transformava cada 500 de producao numa adivinhacao.
 *
 * O mesmo vale para o driver: um erro de serializacao do postgres.js aparece
 * como `TypeError` de buffer duas camadas abaixo do que a aplicacao chamou.
 */
export function descreverErro(excecao: unknown): string {
  if (!(excecao instanceof Error)) return String(excecao);

  const partes: string[] = [excecao.stack ?? `${excecao.name}: ${excecao.message}`];

  let causa: unknown = (excecao as { cause?: unknown }).cause;
  // Limite baixo de proposito: e uma cadeia de causas, nao uma lista - se
  // passar disso, ha um ciclo, e um log infinito nao ajuda ninguem.
  for (let nivel = 0; causa instanceof Error && nivel < 5; nivel += 1) {
    partes.push(`  causa: ${causa.stack ?? `${causa.name}: ${causa.message}`}`);
    causa = (causa as { cause?: unknown }).cause;
  }

  return partes.join('\n');
}
