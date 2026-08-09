import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  amostra,
  caso,
  naoConformidadePreAnalitica,
  pendencia,
  triagem,
  type Transacao,
} from '@lapato/db';
import { MODULOS, type GravidadeNc, type ResultadoTriagem } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { SugestoesService } from '../../core/ia/sugestoes.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosTriagem {
  amostras: Array<{
    amostraId: string;
    resultado: ResultadoTriagem;
    observacoes?: string;
    checklist?: Record<string, unknown>;
  }>;
  naoConformidades?: Array<{
    amostraId?: string;
    tipo: string;
    gravidade: GravidadeNc;
    descricao: string;
    impactoPotencial?: string;
  }>;
}

/**
 * M06 - Triagem de Amostras.
 *
 * DIRETRIZES secao 8.1: o Cadastro registra o que foi informado; a Triagem
 * verifica o que existe fisicamente e se esta adequado. A triagem **confirma ou
 * contradiz** o cadastro - nao o substitui.
 *
 * M05: "nao conformidade != pendencia". A NC registra o FATO e alimenta a
 * Qualidade (M22); a pendencia e a ACAO a resolver e pertence ao M10. Corrigir
 * o problema nao apaga a NC: adicionar fixador as 14:42 nao faz o material ter
 * chegado fixado.
 */
