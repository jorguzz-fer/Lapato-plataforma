import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  cliente,
  fatura,
  itemOrdemServico,
  lancamentoFinanceiro,
  ordemServico,
  type Transacao,
} from '@lapato/db';
import { MODULOS, totalDaOrdem, type StatusFatura, type TipoLancamento } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M20 (parcial) - Financeiro padrao.
 *
 * O escopo combinado na review: fatura sobre as OSs despachadas, livro de
 * entrada e saida, e a visao de fluxo de caixa. O que for especifico do setor
 * entra quando a documentacao do modulo chegar (a Roberta ainda vai listar).
 *
 * Regra de ouro herdada da OS: valor agregado nunca e gravado. O total da
 * fatura e a soma dos itens das ordens; o saldo do mes e a soma dos
 * lancamentos. Numeros armazenados divergem das partes - calculados, nao.
 */
@Injectable()
export class FinanceiroService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
  ) {}

  // --- Faturas -----------------------------------------------------------

  /**
   * Cria a fatura agrupando OSs DESPACHADAS do cliente.
   *
   * So despachada entra: aberta ainda muda de valor, conferida ainda nao
   * passou pela saida. E o "a partir desse momento ja pode ir pra fatura" da
   * review - o despacho e o portao.
   */
  async criarFatura(clienteId: string, ordemIds: string[]) {
    if (ordemIds.length === 0) {
      throw new BadRequestException('Escolha ao menos uma Ordem de Serviço despachada.');
    }

    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const ordens = await tx
        .select({
          id: ordemServico.id,
          status: ordemServico.status,
          clienteId: ordemServico.clienteId,
        })
        .from(ordemServico)
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), inArray(ordemServico.id, ordemIds)));

      if (ordens.length !== ordemIds.length) {
        throw new NotFoundException('Alguma das ordens não foi encontrada.');
      }
      for (const ordem of ordens) {
        if (ordem.status !== 'despachada') {
          throw new BadRequestException(
            'Só Ordem de Serviço despachada pode ser faturada — as demais ainda mudam de valor.',
          );
        }
        if (ordem.clienteId !== clienteId) {
          throw new BadRequestException('Todas as ordens da fatura devem ser do mesmo cliente.');
        }
      }

      const agora = new Date();
      const identificador = await this.numeracao.proximaFatura(tx, agora.getFullYear());

      const [nova] = await tx
        .insert(fatura)
        .values({ tenantId: ctx.tenantId, identificador, clienteId })
        .returning({ id: fatura.id });

      await tx
        .update(ordemServico)
        .set({ status: 'faturada', faturaId: nova!.id, atualizadoEm: agora })
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), inArray(ordemServico.id, ordemIds)));

      await this.eventos.publicar(tx, {
        tipo: 'fatura.criada',
        moduloOrigem: MODULOS.M20_FINANCEIRO,
        objetoTipo: 'fatura',
        objetoId: nova!.id,
        payload: { identificador, ordens: ordemIds.length },
      });

      return { id: nova!.id, identificador };
    });
  }

  async listarFaturas(status?: StatusFatura) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      return tx
        .select({
          id: fatura.id,
          identificador: fatura.identificador,
          status: fatura.status,
          vencimento: fatura.vencimento,
          criadoEm: fatura.criadoEm,
          pagaEm: fatura.pagaEm,
          valorPago: fatura.valorPago,
          clienteNome: cliente.nomeFantasia,
          total: this.sqlTotalDaFatura(),
        })
        .from(fatura)
        .innerJoin(cliente, eq(cliente.id, fatura.clienteId))
        .where(
          and(eq(fatura.tenantId, ctx.tenantId), ...(status ? [eq(fatura.status, status)] : [])),
        )
        .orderBy(desc(fatura.criadoEm))
        .limit(200);
    });
  }

  async buscarFatura(faturaId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [alvo] = await tx
        .select({
          id: fatura.id,
          identificador: fatura.identificador,
          status: fatura.status,
          vencimento: fatura.vencimento,
          criadoEm: fatura.criadoEm,
          emitidaEm: fatura.emitidaEm,
          pagaEm: fatura.pagaEm,
          valorPago: fatura.valorPago,
          motivoCancelamento: fatura.motivoCancelamento,
          observacoes: fatura.observacoes,
          clienteNome: cliente.nomeFantasia,
        })
        .from(fatura)
        .innerJoin(cliente, eq(cliente.id, fatura.clienteId))
        .where(and(eq(fatura.tenantId, ctx.tenantId), eq(fatura.id, faturaId)))
        .limit(1);
      if (!alvo) throw new NotFoundException('Fatura não encontrada.');

      const ordens = await tx
        .select({
          id: ordemServico.id,
          identificador: ordemServico.identificador,
          casoId: ordemServico.casoId,
        })
        .from(ordemServico)
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.faturaId, faturaId)));

      const totais = await Promise.all(
        ordens.map(async (ordem) => {
          const itens = await tx
            .select({
              quantidade: itemOrdemServico.quantidade,
              valorUnitario: itemOrdemServico.valorUnitario,
              descontoPercentual: itemOrdemServico.descontoPercentual,
            })
            .from(itemOrdemServico)
            .where(
              and(
                eq(itemOrdemServico.tenantId, ctx.tenantId),
                eq(itemOrdemServico.ordemId, ordem.id),
              ),
            );
          return { ...ordem, total: totalDaOrdem(itens) };
        }),
      );

      const total = Math.round(totais.reduce((acc, o) => acc + o.total, 0) * 100) / 100;
      return { ...alvo, ordens: totais, total };
    });
  }

  async emitirFatura(faturaId: string, vencimento: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const alvo = await this.exigirFatura(tx, faturaId, ['aberta']);

      await tx
        .update(fatura)
        .set({
          status: 'emitida',
          vencimento,
          emitidaEm: new Date(),
          emitidaPorId: ctx.usuarioId,
          atualizadoEm: new Date(),
        })
        .where(and(eq(fatura.tenantId, ctx.tenantId), eq(fatura.id, faturaId)));

      await this.eventos.publicar(tx, {
        tipo: 'fatura.emitida',
        moduloOrigem: MODULOS.M20_FINANCEIRO,
        objetoTipo: 'fatura',
        objetoId: faturaId,
        payload: { identificador: alvo.identificador, vencimento },
      });

      return { ok: true };
    });
  }

  /**
   * Registra o pagamento e ESPELHA no livro: o lancamento de entrada nasce
   * automatico, vinculado a fatura, e travado - quem quiser mexer, mexe na
   * fatura. E o que mantem o fluxo de caixa e o contas a receber contando a
   * mesma historia.
   */
  async registrarPagamento(faturaId: string, dados: { valor?: number; data?: string }) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const alvo = await this.exigirFatura(tx, faturaId, ['emitida']);

      const total = await this.totalDaFatura(tx, faturaId);
      const valor = dados.valor ?? total;
      const dia = dados.data ?? new Date().toISOString().slice(0, 10);

      await tx
        .update(fatura)
        .set({
          status: 'paga',
          pagaEm: new Date(),
          valorPago: valor.toFixed(2),
          atualizadoEm: new Date(),
        })
        .where(and(eq(fatura.tenantId, ctx.tenantId), eq(fatura.id, faturaId)));

      await tx.insert(lancamentoFinanceiro).values({
        tenantId: ctx.tenantId,
        tipo: 'entrada',
        categoria: 'Recebimento de fatura',
        descricao: `Fatura ${alvo.identificador}`,
        valor: valor.toFixed(2),
        data: dia,
        faturaId,
        criadoPorId: ctx.usuarioId,
      });

      await this.eventos.publicar(tx, {
        tipo: 'fatura.paga',
        moduloOrigem: MODULOS.M20_FINANCEIRO,
        objetoTipo: 'fatura',
        objetoId: faturaId,
        payload: { identificador: alvo.identificador, valor: valor.toFixed(2) },
      });

      return { ok: true, valor: valor.toFixed(2) };
    });
  }

  /** Cancelar a fatura devolve as ordens a `despachada` - elas podem ser refaturadas. */
  async cancelarFatura(faturaId: string, motivo: string) {
    if (!motivo.trim()) throw new BadRequestException('Cancelamento de fatura exige motivo.');

    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const alvo = await this.exigirFatura(tx, faturaId, ['aberta', 'emitida']);

      const agora = new Date();
      await tx
        .update(fatura)
        .set({
          status: 'cancelada',
          canceladaEm: agora,
          motivoCancelamento: motivo.trim(),
          atualizadoEm: agora,
        })
        .where(and(eq(fatura.tenantId, ctx.tenantId), eq(fatura.id, faturaId)));

      await tx
        .update(ordemServico)
        .set({ status: 'despachada', faturaId: null, atualizadoEm: agora })
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.faturaId, faturaId)));

      await this.eventos.publicar(tx, {
        tipo: 'fatura.cancelada',
        moduloOrigem: MODULOS.M20_FINANCEIRO,
        objetoTipo: 'fatura',
        objetoId: faturaId,
        payload: { identificador: alvo.identificador, motivo: motivo.trim() },
      });

      return { ok: true };
    });
  }

  // --- Lancamentos -------------------------------------------------------

  async listarLancamentos(mes?: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const filtroMes = mes
        ? [sql`to_char(${lancamentoFinanceiro.data}, 'YYYY-MM') = ${mes}`]
        : [];

      return tx
        .select({
          id: lancamentoFinanceiro.id,
          tipo: lancamentoFinanceiro.tipo,
          categoria: lancamentoFinanceiro.categoria,
          descricao: lancamentoFinanceiro.descricao,
          valor: lancamentoFinanceiro.valor,
          data: lancamentoFinanceiro.data,
          faturaId: lancamentoFinanceiro.faturaId,
        })
        .from(lancamentoFinanceiro)
        .where(and(eq(lancamentoFinanceiro.tenantId, ctx.tenantId), ...filtroMes))
        .orderBy(desc(lancamentoFinanceiro.data), desc(lancamentoFinanceiro.criadoEm))
        .limit(500);
    });
  }

  async lancar(dados: {
    tipo: TipoLancamento;
    categoria: string;
    descricao: string;
    valor: number;
    data: string;
  }) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [novo] = await tx
        .insert(lancamentoFinanceiro)
        .values({
          tenantId: ctx.tenantId,
          tipo: dados.tipo,
          categoria: dados.categoria.trim(),
          descricao: dados.descricao.trim(),
          valor: dados.valor.toFixed(2),
          data: dados.data,
          criadoPorId: ctx.usuarioId,
        })
        .returning({ id: lancamentoFinanceiro.id });

      return { id: novo!.id };
    });
  }

  async removerLancamento(id: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [alvo] = await tx
        .select()
        .from(lancamentoFinanceiro)
        .where(and(eq(lancamentoFinanceiro.tenantId, ctx.tenantId), eq(lancamentoFinanceiro.id, id)))
        .limit(1);
      if (!alvo) throw new NotFoundException('Lançamento não encontrado.');
      if (alvo.faturaId) {
        throw new BadRequestException(
          'Lançamento automático de fatura não se remove — cancele ou ajuste a fatura.',
        );
      }

      await tx
        .delete(lancamentoFinanceiro)
        .where(and(eq(lancamentoFinanceiro.tenantId, ctx.tenantId), eq(lancamentoFinanceiro.id, id)));

      await this.auditoria.registrar(tx, {
        entidade: 'lancamento_financeiro',
        entidadeId: id,
        acao: 'remover',
        valorAnterior: {
          tipo: alvo.tipo,
          categoria: alvo.categoria,
          descricao: alvo.descricao,
          valor: alvo.valor,
          data: alvo.data,
        },
      });

      return { ok: true };
    });
  }

  // --- Fluxo de caixa ----------------------------------------------------

  /**
   * A visao de chegada do financeiro: fluxo de caixa dos ultimos meses, o
   * contas a receber (emitidas nao pagas) e o que ja pode ser faturado
   * (despachadas sem fatura).
   */
  async resumo() {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const meses = await tx
        .select({
          mes: sql<string>`to_char(${lancamentoFinanceiro.data}, 'YYYY-MM')`,
          entradas: sql<string>`coalesce(sum(${lancamentoFinanceiro.valor}) filter (where ${lancamentoFinanceiro.tipo} = 'entrada'), 0)::text`,
          saidas: sql<string>`coalesce(sum(${lancamentoFinanceiro.valor}) filter (where ${lancamentoFinanceiro.tipo} = 'saida'), 0)::text`,
        })
        .from(lancamentoFinanceiro)
        .where(
          and(
            eq(lancamentoFinanceiro.tenantId, ctx.tenantId),
            sql`${lancamentoFinanceiro.data} >= (current_date - interval '6 months')`,
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      const [aReceber] = await tx
        .select({
          quantidade: sql<number>`count(*)::int`,
          valor: sql<string>`coalesce(sum(${this.sqlTotalDaFatura()}), 0)::text`,
        })
        .from(fatura)
        .where(and(eq(fatura.tenantId, ctx.tenantId), eq(fatura.status, 'emitida')));

      const [aFaturar] = await tx
        .select({
          quantidade: sql<number>`count(*)::int`,
          /**
           * A referencia externa e LITERAL (`ordem_servico.id`), nunca
           * interpolada: dentro deste fragmento o Drizzle rendia
           * `${ordemServico.id}` como `"id"` sem qualificacao, o Postgres
           * resolvia para `i.id` (escopo interno vence), `i.ordem_id = i.id`
           * nunca era verdade e a soma vinha 0 - numero errado em silencio,
           * com a tela funcionando. Mesma armadilha ja documentada no M19.
           */
          valor: sql<string>`coalesce(sum((
            select sum(round(i.quantidade * i.valor_unitario * (1 - i.desconto_percentual / 100), 2))
            from item_ordem_servico i
            where i.ordem_id = ordem_servico.id
          )), 0)::text`,
        })
        .from(ordemServico)
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.status, 'despachada')));

      return {
        meses: meses.map((m) => ({
          mes: m.mes,
          entradas: Number(m.entradas),
          saidas: Number(m.saidas),
          saldo: Math.round((Number(m.entradas) - Number(m.saidas)) * 100) / 100,
        })),
        aReceber: { quantidade: aReceber!.quantidade, valor: Number(aReceber!.valor) },
        aFaturar: { quantidade: aFaturar!.quantidade, valor: Number(aFaturar!.valor) },
      };
    });
  }

  // --- Internos ----------------------------------------------------------

  /**
   * Soma dos itens de todas as ordens da fatura, em SQL, para listas.
   *
   * Sem cast para texto DE PROPOSITO: o resumo agrega isto com `sum()`, e
   * `sum(text)` nao existe no Postgres. O driver ja devolve numeric como
   * string, entao o tipo declarado continua honesto.
   */
  private sqlTotalDaFatura() {
    // Referencia externa literal - ver o comentario da armadilha em `resumo`.
    return sql<string>`coalesce((
      select sum(round(i.quantidade * i.valor_unitario * (1 - i.desconto_percentual / 100), 2))
      from item_ordem_servico i
      join ordem_servico o on o.id = i.ordem_id
      where o.fatura_id = fatura.id
    ), 0)`;
  }

  private async totalDaFatura(tx: Transacao, faturaId: string): Promise<number> {
    const ctx = exigirContexto();
    const ordens = await tx
      .select({ id: ordemServico.id })
      .from(ordemServico)
      .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.faturaId, faturaId)));

    let total = 0;
    for (const ordem of ordens) {
      const itens = await tx
        .select({
          quantidade: itemOrdemServico.quantidade,
          valorUnitario: itemOrdemServico.valorUnitario,
          descontoPercentual: itemOrdemServico.descontoPercentual,
        })
        .from(itemOrdemServico)
        .where(
          and(eq(itemOrdemServico.tenantId, ctx.tenantId), eq(itemOrdemServico.ordemId, ordem.id)),
        );
      total += totalDaOrdem(itens);
    }
    return Math.round(total * 100) / 100;
  }

  private async exigirFatura(tx: Transacao, faturaId: string, statusPermitidos: StatusFatura[]) {
    const ctx = exigirContexto();

    const [alvo] = await tx
      .select({ id: fatura.id, status: fatura.status, identificador: fatura.identificador })
      .from(fatura)
      .where(and(eq(fatura.tenantId, ctx.tenantId), eq(fatura.id, faturaId)))
      .limit(1);

    if (!alvo) throw new NotFoundException('Fatura não encontrada.');
    if (!statusPermitidos.includes(alvo.status as StatusFatura)) {
      throw new BadRequestException(
        `Fatura ${alvo.identificador} está "${alvo.status}" e não permite esta operação.`,
      );
    }
    return alvo;
  }
}
