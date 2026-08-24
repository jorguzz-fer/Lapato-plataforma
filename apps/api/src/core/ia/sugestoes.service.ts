import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { sugestaoIa, type Transacao } from '@lapato/db';
import type { AchadoGuardian, CartaoCopiloto, FeedbackSugestao } from '@lapato/shared';
import { DbService } from '../db/db.service.js';
import { exigirContexto } from '../contexto/contexto-requisicao.js';

/**
 * Registro das sugestoes e alertas de IA (M17 secao 15).
 *
 * A documentacao exige que toda sugestao indique que foi produzida pela IA,
 * quais dados usou, quais fontes consultou e se houve inferencia - e que o
 * sistema guarde o modelo e a versao utilizados (secao 109).
 */
@Injectable()
export class SugestoesService {
  constructor(private readonly db: DbService) {}

  async registrarCartoes(
    cartoes: CartaoCopiloto[],
    modulo: string,
    casoId: string | null,
    etapa: string | null,
    modelo: string,
  ): Promise<void> {
    if (cartoes.length === 0) return;
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      await tx.insert(sugestaoIa).values(
        cartoes.map((c) => ({
          /**
           * O id do cartao vira o id da linha: e ele que o painel devolve no
           * feedback (M17 secao 15), e gerar outro id aqui quebraria o ciclo
           * apresentou -> usuario reagiu -> registrado.
           */
          id: c.id,
          tenantId: ctx.tenantId,
          casoId,
          usuarioId: ctx.usuarioId,
          componente: 'copiloto',
          moduloContexto: modulo,
          etapa,
          nivel: c.nivel,
          titulo: c.titulo,
          corpo: c.corpo,
          fontes: c.fontes,
          inferencia: c.inferencia ? 'sim' : 'nao',
          modelo,
        })),
      );
    });
  }

  /**
   * Registra os achados do Guardian.
   *
   * Recebe `tx` porque o achado precisa ser gravado na mesma transacao da acao
   * que o produziu - inclusive quando essa acao acaba sendo bloqueada, para a
   * tentativa ficar registrada.
   */
  async registrarAchadosGuardian(
    tx: Transacao,
    achados: AchadoGuardian[],
    casoId: string | null,
    etapa: string | null,
  ): Promise<void> {
    if (achados.length === 0) return;
    const ctx = exigirContexto();

    await tx.insert(sugestaoIa).values(
      achados.map((a) => ({
        tenantId: ctx.tenantId,
        casoId,
        usuarioId: ctx.usuarioId,
        componente: 'guardian',
        moduloContexto: a.modulo,
        etapa,
        nivel: a.nivel,
        codigo: a.codigo,
        titulo: a.codigo,
        corpo: a.mensagem,
        fontes: ['caso_atual'],
        // Guardian nao infere: ele compara dados observados.
        inferencia: 'nao',
        evidencias: a.evidencias ?? null,
        modelo: 'guardian-deterministico',
      })),
    );
  }

  async registrarFeedback(feedback: FeedbackSugestao): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      await tx
        .update(sugestaoIa)
        .set({
          acaoUsuario: feedback.acao,
          acaoUsuarioEm: new Date(),
          comentarioUsuario: feedback.comentario ?? null,
        })
        .where(
          and(eq(sugestaoIa.tenantId, ctx.tenantId), eq(sugestaoIa.id, feedback.sugestaoId)),
        );
    });
  }
}
