import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  bloco,
  caso,
  cassete,
  divergenciaCassete,
  lamina,
  loteCassete,
  loteEnvio,
  paciente,
  unidade,
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

  /**
   * Cassetes prontos para envio, de todos os casos.
   *
   * A bancada tecnica trabalha por LOTE DO DIA, e nao caso a caso: o M09
   * identifica o lote pela data de envio e ele atravessa varios casos. Uma
   * listagem por caso obrigaria a abrir um caso de cada vez para montar o que e
   * uma unica remessa fisica.
   */
  async cassetesPendentes() {
    const ctx = exigirContexto();

    /**
     * Material ainda nao enviado nao e assunto do parceiro.
     *
     * A lista traz nome de paciente e caso de toda a instituicao; devolve-la a
     * um laboratorio de apoio seria entregar a agenda inteira do laboratorio a
     * um fornecedor. Ele ve os proprios lotes, e nada antes disso.
     */
    if (ctx.laboratorioApoioId) return [];

    return this.db.executar(async (tx) =>
      tx
        .select({
          id: cassete.id,
          identificador: cassete.identificador,
          tecidoOrigem: cassete.tecidoOrigem,
          exigeDescalcificacao: cassete.exigeDescalcificacao,
          casoId: cassete.casoId,
          caso: caso.identificador,
          paciente: paciente.nome,
        })
        .from(cassete)
        .innerJoin(caso, eq(caso.id, cassete.casoId))
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .where(
          and(
            eq(cassete.tenantId, ctx.tenantId),
            eq(cassete.statusTecnico, 'aguardando_processamento'),
          ),
        )
        .orderBy(asc(caso.identificador), asc(cassete.ordem)),
    );
  }

  /** Lotes enviados, do mais recente para o mais antigo. */
  async listarLotes() {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      /**
       * M02, verificacao do bootstrap: "usuario externo do laboratorio de apoio
       * so ve seus lotes de cassetes". O filtro entra na consulta, e nao numa
       * checagem posterior - assim nao ha caminho em que a linha chegue a ser
       * lida para depois ser descartada.
       */
      const lotes = await tx
        .select()
        .from(loteEnvio)
        .where(
          ctx.laboratorioApoioId
            ? and(
                eq(loteEnvio.tenantId, ctx.tenantId),
                eq(loteEnvio.laboratorioApoioId, ctx.laboratorioApoioId),
              )
            : eq(loteEnvio.tenantId, ctx.tenantId),
        )
        .orderBy(desc(loteEnvio.dataEnvio), desc(loteEnvio.criadoEm));

      return Promise.all(
        lotes.map(async (l) => {
          const [{ total } = { total: 0 }] = await tx
            .select({ total: count() })
            .from(loteCassete)
            .where(eq(loteCassete.loteId, l.id));

          const [{ divergencias } = { divergencias: 0 }] = await tx
            .select({ divergencias: count() })
            .from(divergenciaCassete)
            .where(eq(divergenciaCassete.loteId, l.id));

          return {
            id: l.id,
            identificador: l.identificador,
            dataEnvio: l.dataEnvio,
            status: l.status,
            enviadoEm: l.enviadoEm,
            recebidoParceiroEm: l.recebidoParceiroEm,
            totalCassetes: total,
            divergencias,
          };
        }),
      );
    });
  }

  /** Detalhe do lote: cassetes, conferencia, divergencias e laminas. */
  async detalharLote(loteId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [lote] = await tx
        .select()
        .from(loteEnvio)
        .where(and(eq(loteEnvio.tenantId, ctx.tenantId), eq(loteEnvio.id, loteId)))
        .limit(1);

      /**
       * Lote de outro parceiro responde "nao encontrado", e nao "proibido":
       * distinguir os dois confirmaria a existencia do lote a quem nao deveria
       * nem saber que ele existe.
       */
      if (!lote) throw new NotFoundException('Lote não encontrado.');
      if (ctx.laboratorioApoioId && lote.laboratorioApoioId !== ctx.laboratorioApoioId) {
        throw new NotFoundException('Lote não encontrado.');
      }

      const cassetes = await tx
        .select({
          id: cassete.id,
          identificador: cassete.identificador,
          tecidoOrigem: cassete.tecidoOrigem,
          exigeDescalcificacao: cassete.exigeDescalcificacao,
          statusTecnico: cassete.statusTecnico,
          confirmadoRecebimento: loteCassete.confirmadoRecebimento,
          caso: caso.identificador,
        })
        .from(loteCassete)
        .innerJoin(cassete, eq(cassete.id, loteCassete.casseteId))
        .innerJoin(caso, eq(caso.id, cassete.casoId))
        .where(and(eq(loteCassete.tenantId, ctx.tenantId), eq(loteCassete.loteId, loteId)))
        .orderBy(asc(caso.identificador), asc(cassete.ordem));

      const divergencias = await tx
        .select({
          id: divergenciaCassete.id,
          tipo: divergenciaCassete.tipo,
          casseteId: divergenciaCassete.casseteId,
          codigoInformado: divergenciaCassete.codigoInformado,
          descricao: divergenciaCassete.descricao,
          resolvidaEm: divergenciaCassete.resolvidaEm,
        })
        .from(divergenciaCassete)
        .where(
          and(
            eq(divergenciaCassete.tenantId, ctx.tenantId),
            eq(divergenciaCassete.loteId, loteId),
          ),
        );

      /**
       * As laminas do lote sao alcancadas pela genealogia, e nao por um vinculo
       * direto: Cassete -> Bloco -> Lamina. E o mesmo caminho que o M09 exige
       * que seja rastreavel ate o fragmento macroscopico.
       */
      const idsCassetes = cassetes.map((c) => c.id);
      const laminas = idsCassetes.length
        ? await tx
            .select({
              id: lamina.id,
              identificador: lamina.identificador,
              coloracaoSigla: lamina.coloracaoSigla,
              nivel: lamina.nivel,
              casseteId: bloco.casseteId,
            })
            .from(lamina)
            .innerJoin(bloco, eq(bloco.id, lamina.blocoId))
            .where(
              and(eq(lamina.tenantId, ctx.tenantId), inArray(bloco.casseteId, idsCassetes)),
            )
            .orderBy(asc(lamina.identificador))
        : [];

      return {
        id: lote.id,
        identificador: lote.identificador,
        dataEnvio: lote.dataEnvio,
        status: lote.status,
        enviadoEm: lote.enviadoEm,
        recebidoParceiroEm: lote.recebidoParceiroEm,
        cassetes,
        divergencias,
        laminas,
      };
    });
  }

  /** Monta o lote do dia com os cassetes prontos e envia ao parceiro. */
  async enviarLote(
    casseteIds: string[],
    laboratorioApoioId: string,
  ): Promise<{ id: string; identificador: string; total: number }> {
    const ctx = exigirContexto();

    if (casseteIds.length === 0) {
      throw new BadRequestException('Informe ao menos um cassete.');
    }

    return this.db.executar(async (tx) => {
      /**
       * O destino deixou de ser opcional quando o parceiro passou a enxergar os
       * proprios lotes: um lote sem laboratorio e invisivel para todo mundo do
       * outro lado - carta sem endereco. Tem de ser uma unidade do tipo
       * `laboratorio_apoio`, senao o isolamento nao teria a que se ancorar.
       */
      const [destino] = await tx
        .select({ id: unidade.id, tipo: unidade.tipo })
        .from(unidade)
        .where(and(eq(unidade.tenantId, ctx.tenantId), eq(unidade.id, laboratorioApoioId)))
        .limit(1);

      if (!destino || destino.tipo !== 'laboratorio_apoio') {
        throw new BadRequestException(
          'O destino do lote precisa ser uma unidade do tipo laboratório de apoio.',
        );
      }

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
          laboratorioApoioId,
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
      if (ctx.laboratorioApoioId && lote.laboratorioApoioId !== ctx.laboratorioApoioId) {
        throw new NotFoundException('Lote não encontrado.');
      }
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
      const [lote] = await tx
        .select()
        .from(loteEnvio)
        .where(and(eq(loteEnvio.tenantId, ctx.tenantId), eq(loteEnvio.id, loteId)))
        .limit(1);

      if (!lote) throw new NotFoundException('Lote não encontrado.');
      if (ctx.laboratorioApoioId && lote.laboratorioApoioId !== ctx.laboratorioApoioId) {
        throw new NotFoundException('Lote não encontrado.');
      }

      /**
       * A lamina so pode nascer de um cassete DESTE lote.
       *
       * Sem esta checagem, o `loteId` da rota seria decorativo: qualquer
       * `casseteId` valido do tenant seria aceito, e um parceiro poderia
       * registrar producao contra material que nunca recebeu.
       */
      const doLote = new Set(
        (
          await tx
            .select({ casseteId: loteCassete.casseteId })
            .from(loteCassete)
            .where(and(eq(loteCassete.tenantId, ctx.tenantId), eq(loteCassete.loteId, loteId)))
        ).map((l) => l.casseteId),
      );

      for (const item of laminas) {
        if (!doLote.has(item.casseteId)) {
          throw new BadRequestException(
            `Cassete ${item.casseteId} não pertence a este lote.`,
          );
        }
      }

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
