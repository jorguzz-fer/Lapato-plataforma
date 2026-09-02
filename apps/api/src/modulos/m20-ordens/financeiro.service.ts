import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import {
  caso,
  cliente,
  fatura,
  itemOrdemServico,
  lancamentoFinanceiro,
  laudo,
  ordemServico,
  paciente,
  servico,
  tenant,
  usuario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  formatarReais,
  totalDaOrdem,
  type StatusFatura,
  type TipoLancamento,
} from '@lapato/shared';
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
   * Cria a fatura agrupando OSs FATURAVEIS do cliente.
   *
   * O portao e `faturavelEm` (segunda review): a OS fica faturavel ao
   * concluir a macroscopia - ou na entrada, para servico sem macroscopia.
   * Nem o despacho nem a liberacao do laudo entram na conta: um jogaria o
   * fim de mes para o mes seguinte, o outro cobraria antes de saber quantas
   * pecas sao.
   */
  async criarFatura(clienteId: string, ordemIds: string[]) {
    if (ordemIds.length === 0) {
      throw new BadRequestException('Escolha ao menos uma Ordem de Serviço faturável.');
    }

    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const ordens = await tx
        .select({
          id: ordemServico.id,
          status: ordemServico.status,
          clienteId: ordemServico.clienteId,
          faturavelEm: ordemServico.faturavelEm,
        })
        .from(ordemServico)
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), inArray(ordemServico.id, ordemIds)));

      if (ordens.length !== ordemIds.length) {
        throw new NotFoundException('Alguma das ordens não foi encontrada.');
      }
      for (const ordem of ordens) {
        if (ordem.status === 'faturada' || ordem.status === 'cancelada') {
          throw new BadRequestException(
            `Ordem já ${ordem.status} não entra em outra fatura.`,
          );
        }
        if (!ordem.faturavelEm) {
          throw new BadRequestException(
            'Só Ordem de Serviço faturável entra na fatura — ela fica faturável ao concluir ' +
              'a macroscopia (ou na entrada, quando o serviço não tem macroscopia).',
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

  /**
   * Cancelar a fatura devolve cada ordem ao marco operacional em que estava
   * (despachada, conferida ou aberta) - `faturavelEm` fica, entao elas podem
   * ser refaturadas na hora.
   */
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
        .set({
          status: sql`(case
            when ${ordemServico.despachadaEm} is not null then 'despachada'
            when ${ordemServico.conferidaEm} is not null then 'conferida'
            else 'aberta' end)::status_ordem_servico`,
          faturaId: null,
          atualizadoEm: agora,
        })
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
   * (faturaveis sem fatura).
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
        .where(
          and(
            eq(ordemServico.tenantId, ctx.tenantId),
            isNotNull(ordemServico.faturavelEm),
            notInArray(ordemServico.status, ['faturada', 'cancelada']),
          ),
        );

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

  // --- Fechamento mensal (segunda review) --------------------------------

  /**
   * O fechamento que a Roberta faz no dia 1: "um relatorio com todos os
   * exames, valor e subtotal, para todos os clientes". O corte e pela DATA DE
   * ENTRADA do material ("o que chegou no laboratorio entre o dia 1 e o dia
   * 31"), nao pela fatura - e o que o cliente reconhece.
   *
   * `ate` e exclusivo: passe o primeiro dia do mes seguinte. Cada linha diz o
   * status da OS para o financeiro enxergar o que ainda nao esta faturavel
   * (macroscopia pendente) e o retrabalho, que consta e nao cobra.
   */
  async fechamento(de: Date, ate: Date, clienteId?: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const linhas = await tx
        .select({
          clienteId: cliente.id,
          clienteNome: cliente.nomeFantasia,
          casoId: caso.id,
          casoIdentificador: caso.identificador,
          entradaEm: caso.entradaEm,
          paciente: paciente.nome,
          servico: servico.nome,
          ordemId: ordemServico.id,
          ordemIdentificador: ordemServico.identificador,
          status: ordemServico.status,
          faturavelEm: ordemServico.faturavelEm,
          faturaIdentificador: fatura.identificador,
          // Referencias externas literais (armadilha da subconsulta correlacionada).
          total: sql<string>`coalesce((
            select sum(round(i.quantidade * i.valor_unitario * (1 - i.desconto_percentual / 100), 2))
            from item_ordem_servico i where i.ordem_id = ordem_servico.id
          ), 0)::text`,
          retrabalhos: sql<number>`(
            select count(*)::int from item_ordem_servico i
            where i.ordem_id = ordem_servico.id and i.retrabalho
          )`,
        })
        .from(caso)
        .innerJoin(cliente, eq(cliente.id, caso.clienteId))
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .leftJoin(ordemServico, eq(ordemServico.casoId, caso.id))
        .leftJoin(fatura, eq(fatura.id, ordemServico.faturaId))
        .where(
          and(
            eq(caso.tenantId, ctx.tenantId),
            gte(caso.entradaEm, de),
            lt(caso.entradaEm, ate),
            ...(clienteId ? [eq(caso.clienteId, clienteId)] : []),
          ),
        )
        .orderBy(asc(cliente.nomeFantasia), asc(caso.entradaEm));

      const porCliente = new Map<
        string,
        {
          clienteId: string;
          clienteNome: string;
          subtotal: number;
          casos: number;
          semOrdem: number;
          naoFaturaveis: number;
          itens: typeof linhas;
        }
      >();
      for (const linha of linhas) {
        const grupo = porCliente.get(linha.clienteId) ?? {
          clienteId: linha.clienteId,
          clienteNome: linha.clienteNome,
          subtotal: 0,
          casos: 0,
          semOrdem: 0,
          naoFaturaveis: 0,
          itens: [],
        };
        grupo.casos += 1;
        if (!linha.ordemId) grupo.semOrdem += 1;
        else if (!linha.faturavelEm && linha.status !== 'cancelada') grupo.naoFaturaveis += 1;
        if (linha.status !== 'cancelada') grupo.subtotal += Number(linha.total ?? 0);
        grupo.itens.push(linha);
        porCliente.set(linha.clienteId, grupo);
      }

      const clientes = [...porCliente.values()].map((g) => ({
        ...g,
        subtotal: Math.round(g.subtotal * 100) / 100,
      }));
      return {
        de: de.toISOString(),
        ate: ate.toISOString(),
        total: Math.round(clientes.reduce((acc, c) => acc + c.subtotal, 0) * 100) / 100,
        clientes,
      };
    });
  }

  /** O mesmo fechamento em PDF - e o que vai por e-mail para cada cliente. */
  async fechamentoPdf(de: Date, ate: Date, clienteId?: string): Promise<Buffer> {
    const dados = await this.fechamento(de, ate, clienteId);
    const [instituicao] = await this.db.executar((tx) => {
      const ctx = exigirContexto();
      return tx.select({ nome: tenant.nomeFantasia }).from(tenant).where(eq(tenant.id, ctx.tenantId)).limit(1);
    });

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      // Titulo em ASCII de proposito: com acento o pdfkit grava UTF-16 e o
      // texto deixa de ser localizavel nos metadados.
      info: { Title: 'Fechamento do periodo', Author: instituicao?.nome ?? 'LAPATO' },
    });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    const pronto = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(partes))));

    const data = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR');
    const fim = new Date(ate.getTime() - 1);

    doc.fontSize(9).fillColor('#666').text((instituicao?.nome ?? '').toUpperCase());
    doc.moveDown(0.3);
    doc.fontSize(16).fillColor('#000').font('Helvetica-Bold').text('Fechamento do período');
    doc.font('Helvetica').fontSize(10).fillColor('#444')
      .text(`Exames com entrada de ${data(de)} a ${data(fim)} · gerado em ${new Date().toLocaleString('pt-BR')}`);
    doc.moveDown(1);

    for (const c of dados.clientes) {
      if (doc.y > 700) doc.addPage();
      doc.fontSize(12).fillColor('#000').font('Helvetica-Bold').text(c.clienteNome);
      doc.font('Helvetica').fontSize(9).fillColor('#444')
        .text(`${c.casos} exame(s)${c.naoFaturaveis ? ` · ${c.naoFaturaveis} ainda não faturável(is)` : ''}`);
      doc.moveDown(0.4);

      const x0 = 50;
      const colunas = [x0, x0 + 70, x0 + 150, x0 + 290, x0 + 400];
      doc.fontSize(8.5).fillColor('#666')
        .text('Entrada', colunas[0]!, doc.y, { continued: true, width: 70 })
        .text('Registro', colunas[1]!, doc.y, { continued: true, width: 80 })
        .text('Paciente', colunas[2]!, doc.y, { continued: true, width: 140 })
        .text('Serviço', colunas[3]!, doc.y, { continued: true, width: 110 })
        .text('Valor', colunas[4]!, doc.y, { width: 95, align: 'right' });
      doc.moveDown(0.2);

      for (const i of c.itens) {
        if (doc.y > 760) doc.addPage();
        const valor = i.status === 'cancelada' ? 'cancelada' : formatarReais(i.total ?? 0);
        const nota = !i.ordemId ? ' (sem OS)' : !i.faturavelEm && i.status !== 'cancelada' ? ' *' : '';
        doc.fontSize(9).fillColor('#000')
          .text(data(i.entradaEm), colunas[0]!, doc.y, { continued: true, width: 70 })
          .text(i.casoIdentificador, colunas[1]!, doc.y, { continued: true, width: 80 })
          .text(i.paciente, colunas[2]!, doc.y, { continued: true, width: 140 })
          .text(i.servico, colunas[3]!, doc.y, { continued: true, width: 110 })
          .text(valor + nota, colunas[4]!, doc.y, { width: 95, align: 'right' });
      }
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica-Bold')
        .text(`Subtotal ${c.clienteNome}: ${formatarReais(c.subtotal)}`, x0, doc.y, { width: 495, align: 'right' });
      doc.font('Helvetica');
      doc.moveDown(1);
    }

    if (dados.clientes.length === 0) {
      doc.fontSize(10).fillColor('#444').text('Nenhum exame com entrada no período.');
    } else {
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
        .text(`Total do período: ${formatarReais(dados.total)}`, 50, doc.y, { width: 495, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor('#666').moveDown(0.5)
        .text('* OS ainda não faturável (macroscopia pendente). Retrabalho consta na OS com valor zero e não é cobrado.');
    }

    doc.end();
    return pronto;
  }

  /**
   * Produtividade por patologista (Hugo: "de repente a gente pode ter alguem
   * que receba produtividade"; Roberta: o pagamento e mensal). Conta laudos
   * LIBERADOS no periodo por quem assinou o laudo, e os casos destinados que
   * ainda nao sairam - a fila de cada um.
   */
  async produtividade(de: Date, ate: Date) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const liberados = await tx
        .select({
          patologistaId: laudo.patologistaId,
          nome: usuario.nomeCompleto,
          laudos: sql<number>`count(*)::int`,
        })
        .from(laudo)
        .innerJoin(usuario, eq(usuario.id, laudo.patologistaId))
        .where(
          and(
            eq(laudo.tenantId, ctx.tenantId),
            isNotNull(laudo.liberadoEm),
            gte(laudo.liberadoEm, de),
            lt(laudo.liberadoEm, ate),
          ),
        )
        .groupBy(laudo.patologistaId, usuario.nomeCompleto)
        .orderBy(desc(sql`count(*)`));

      const emAberto = await tx
        .select({
          patologistaId: caso.patologistaResponsavelId,
          nome: usuario.nomeCompleto,
          casos: sql<number>`count(*)::int`,
        })
        .from(caso)
        .innerJoin(usuario, eq(usuario.id, caso.patologistaResponsavelId))
        .leftJoin(laudo, eq(laudo.casoId, caso.id))
        .where(
          and(
            eq(caso.tenantId, ctx.tenantId),
            isNotNull(caso.patologistaResponsavelId),
            sql`${laudo.liberadoEm} is null`,
            sql`${caso.canceladoEm} is null`,
          ),
        )
        .groupBy(caso.patologistaResponsavelId, usuario.nomeCompleto);

      const porId = new Map<string, { patologistaId: string; nome: string; laudosLiberados: number; casosEmAberto: number }>();
      for (const l of liberados) {
        if (!l.patologistaId) continue;
        porId.set(l.patologistaId, { patologistaId: l.patologistaId, nome: l.nome, laudosLiberados: l.laudos, casosEmAberto: 0 });
      }
      for (const a of emAberto) {
        if (!a.patologistaId) continue;
        const atual = porId.get(a.patologistaId) ?? { patologistaId: a.patologistaId, nome: a.nome, laudosLiberados: 0, casosEmAberto: 0 };
        atual.casosEmAberto = a.casos;
        porId.set(a.patologistaId, atual);
      }
      return {
        de: de.toISOString(),
        ate: ate.toISOString(),
        patologistas: [...porId.values()].sort((x, y) => y.laudosLiberados - x.laudosLiberados),
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
