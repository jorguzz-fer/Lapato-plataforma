import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import {
  caso,
  cliente,
  estadoCaso,
  paciente,
  servico,
  type Transacao,
  tutor,
} from '@lapato/db';
import { alertaDePrazo, type Etapa, ETAPA } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { FluxoService } from './fluxo.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M07 - consultas da Central de Casos.
 *
 * Separado do `FluxoService` de proposito: aquele e o motor que ESCREVE estado;
 * este apenas LE. Manter os dois no mesmo arquivo convidaria a consultas
 * mutarem estado por conveniencia.
 */
@Injectable()
export class FluxoConsultaService {
  constructor(
    private readonly db: DbService,
    private readonly fluxo: FluxoService,
  ) {}

  async listar(filtros: {
    etapa?: Etapa | Etapa[];
    apenasMinhaFila?: boolean;
    q?: string;
    /** `entrada`: fila da bancada, do mais antigo ao mais recente. Padrao: prazo. */
    ordem?: 'previsao' | 'entrada';
  }) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const condicoes: SQL[] = [eq(estadoCaso.tenantId, ctx.tenantId)];

      // Uma etapa ou varias (a fila da macro soma "aguardando" e "em").
      const etapas = (Array.isArray(filtros.etapa) ? filtros.etapa : filtros.etapa ? [filtros.etapa] : [])
        .filter((e): e is Etapa => (ETAPA as readonly string[]).includes(e));
      if (etapas.length === 1) condicoes.push(eq(estadoCaso.etapa, etapas[0]!));
      else if (etapas.length > 1) condicoes.push(inArray(estadoCaso.etapa, etapas));
      if (filtros.apenasMinhaFila) {
        condicoes.push(eq(estadoCaso.responsavelId, ctx.usuarioId));
      }
      // Documento do Hugo: na fila da macro, buscar por paciente, responsavel
      // ou cliente - e o registro, porque a etiqueta tambem se digita.
      const q = filtros.q?.trim();
      if (q && q.length >= 2) {
        const padrao = `%${q}%`;
        condicoes.push(
          or(
            ilike(paciente.nome, padrao),
            ilike(tutor.nome, padrao),
            ilike(cliente.nomeFantasia, padrao),
            ilike(caso.identificador, padrao),
          )!,
        );
      }

      const linhas = await tx
        .select({
          casoId: caso.id,
          identificador: caso.identificador,
          paciente: paciente.nome,
          responsavel: tutor.nome,
          cliente: cliente.nomeFantasia,
          modalidade: caso.modalidade,
          servico: servico.nome,
          prioridade: caso.prioridade,
          entradaEm: caso.entradaEm,
          etapa: estadoCaso.etapa,
          entrouNaEtapaEm: estadoCaso.entrouNaEtapaEm,
          previsaoLiberacao: estadoCaso.previsaoLiberacao,
          alertaPrazo: estadoCaso.alertaPrazo,
          bloqueado: estadoCaso.bloqueado,
          responsavelId: estadoCaso.responsavelId,
        })
        .from(estadoCaso)
        .innerJoin(caso, eq(caso.id, estadoCaso.casoId))
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .leftJoin(tutor, eq(tutor.id, paciente.tutorId))
        .innerJoin(cliente, eq(cliente.id, caso.clienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .where(and(...condicoes))
        // Review: a central e as solicitacoes seguem por prazo (o urgente
        // primeiro); so a fila da macro pede entrada (documento do Hugo).
        .orderBy(
          ...(filtros.ordem === 'entrada'
            ? [asc(caso.entradaEm), asc(estadoCaso.previsaoLiberacao)]
            : [asc(estadoCaso.previsaoLiberacao), asc(caso.entradaEm)]),
        );

      const agora = new Date();

      return linhas.map((l) => ({
        ...l,
        /**
         * O alerta e recalculado na leitura, e nao apenas o valor persistido:
         * um caso que virou o prazo desde a ultima escrita precisa aparecer
         * como atrasado sem depender de um job ter rodado.
         */
        alertaPrazo: l.previsaoLiberacao
          ? alertaDePrazo(l.previsaoLiberacao, agora)
          : l.alertaPrazo,
      }));
    });
  }

  /** Repassa ao motor; a permissao e a justificativa sao exigidas no controller. */
  async transicaoManual(
    tx: Transacao,
    casoId: string,
    etapa: Etapa,
    justificativa: string,
  ): Promise<void> {
    await this.fluxo.transicaoManual(tx, casoId, etapa, justificativa);
  }
}
