import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  bloco,
  cassete,
  divergenciaCassete,
  lamina,
  loteCassete,
  loteEnvio,
  type Transacao,
} from '@lapato/db';
import { MODULOS, identificadorLamina } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M09 - Processamento Histologico e Coloracoes.
 *
 * Nota do dono do produto no topo do documento: **"Nos nao fazemos
 * processamento. Esse e um servico terceirizado."**
 *
 * Consequencia: este modulo gerencia o ENVIO e o RETORNO ao laboratorio de
 * apoio, e o parceiro opera dentro do sistema - confirma o recebimento clicando
 * na listagem do dia, aponta incongruencias (falta de cassetes, cassetes a mais,
 * numeracoes erradas) e registra as laminas produzidas.
 *
 * Principio preservado em todo o modulo: "cada lamina deve possuir origem
 * totalmente rastreavel ate o fragmento macroscopico que lhe deu origem".
 */
@Injectable()
export class ProcessamentoService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly numeracao: NumeracaoService,
    private readonly fluxo: FluxoService,
  ) {}

  /** Monta o lote do dia com os cassetes prontos e envia ao parceiro. */
  async enviarLote(
    casseteIds: string[],
    laboratorioApoioId?: string,
  ): Promise<{ id: string; identificador: string; total: number }> {
    const ctx = exigirContexto();

    if (casseteIds.length === 0) {
      throw new BadRequestException('Informe ao menos um cassete.');
    }

    return this.db.executar(async (tx) => {
      const cassetes = await tx
        .select()
        .from(cassete)
        .where(and(eq(cassete.tenantId, ctx.tenantId), inArray(cassete.id, casseteIds)));

      if (cassetes.length !== casseteIds.length) {
        throw new NotFoundException('Um ou mais cassetes não foram encontrados.');
      }

      const jaEnviados = cassetes.filter(
        (c) => c.statusTecnico !== 'aguardando_processamento',
      );
      if (jaEnviados.length > 0) {
        throw new BadRequestException(
          `Cassetes já em processamento: ${jaEnviados.map((c) => c.identificador).join(', ')}.`,
        );
      }

      const hoje = new Date();
      const identificador = await this.numeracao.proximoLote(tx, hoje.getFullYear());

      const [lote] = await tx
        .insert(loteEnvio)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          // M09: o lote e identificado pela DATA de envio.
          dataEnvio: hoje.toISOString().slice(0, 10),
          laboratorioApoioId: laboratorioApoioId ?? null,
          enviadoEm: hoje,
          enviadoPorId: ctx.usuarioId,
          status: 'enviado',
        })
        .returning({ id: loteEnvio.id });

      await tx.insert(loteCassete).values(
        cassetes.map((c) => ({
          tenantId: ctx.tenantId,
          loteId: lote!.id,
          casseteId: c.id,
        })),
      );

      await tx
        .update(cassete)
        .set({ statusTecnico: 'em_processamento' })
        .where(inArray(cassete.id, casseteIds));

      // Um lote pode cruzar varios casos; cada caso recebe seu evento, para a
      // linha do tempo de cada um ficar completa.
      for (const casoId of new Set(cassetes.map((c) => c.casoId))) {
        await this.eventos.publicar(tx, {
          tipo: 'lote.enviado',
          casoId,
          moduloOrigem: MODULOS.M09_PROCESSAMENTO,
          objetoTipo: 'lote',
          objetoId: lote!.id,
          payload: {
            lote: identificador,
            cassetes: cassetes.filter((c) => c.casoId === casoId).map((c) => c.identificador),
          },
        });
      }

      return { id: lote!.id, identificador, total: cassetes.length };
    });
  }

  /**
   * Conferencia feita pelo laboratorio de apoio.
   *
   * As tres categorias de divergencia vem literalmente da nota do M09:
   * falta de cassetes, cassetes a mais nao listados, numeracoes erradas.
   */
  async confirmarRecebimento(
    loteId: string,
    conferencia: {
      confirmados?: string[];
      divergencias?: Array<{
        tipo: 'cassete_faltante' | 'cassete_excedente' | 'numeracao_errada';
        casseteId?: string;
        codigoInformado?: string;
        descricao: string;
      }>;
    },
  ): Promise<{ divergencias: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [lote] = await tx
        .select()
        .from(loteEnvio)
        .where(and(eq(loteEnvio.tenantId, ctx.tenantId), eq(loteEnvio.id, loteId)))
        .limit(1);

      if (!lote) throw new NotFoundException('Lote não encontrado.');
      if (lote.recebidoParceiroEm) {
        throw new BadRequestException('Recebimento deste lote já foi confirmado.');
      }

      const confirmados = conferencia.confirmados ?? [];
      if (confirmados.length > 0) {
        await tx
          .update(loteCassete)
          .set({ confirmadoRecebimento: true })
          .where(
            and(
              eq(loteCassete.tenantId, ctx.tenantId),
              eq(loteCassete.loteId, loteId),
              inArray(loteCassete.casseteId, confirmados),
            ),
          );
      }

      const divergencias = conferencia.divergencias ?? [];
      for (const d of divergencias) {
        await tx.insert(divergenciaCassete).values({
          tenantId: ctx.tenantId,
          loteId,
          casseteId: d.casseteId ?? null,
          tipo: d.tipo,
          codigoInformado: d.codigoInformado ?? null,
          descricao: d.descricao,
          apontadaPorId: ctx.usuarioId,
        });
      }

      await tx
        .update(loteEnvio)
        .set({
          recebidoParceiroEm: new Date(),
          recebidoParceiroPorId: ctx.usuarioId,
          status: divergencias.length > 0 ? 'com_divergencia' : 'recebido',
        })
        .where(eq(loteEnvio.id, loteId));

      const casos = await this.casosDoLote(tx, loteId);
      for (const casoId of casos) {
        await this.eventos.publicar(tx, {
          tipo:
            divergencias.length > 0 ? 'divergencia.cassetes' : 'cassetes.recebidos_parceiro',
          casoId,
          moduloOrigem: MODULOS.M09_PROCESSAMENTO,
          objetoTipo: 'lote',
          objetoId: loteId,
          payload: { lote: lote.identificador, divergencias: divergencias.length },
        });
      }

      return { divergencias: divergencias.length };
    });
  }

  /**
   * Registro das laminas produzidas, com a genealogia preservada:
   *   Cassete -> Bloco -> Lamina
   *
   * M09: "lamina disponivel para microscopia" != "laudo liberado" - sao eventos
   * distintos, e este metodo emite apenas o primeiro.
   */
  async registrarLaminas(
    loteId: string,
    laminas: Array<{ casseteId: string; coloracao: string; nivel?: number }>,
  ): Promise<{ total: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const casosAfetados = new Set<string>();

      for (const item of laminas) {
        const [origem] = await tx
          .select()
          .from(cassete)
          .where(and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.id, item.casseteId)))
          .limit(1);

        if (!origem) throw new NotFoundException(`Cassete ${item.casseteId} não encontrado.`);

        // M09: 1 cassete -> 1 bloco. O bloco e criado na primeira lamina.
        let [blocoExistente] = await tx
          .select()
          .from(bloco)
          .where(and(eq(bloco.tenantId, ctx.tenantId), eq(bloco.casseteId, origem.id)))
          .limit(1);

        if (!blocoExistente) {
          [blocoExistente] = await tx
            .insert(bloco)
            .values({
              tenantId: ctx.tenantId,
              casoId: origem.casoId,
              casseteId: origem.id,
              // Bloco herda o identificador do cassete, como manda a cadeia.
              identificador: origem.identificador,
              produzidoEm: new Date(),
            })
            .returning();
        }

        await tx.insert(lamina).values({
          tenantId: ctx.tenantId,
          casoId: origem.casoId,
          blocoId: blocoExistente!.id,
          identificador: identificadorLamina(
            origem.identificador,
            item.coloracao,
            item.nivel,
          ),
          coloracaoSigla: item.coloracao.toUpperCase(),
          nivel: item.nivel ?? 1,
          disponivelEm: new Date(),
          produzidaPorId: ctx.usuarioId,
        });

        await tx
          .update(cassete)
          .set({ statusTecnico: 'lamina_disponivel' })
          .where(eq(cassete.id, origem.id));

        casosAfetados.add(origem.casoId);
      }

      await tx
        .update(loteEnvio)
        .set({ status: 'concluido' })
        .where(and(eq(loteEnvio.tenantId, ctx.tenantId), eq(loteEnvio.id, loteId)));

      for (const casoId of casosAfetados) {
        await this.eventos.publicar(tx, {
          tipo: 'laminas.disponiveis',
          casoId,
          moduloOrigem: MODULOS.M09_PROCESSAMENTO,
          payload: { lote: loteId },
        });
        await this.fluxo.processarEvento(tx, casoId, 'laminas.disponiveis');
      }

      return { total: laminas.length };
    });
  }

  private async casosDoLote(tx: Transacao, loteId: string): Promise<string[]> {
    const ctx = exigirContexto();
    const linhas = await tx
      .select({ casoId: cassete.casoId })
      .from(loteCassete)
      .innerJoin(cassete, eq(cassete.id, loteCassete.casseteId))
      .where(and(eq(loteCassete.tenantId, ctx.tenantId), eq(loteCassete.loteId, loteId)));

    return [...new Set(linhas.map((l) => l.casoId))];
  }
}
