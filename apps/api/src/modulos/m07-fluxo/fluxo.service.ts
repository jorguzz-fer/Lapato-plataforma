import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  bloqueio,
  caso,
  definicaoWorkflow,
  diaNaoUtil,
  estadoCaso,
  etapaWorkflow,
  servico,
  suspensaoPrazo,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  alertaDePrazo,
  aplicarSuspensoes,
  somarDiasUteis,
  type CalendarioInstitucional,
  type Etapa,
  type TipoEvento,
} from '@lapato/shared';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M07 - Rastreamento e Gestao de Fluxo: o motor.
 *
 * DIRETRIZES secao 12: "o estado global devera ser administrado pelo Modulo 07".
 * Nenhum outro modulo escreve `estado_caso`. Os modulos publicam eventos e
 * chamam `processarEvento`, que decide a transicao.
 *
 * M07: "transicoes derivam de eventos, nao de edicao manual". Alterar status a
 * mao e excecao, exige permissao e justificativa - por isso `transicaoManual`
 * e um metodo separado e explicito.
 */
@Injectable()
export class FluxoService {
  private readonly logger = new Logger(FluxoService.name);

  constructor(private readonly eventos: EventosService) {}

  /**
   * Inicializa o estado do caso escolhendo o workflow do servico.
   *
   * As etapas nao aplicaveis sao filtradas aqui, uma unica vez, avaliando as
   * flags do servico. E o que permite ao mesmo motor atender histopatologia,
   * citologia e revisao de laminas sem `if` espalhado pelo codigo (M07).
   */
  async iniciarFluxo(tx: Transacao, casoId: string): Promise<void> {
    const ctx = exigirContexto();

    const [registro] = await tx
      .select({
        casoId: caso.id,
        servicoId: caso.servicoId,
        modalidade: servico.modalidade,
        prazoDiasUteis: servico.prazoDiasUteis,
        prazoUrgente: servico.prazoUrgenteDiasUteis,
        prioridade: caso.prioridade,
        exigeTriagem: servico.exigeTriagem,
        exigeMacroscopia: servico.exigeMacroscopia,
        exigeProcessamento: servico.exigeProcessamento,
        exigeMicroscopia: servico.exigeMicroscopia,
      })
      .from(caso)
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (!registro) throw new Error(`Caso ${casoId} nao encontrado.`);

    const workflow = await this.carregarWorkflow(tx, registro.servicoId, registro.modalidade);
    const etapas = this.filtrarEtapasAplicaveis(workflow.etapas, registro);
    const primeira = etapas[0];

    const dias =
      registro.prioridade === 'urgente' || registro.prioridade === 'critica'
        ? (registro.prazoUrgente ?? registro.prazoDiasUteis)
        : registro.prazoDiasUteis;

    const calendario = await this.calendario(tx);
    const inicio = new Date();

    await tx.insert(estadoCaso).values({
      tenantId: ctx.tenantId,
      casoId,
      workflowId: workflow.id,
      etapa: (primeira?.etapa as Etapa | undefined) ?? 'aguardando_recebimento',
      setorTipo: primeira?.setorTipo ?? null,
      prazoDiasUteis: dias,
      prazoIniciadoEm: inicio,
      previsaoLiberacao: somarDiasUteis(inicio, dias, calendario),
      alertaPrazo: 'normal',
    });
  }

