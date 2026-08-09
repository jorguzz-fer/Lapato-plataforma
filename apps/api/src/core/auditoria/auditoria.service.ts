import { Injectable } from '@nestjs/common';
import { auditLog, type Transacao } from '@lapato/db';
import { exigirContexto } from '../contexto/contexto-requisicao.js';

export interface RegistroAuditoria {
  entidade: string;
  entidadeId: string;
  /** criar | atualizar | inativar | acessar | exportar | imprimir */
  acao: string;
  casoId?: string | null;
  valorAnterior?: Record<string, unknown> | null;
  valorNovo?: Record<string, unknown> | null;
  justificativa?: string | null;
  /**
   * Preencher quando a alteracao acontece DEPOIS de validacao, assinatura ou
   * liberacao - o cenario que a Introducao secao 6.6 manda destacar.
   */
  aposValidacao?: string | null;
}

/**
 * Trilha de auditoria (DIRETRIZES secao 10).
 *
 * "Cada modulo devera registrar seus eventos, mas nao devera implementar um
 * sistema independente de auditoria." O M22 depois consome daqui.
 *
 * Distincao para `EventosService`: evento e fato de negocio (interessa ao fluxo
 * e a linha do tempo); auditoria e rastro tecnico de alteracao de dado
 * (interessa a conformidade). Liberar laudo gera evento; corrigir o telefone de
 * um cliente gera auditoria.
 */
@Injectable()
export class AuditoriaService {
  async registrar(tx: Transacao, registro: RegistroAuditoria): Promise<void> {
    const ctx = exigirContexto();

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      entidade: registro.entidade,
      entidadeId: registro.entidadeId,
      acao: registro.acao,
      usuarioId: ctx.usuarioId,
      unidadeId: ctx.unidadeId,
      casoId: registro.casoId ?? null,
      valorAnterior: registro.valorAnterior ?? null,
      valorNovo: registro.valorNovo ?? null,
      justificativa: registro.justificativa ?? null,
      aposValidacao: registro.aposValidacao ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
  }

  /**
   * Registra apenas os campos que mudaram.
   *
   * Guardar o registro inteiro a cada alteracao incharia a trilha e ainda
   * dificultaria responder "o que exatamente mudou?" - que e a pergunta que a
   * auditoria precisa responder.
   */
  async registrarAlteracao(
    tx: Transacao,
    entidade: string,
    entidadeId: string,
    antes: Record<string, unknown>,
    depois: Record<string, unknown>,
    extras: Partial<RegistroAuditoria> = {},
  ): Promise<void> {
    const anterior: Record<string, unknown> = {};
    const novo: Record<string, unknown> = {};

    for (const chave of Object.keys(depois)) {
      if (JSON.stringify(antes[chave]) !== JSON.stringify(depois[chave])) {
        anterior[chave] = antes[chave];
        novo[chave] = depois[chave];
      }
    }

    if (Object.keys(novo).length === 0) return;

    await this.registrar(tx, {
      entidade,
      entidadeId,
      acao: 'atualizar',
      valorAnterior: anterior,
      valorNovo: novo,
      ...extras,
    });
  }
}
