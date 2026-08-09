import { Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import {
  caso,
  cliente,
  estadoCaso,
  paciente,
  servico,
  type Transacao,
} from '@lapato/db';
import { alertaDePrazo, type Etapa } from '@lapato/shared';
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

  async listar(filtros: { etapa?: Etapa; apenasMinhaFila?: boolean }) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const condicoes: SQL[] = [eq(estadoCaso.tenantId, ctx.tenantId)];

      if (filtros.etapa) condicoes.push(eq(estadoCaso.etapa, filtros.etapa));
      if (filtros.apenasMinhaFila) {
        condicoes.push(eq(estadoCaso.responsavelId, ctx.usuarioId));
      }

      const linhas = await tx
        .select({
          casoId: caso.id,
          identificador: caso.identificador,
          paciente: paciente.nome,
          cliente: cliente.nomeFantasia,
          servico: servico.nome,
          prioridade: caso.prioridade,
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
        .innerJoin(cliente, eq(cliente.id, caso.clienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .where(and(...condicoes))
        .orderBy(asc(estadoCaso.previsaoLiberacao));

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