@Injectable()
export class TriagemService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly fluxo: FluxoService,
    private readonly guardian: GuardianService,
    private readonly sugestoes: SugestoesService,
  ) {}

  async executar(casoId: string, dados: DadosTriagem): Promise<{ resultado: ResultadoTriagem }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [registro] = await tx
        .select()
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1);

      if (!registro) throw new NotFoundException('Caso não encontrado.');

      // M05: a triagem verifica o material FISICO; sem recebimento registrado,
      // nao ha o que conferir.
      if (!registro.recebidoEm) {
        throw new BadRequestException(
          'Não é possível triar um caso cujo material ainda não foi recebido.',
        );
      }
      if (registro.triadoEm) {
        throw new BadRequestException('Este caso já foi triado.');
      }

      // M05: bloqueio de identidade impede a progressao mesmo com o material
      // fisicamente presente.
      const achadosIdentidade = await this.guardian.verificarIdentidadeCaso(tx, casoId);
      await this.sugestoes.registrarAchadosGuardian(tx, achadosIdentidade, casoId, 'triagem');
      this.guardian.garantirSemBloqueio(achadosIdentidade, 'concluir triagem');

      await this.eventos.publicar(tx, {
        tipo: 'triagem.iniciada',
        casoId,
        moduloOrigem: MODULOS.M06_TRIAGEM,
      });

      for (const item of dados.amostras) {
        const [alvo] = await tx
          .select({ id: amostra.id })
          .from(amostra)
          .where(
            and(
              eq(amostra.tenantId, ctx.tenantId),
              eq(amostra.id, item.amostraId),
              eq(amostra.casoId, casoId),
            ),
          )
          .limit(1);

        if (!alvo) throw new NotFoundException(`Amostra ${item.amostraId} não pertence ao caso.`);

        await tx
          .update(amostra)
          .set({
            resultadoTriagem: item.resultado,
            triagemObservacoes: item.observacoes ?? null,
          })
          .where(eq(amostra.id, alvo.id));

        await tx.insert(triagem).values({
          tenantId: ctx.tenantId,
          casoId,
          amostraId: alvo.id,
          resultado: item.resultado,
          checklist: item.checklist ?? {},
          observacoes: item.observacoes ?? null,
          concluidaEm: new Date(),
          executadaPorId: ctx.usuarioId,
          setorId: ctx.setorId,
        });
      }

      for (const nc of dados.naoConformidades ?? []) {
        const [registroNc] = await tx
          .insert(naoConformidadePreAnalitica)
          .values({
            tenantId: ctx.tenantId,
            casoId,
            amostraId: nc.amostraId ?? null,
            tipo: nc.tipo,
            gravidade: nc.gravidade,
            descricao: nc.descricao,
            impactoPotencial: nc.impactoPotencial ?? null,
            registradaPorId: ctx.usuarioId,
          })
          .returning({ id: naoConformidadePreAnalitica.id });

        await this.eventos.publicar(tx, {
          tipo: 'nao_conformidade.registrada',
          casoId,
          moduloOrigem: MODULOS.M06_TRIAGEM,
          objetoTipo: 'nao_conformidade',
          objetoId: registroNc!.id,
          payload: { tipo: nc.tipo, gravidade: nc.gravidade },
        });
      }

      const resultado = this.agregarResultado(dados.amostras.map((a) => a.resultado));

      await tx
        .update(caso)
        .set({
          triadoEm: new Date(),
          triadoPorId: ctx.usuarioId,
          resultadoTriagem: resultado,
        })
        .where(eq(caso.id, casoId));

      await this.publicarResultado(tx, casoId, resultado);

      return { resultado };
    });
  }

  /**
   * M05: o resultado do caso deriva do das amostras.
   *
   * A agregacao adota o pior resultado: uma amostra bloqueada segura o caso. A
   * documentacao preve que isso seja configuravel ("o caso inteiro aguarda ou
   * apenas a amostra bloqueada"); enquanto a configuracao nao existe, o padrao
   * seguro e o conservador.
   */
  private agregarResultado(resultados: ResultadoTriagem[]): ResultadoTriagem {
    if (resultados.includes('bloqueado')) return 'bloqueado';
    if (resultados.includes('recusado')) return 'recusado';
    if (resultados.includes('apto_com_ressalva')) return 'apto_com_ressalva';
    return 'apto';
  }

  private async publicarResultado(
    tx: Transacao,
    casoId: string,
    resultado: ResultadoTriagem,
  ): Promise<void> {
    const ctx = exigirContexto();

    if (resultado === 'apto' || resultado === 'apto_com_ressalva') {
      const tipo =
        resultado === 'apto' ? 'triagem.concluida.apta' : 'triagem.concluida.ressalva';

      await this.eventos.publicar(tx, {
        tipo,
        casoId,
        moduloOrigem: MODULOS.M06_TRIAGEM,
        visibilidade: 'externo',
        payload: { resultado },
      });

      await this.fluxo.processarEvento(tx, casoId, tipo);
      return;
    }

    // Bloqueado ou recusado: o fluxo NAO avanca.
    await this.eventos.publicar(tx, {
      tipo: resultado === 'bloqueado' ? 'triagem.bloqueada' : 'material.recusado',
      casoId,
      moduloOrigem: MODULOS.M06_TRIAGEM,
      payload: { resultado },
    });

    /**
     * M10 e dono da pendencia; o M06 apenas a cria e informa o impacto. O M07
     * decide o que isso faz com o estado global.
     */
    const [novaPendencia] = await tx
      .insert(pendencia)
      .values({
        tenantId: ctx.tenantId,
        casoId,
        tipo: 'triagem_bloqueada',
        descricao:
          resultado === 'bloqueado'
            ? 'Triagem bloqueada: material não apto para prosseguir.'
            : 'Material recusado na triagem.',
        nivelBloqueio: 'total',
        suspendePrazo: true,
        criadaPorId: ctx.usuarioId,
        setorResponsavel: 'triagem',
        visivelPortal: true,
      })
      .returning({ id: pendencia.id });

    await this.eventos.publicar(tx, {
      tipo: 'pendencia.criada',
      casoId,
      moduloOrigem: MODULOS.M10_SOLICITACOES,
      objetoTipo: 'pendencia',
      objetoId: novaPendencia!.id,
      visibilidade: 'externo',
      payload: { motivo: resultado },
    });

    await this.fluxo.bloquear(tx, casoId, {
      nivel: 'total',
      origem: MODULOS.M06_TRIAGEM,
      origemId: novaPendencia!.id,
      motivo: `Triagem com resultado "${resultado}".`,
      condicaoLiberacao: 'Resolver a pendência de triagem.',
    });
  }
}
