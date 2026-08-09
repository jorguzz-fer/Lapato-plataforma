import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { eventoDominio, outboxEvento, type Transacao } from '@lapato/db';
import type { NovoEvento, VisibilidadeEvento } from '@lapato/shared';
import { exigirContexto } from '../contexto/contexto-requisicao.js';

/**
 * Publicacao de eventos de dominio.
 *
 * DIRETRIZES secao 17: a integracao entre modulos e por evento. Ao liberar um
 * laudo, o patologista executa uma acao; atualizar status, publicar no Portal,
 * notificar e registrar auditoria sao consequencias.
 *
 * O evento e gravado na MESMA transacao da mudanca de estado, junto com a linha
 * de outbox. E o padrao outbox transacional: ou os dois existem, ou nenhum -
 * nunca "gravou no banco mas nao publicou na fila".
 */
@Injectable()
export class EventosService {
  /**
   * Publica um evento dentro da transacao em curso.
   *
   * Recebe `tx` de proposito: emitir evento fora da transacao do fato que ele
   * descreve quebraria a garantia acima.
   */
  async publicar(tx: Transacao, evento: NovoEvento): Promise<string> {
    const ctx = exigirContexto();

    const [linha] = await tx
      .insert(eventoDominio)
      .values({
        tenantId: ctx.tenantId,
        tipo: evento.tipo,
        casoId: evento.casoId ?? null,
        moduloOrigem: evento.moduloOrigem,
        usuarioId: ctx.usuarioId,
        unidadeId: ctx.unidadeId,
        setorId: ctx.setorId,
        objetoTipo: evento.objetoTipo ?? null,
        objetoId: evento.objetoId ?? null,
        visibilidade: (evento.visibilidade ?? 'interno') as VisibilidadeEvento,
        payload: evento.payload ?? {},
        ocorridoEm: evento.ocorridoEm ?? new Date(),
      })
      .returning({ id: eventoDominio.id });

    await tx.insert(outboxEvento).values({
      tenantId: ctx.tenantId,
      eventoId: linha!.id,
    });

    return linha!.id;
  }

  /** Publica varios eventos de uma vez, preservando a ordem informada. */
  async publicarVarios(tx: Transacao, eventos: NovoEvento[]): Promise<string[]> {
    const ids: string[] = [];
    for (const evento of eventos) {
      ids.push(await this.publicar(tx, evento));
    }
    return ids;
  }

  /**
   * Linha do tempo do caso (DIRETRIZES secao 13).
   *
   * `visibilidades` permite ao Portal do Cliente receber apenas o que e
   * `externo`, sem que o Portal precise conhecer as regras de classificacao.
   */
  async linhaDoTempo(
    tx: Transacao,
    casoId: string,
    visibilidades?: VisibilidadeEvento[],
  ): Promise<
    Array<{
      id: string;
      tipo: string;
      moduloOrigem: string;
      usuarioId: string | null;
      objetoTipo: string | null;
      payload: Record<string, unknown>;
      ocorridoEm: Date;
    }>
  > {
    const ctx = exigirContexto();

    const condicoes = [
      eq(eventoDominio.tenantId, ctx.tenantId),
      eq(eventoDominio.casoId, casoId),
    ];
    if (visibilidades?.length) {
      condicoes.push(inArray(eventoDominio.visibilidade, visibilidades));
    }

    return tx
      .select({
        id: eventoDominio.id,
        tipo: eventoDominio.tipo,
        moduloOrigem: eventoDominio.moduloOrigem,
        usuarioId: eventoDominio.usuarioId,
        objetoTipo: eventoDominio.objetoTipo,
        payload: eventoDominio.payload,
        ocorridoEm: eventoDominio.ocorridoEm,
      })
      .from(eventoDominio)
      .where(condicoes.length > 1 ? and(...condicoes) : condicoes[0]!)
      .orderBy(desc(eventoDominio.ocorridoEm));
  }
}