  /**
   * Interpreta um evento e transiciona o caso, se for o caso.
   *
   * Sem correspondencia com nenhuma etapa, o evento simplesmente nao muda
   * estado - o que e normal: nem todo evento e transicao (uma foto anexada, por
   * exemplo, entra na linha do tempo sem mexer no fluxo).
   */
  async processarEvento(tx: Transacao, casoId: string, tipo: TipoEvento): Promise<void> {
    const ctx = exigirContexto();

    const [estado] = await tx
      .select()
      .from(estadoCaso)
      .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)))
      .limit(1);

    if (!estado?.workflowId) return;

    const [registro] = await tx
      .select({
        exigeTriagem: servico.exigeTriagem,
        exigeMacroscopia: servico.exigeMacroscopia,
        exigeProcessamento: servico.exigeProcessamento,
        exigeMicroscopia: servico.exigeMicroscopia,
      })
      .from(caso)
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (!registro) return;

    const workflow = await this.carregarWorkflowPorId(tx, estado.workflowId);
    const etapas = this.filtrarEtapasAplicaveis(workflow.etapas, registro);

    // A proxima etapa e a primeira, na ordem, que declara este evento como
    // gatilho de entrada.
    const destino = etapas.find((e) => e.eventosEntrada.includes(tipo));
    if (!destino || destino.etapa === estado.etapa) return;

    /**
     * Bloqueio total impede avancar. O desbloqueio vem de outro evento
     * (`pendencia.resolvida`), nunca de alguem forcar o status (M07).
     */
    if (estado.bloqueado) {
      this.logger.debug(
        `Caso ${casoId} bloqueado; evento ${tipo} nao promove transicao para ${destino.etapa}.`,
      );
      return;
    }

    await this.aplicarTransicao(tx, casoId, estado.etapa as Etapa, destino.etapa as Etapa, {
      setorTipo: destino.setorTipo,
      automatica: true,
    });
  }

  /**
   * M07: transicao manual e excecao. Exige permissao (checada no controller) e
   * justificativa registrada - por isso ela e obrigatoria na assinatura.
   */
  async transicaoManual(
    tx: Transacao,
    casoId: string,
    destino: Etapa,
    justificativa: string,
  ): Promise<void> {
    if (!justificativa?.trim()) {
      throw new Error('Transicao manual exige justificativa.');
    }

    const ctx = exigirContexto();
    const [estado] = await tx
      .select()
      .from(estadoCaso)
      .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)))
      .limit(1);

    if (!estado) throw new Error(`Caso ${casoId} sem estado de fluxo.`);

    await this.aplicarTransicao(tx, casoId, estado.etapa as Etapa, destino, {
      setorTipo: null,
      automatica: false,
      justificativa,
    });
  }

  /** Cria bloqueio e, se for total, marca o caso como bloqueado. */
  async bloquear(
    tx: Transacao,
    casoId: string,
    dados: {
      nivel: 'parcial' | 'total';
      origem: string;
      origemId?: string;
      motivo: string;
      etapaBloqueada?: Etapa;
      condicaoLiberacao?: string;
    },
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx.insert(bloqueio).values({
      tenantId: ctx.tenantId,
      casoId,
      nivel: dados.nivel,
      origem: dados.origem,
      origemId: dados.origemId ?? null,
      motivo: dados.motivo,
      etapaBloqueada: dados.etapaBloqueada ?? null,
      condicaoLiberacao: dados.condicaoLiberacao ?? null,
      criadoPorId: ctx.usuarioId,
    });

    if (dados.nivel === 'total') {
      await tx
        .update(estadoCaso)
        .set({ bloqueado: true, atualizadoEm: new Date() })
        .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)));
    }

    await this.eventos.publicar(tx, {
      tipo: 'fluxo.bloqueado',
      casoId,
      moduloOrigem: MODULOS.M07_RASTREAMENTO,
      payload: { nivel: dados.nivel, motivo: dados.motivo, origem: dados.origem },
    });
  }

  /** Libera os bloqueios de uma origem e reavalia o estado do caso. */
  async desbloquear(
    tx: Transacao,
    casoId: string,
    origemId: string,
    motivo: string,
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx
      .update(bloqueio)
      .set({ liberadoEm: new Date(), liberadoPorId: ctx.usuarioId })
      .where(
        and(
          eq(bloqueio.tenantId, ctx.tenantId),
          eq(bloqueio.casoId, casoId),
          eq(bloqueio.origemId, origemId),
          isNull(bloqueio.liberadoEm),
        ),
      );

    const restantes = await tx
      .select({ id: bloqueio.id })
      .from(bloqueio)
      .where(
        and(
          eq(bloqueio.tenantId, ctx.tenantId),
          eq(bloqueio.casoId, casoId),
          eq(bloqueio.nivel, 'total'),
          isNull(bloqueio.liberadoEm),
        ),
      );

    if (restantes.length === 0) {
      await tx
        .update(estadoCaso)
        .set({ bloqueado: false, atualizadoEm: new Date() })
        .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)));
    }

    await this.eventos.publicar(tx, {
      tipo: 'fluxo.desbloqueado',
      casoId,
      moduloOrigem: MODULOS.M07_RASTREAMENTO,
      payload: { motivo, bloqueiosRestantes: restantes.length },
    });
  }

  /**
   * Recalcula a previsao considerando as suspensoes de prazo.
   *
   * M07: a previsao e ESTIMADA e nunca substitui o prazo contratual ou legal -
   * o front rotula os dois de forma diferente.
   */
  async recalcularPrazo(tx: Transacao, casoId: string): Promise<void> {
    const ctx = exigirContexto();

    const [estado] = await tx
      .select()
      .from(estadoCaso)
      .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)))
      .limit(1);

    if (!estado?.prazoIniciadoEm || !estado.prazoDiasUteis) return;

    const calendario = await this.calendario(tx);
    const agora = new Date();

    const suspensoes = await tx
      .select({ inicio: suspensaoPrazo.inicioEm, fim: suspensaoPrazo.fimEm })
      .from(suspensaoPrazo)
      .where(
        and(eq(suspensaoPrazo.tenantId, ctx.tenantId), eq(suspensaoPrazo.casoId, casoId)),
      );

    const base = somarDiasUteis(estado.prazoIniciadoEm, estado.prazoDiasUteis, calendario);
    const previsao = aplicarSuspensoes(base, suspensoes, agora, calendario);

    await tx
      .update(estadoCaso)
      .set({
        previsaoLiberacao: previsao,
        alertaPrazo: alertaDePrazo(previsao, agora, calendario),
        atualizadoEm: agora,
      })
      .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)));

    await this.eventos.publicar(tx, {
      tipo: 'fluxo.prazo_recalculado',
      casoId,
      moduloOrigem: MODULOS.M07_RASTREAMENTO,
      payload: { previsaoLiberacao: previsao.toISOString() },
    });
  }

  /**
   * Abre uma janela de suspensao do prazo (M10 secao 21: uma pendencia pode
   * suspender a contagem enquanto se aguarda um terceiro).
   *
   * A tabela e do M07 - o modulo que pede a suspensao informa origem e motivo,
   * mas quem escreve a janela e recalcula a previsao e este servico, como nos
   * bloqueios. E o que permite depois distinguir "atraso laboratorial" de
   * "aguardando terceiro" nos indicadores (M10 secao 111).
   */
  async suspenderPrazo(
    tx: Transacao,
    casoId: string,
    dados: { motivo: string; origem: string; origemId?: string },
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx.insert(suspensaoPrazo).values({
      tenantId: ctx.tenantId,
      casoId,
      motivo: dados.motivo,
      origem: dados.origem,
      origemId: dados.origemId ?? null,
    });

    await this.recalcularPrazo(tx, casoId);
  }

  /** Fecha as janelas de suspensao de uma origem e recalcula a previsao. */
  async retomarPrazo(tx: Transacao, casoId: string, origemId: string): Promise<void> {
    const ctx = exigirContexto();

    await tx
      .update(suspensaoPrazo)
      .set({ fimEm: new Date(), atualizadoEm: new Date() })
      .where(
        and(
          eq(suspensaoPrazo.tenantId, ctx.tenantId),
          eq(suspensaoPrazo.casoId, casoId),
          eq(suspensaoPrazo.origemId, origemId),
          isNull(suspensaoPrazo.fimEm),
        ),
      );

    await this.recalcularPrazo(tx, casoId);
  }

  // --- internos ------------------------------------------------------------

  private async aplicarTransicao(
    tx: Transacao,
    casoId: string,
    de: Etapa,
    para: Etapa,
    opcoes: { setorTipo: string | null; automatica: boolean; justificativa?: string },
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx
      .update(estadoCaso)
      .set({
        etapa: para,
        setorTipo: opcoes.setorTipo,
        entrouNaEtapaEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)));

    await this.eventos.publicar(tx, {
      tipo: 'fluxo.etapa_alterada',
      casoId,
      moduloOrigem: MODULOS.M07_RASTREAMENTO,
      payload: {
        de,
        para,
        automatica: opcoes.automatica,
        ...(opcoes.justificativa ? { justificativa: opcoes.justificativa } : {}),
      },
    });
  }

  private async carregarWorkflow(
    tx: Transacao,
    servicoId: string,
    modalidade: string,
  ): Promise<{ id: string; etapas: EtapaCarregada[] }> {
    const ctx = exigirContexto();

    // Workflow especifico do servico vence o padrao da modalidade.
    const candidatos = await tx
      .select({ id: definicaoWorkflow.id, servicoId: definicaoWorkflow.servicoId })
      .from(definicaoWorkflow)
      .where(
        and(
          eq(definicaoWorkflow.tenantId, ctx.tenantId),
          eq(definicaoWorkflow.modalidade, modalidade),
          eq(definicaoWorkflow.ativo, true),
        ),
      );

    const escolhido =
      candidatos.find((c) => c.servicoId === servicoId) ??
      candidatos.find((c) => c.servicoId === null);

    if (!escolhido) {
      throw new Error(
        `Nenhum workflow ativo para a modalidade "${modalidade}". ` +
          'Configure em Administração (M01) antes de cadastrar casos deste serviço.',
      );
    }

    return this.carregarWorkflowPorId(tx, escolhido.id);
  }

  private async carregarWorkflowPorId(
    tx: Transacao,
    workflowId: string,
  ): Promise<{ id: string; etapas: EtapaCarregada[] }> {
    const ctx = exigirContexto();

    const etapas = await tx
      .select({
        etapa: etapaWorkflow.etapa,
        ordem: etapaWorkflow.ordem,
        obrigatoriedade: etapaWorkflow.obrigatoriedade,
        condicao: etapaWorkflow.condicao,
        eventosEntrada: etapaWorkflow.eventosEntrada,
        eventosSaida: etapaWorkflow.eventosSaida,
        setorTipo: etapaWorkflow.setorTipo,
      })
      .from(etapaWorkflow)
      .where(
        and(
          eq(etapaWorkflow.tenantId, ctx.tenantId),
          eq(etapaWorkflow.workflowId, workflowId),
        ),
      )
      .orderBy(asc(etapaWorkflow.ordem));

    return { id: workflowId, etapas };
  }

  /**
   * Avalia a condicao de cada etapa contra as flags do servico.
   *
   * A condicao e um objeto simples do tipo `{ "servico.exigeMacroscopia": true }`.
   * Deliberadamente limitado: uma linguagem de expressao completa aqui viraria
   * codigo em banco, difícil de auditar e de testar.
   */
  private filtrarEtapasAplicaveis(
    etapas: EtapaCarregada[],
    flags: Record<string, unknown>,
  ): EtapaCarregada[] {
    return etapas.filter((etapa) => {
      const condicao = etapa.condicao as Record<string, unknown>;
      const chaves = Object.keys(condicao);
      if (chaves.length === 0) return true;

      return chaves.every((chave) => {
        const campo = chave.startsWith('servico.') ? chave.slice('servico.'.length) : chave;
        return flags[campo] === condicao[chave];
      });
    });
  }

  /** M01 secao 14: feriados e recessos da instituicao entram no calculo do prazo. */
  private async calendario(tx: Transacao): Promise<CalendarioInstitucional> {
    const ctx = exigirContexto();

    const dias = await tx
      .select({ data: diaNaoUtil.data })
      .from(diaNaoUtil)
      .where(eq(diaNaoUtil.tenantId, ctx.tenantId));

    return {
      naoUteis: new Set(dias.map((d) => d.data)),
      diasUteisDaSemana: new Set([1, 2, 3, 4, 5]),
    };
  }
}

interface EtapaCarregada {
  etapa: string;
  ordem: number;
  obrigatoriedade: string;
  condicao: Record<string, unknown>;
  eventosEntrada: string[];
  eventosSaida: string[];
  setorTipo: string | null;
}
