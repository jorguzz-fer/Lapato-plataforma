import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  amostra,
  caso,
  cliente,
  faixaTabelaPreco,
  itemOrdemServico,
  itemTabelaPreco,
  macroscopia,
  ordemServico,
  paciente,
  precoCliente,
  servico,
  tabelaPreco,
  tutor,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  ORDEM_EDITAVEL,
  totalDaOrdem,
  type OrigemFaturavel,
  type StatusOrdemServico,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface NovoItemOrdem {
  servicoId?: string | null;
  descricao?: string | null;
  quantidade?: number;
  valorUnitario?: number | null;
  descontoPercentual?: number;
}

export interface EdicaoItemOrdem {
  descricao?: string;
  quantidade?: number;
  valorUnitario?: number;
  descontoPercentual?: number;
}

/**
 * M20 (parcial) - Ordem de Servico.
 *
 * O ciclo veio da primeira review com o laboratorio, que ja opera assim:
 *
 *   recebimento conferido -> OS aberta (itens editaveis)
 *     -> conferencia tecnica da saida ("foi tudo feito?") -> conferida
 *     -> despacho -> faturada (a fatura e do modulo financeiro)
 *
 * O portao da fatura e `faturavelEm`, nao o despacho - decisao da segunda
 * review (ver `ordemServico.faturavelEm` no schema): ao concluir a
 * macroscopia, ou na entrada quando o servico nao tem macroscopia.
 *
 * Tres regras estruturais:
 *
 * - **Uma OS por caso.** Servico adicional e ITEM da mesma ordem. E a ordem,
 *   nao o caso, que o financeiro fatura.
 * - **Preco e retrato.** O item copia o valor vigente (acordo do cliente, ou
 *   tabela padrao) no momento em que entra. Mudar preco depois nao retroage
 *   (M01) - por isso nenhuma leitura volta a consultar o preco atual.
 * - **Itens entram ate a fatura.** Conferir e despachar nao congelam: o
 *   laboratorio adiciona coloracao, margem, nova amostra depois de
 *   "finalizado" - faz e manda, sem aprovacao previa (Hugo).
 */
@Injectable()
export class OrdensService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
  ) {}

  /**
   * Cria a OS do caso no momento da conferencia do recebimento.
   *
   * Chamado DENTRO da transacao do recebimento (M05): se a criacao da ordem
   * falhar, o recebimento tambem falha - um material conferido sem ordem de
   * cobranca e exatamente o vazamento de receita que o modelo quer impedir.
   *
   * Idempotente por consulta: um segundo recebimento do mesmo caso (nao deve
   * acontecer, mas o banco nao proibe) nao gera segunda ordem.
   */
  async criarParaCaso(tx: Transacao, casoId: string): Promise<void> {
    const ctx = exigirContexto();

    const [existente] = await tx
      .select({ id: ordemServico.id })
      .from(ordemServico)
      .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.casoId, casoId)))
      .limit(1);
    if (existente) return;

    const [alvo] = await tx
      .select({
        clienteId: caso.clienteId,
        modalidade: caso.modalidade,
        servicoId: caso.servicoId,
        servicoNome: servico.nome,
        valorPadrao: servico.valorPadrao,
        exigeMacroscopia: servico.exigeMacroscopia,
      })
      .from(caso)
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);
    if (!alvo) throw new NotFoundException('Caso não encontrado.');

    /**
     * A quantidade nasce do que foi CONFERIDO: uma remessa com nodulo de pele
     * que revelou dois fragmentos cobra dois. A recepcao ajusta depois se o
     * acordo do cliente for por caso, nao por amostra.
     */
    const [{ quantidadeAmostras }] = (await tx
      .select({ quantidadeAmostras: sql<number>`count(*)::int` })
      .from(amostra)
      .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.casoId, casoId)))) as [
      { quantidadeAmostras: number },
    ];

    const agora = new Date();
    const identificador = await this.numeracao.proximaOrdemServico(tx, agora.getFullYear());

    /**
     * Servico sem macroscopia (citologia, necropsia) nao tem o momento "agora
     * sei quantas pecas sao" - a entrada conferida ja e o portao da fatura.
     */
    // Particular (documento do Hugo): "cobramos diretamente do tutor quando
    // ele nos entrega a amostra" - a entrada e o portao, com ou sem macro.
    const faturavelNaEntrada = !alvo.exigeMacroscopia || alvo.modalidade === 'particular';

    const [ordem] = await tx
      .insert(ordemServico)
      .values({
        tenantId: ctx.tenantId,
        identificador,
        casoId,
        clienteId: alvo.clienteId,
        ...(faturavelNaEntrada ? { faturavelEm: agora, faturavelOrigem: 'entrada' } : {}),
      })
      .returning({ id: ordemServico.id });

    const quantidade = Math.max(quantidadeAmostras, 1);
    const preco = await this.precoParaQuantidade(tx, alvo.clienteId, alvo.servicoId, quantidade);
    await tx.insert(itemOrdemServico).values({
      tenantId: ctx.tenantId,
      ordemId: ordem!.id,
      servicoId: alvo.servicoId,
      // Faixa por quantidade (documento do Hugo): o item vira 1 x total, com a
      // quantidade na descricao - o total acordado e exato, sem centavo de
      // arredondamento num unitario ficticio.
      descricao: preco.porFaixa ? `${alvo.servicoNome} (${quantidade} amostras)` : alvo.servicoNome,
      quantidade: preco.porFaixa ? '1' : String(quantidade),
      valorUnitario: preco.valor,
      ordem: 0,
    });

    await this.eventos.publicar(tx, {
      tipo: 'os.criada',
      casoId,
      moduloOrigem: MODULOS.M20_FINANCEIRO,
      objetoTipo: 'ordem_servico',
      objetoId: ordem!.id,
      payload: { identificador },
    });

    if (faturavelNaEntrada) {
      await this.publicarFaturavel(tx, casoId, ordem!.id, identificador, 'entrada');
    }
  }

  /**
   * Chamado pelo M08 ao concluir a macroscopia de uma amostra.
   *
   * A OS so fica faturavel quando TODAS as amostras que chegam a bancada tem
   * macroscopia concluida: com duas pecas, a primeira pronta ainda nao diz
   * quantos cassetes a segunda vai render. Amostra bloqueada ou recusada na
   * triagem fica fora da conta - ela nunca chega a bancada (M06).
   *
   * Idempotente: a segunda conclusao da mesma amostra (recorte) nao muda a
   * data nem publica de novo. Devolve se marcou agora.
   */
  async marcarFaturavelSeCompleta(tx: Transacao, casoId: string): Promise<boolean> {
    const ctx = exigirContexto();

    const [pendentes] = (await tx
      .select({ quantidade: sql<number>`count(*)::int` })
      .from(amostra)
      .leftJoin(macroscopia, eq(macroscopia.amostraId, amostra.id))
      .where(
        and(
          eq(amostra.tenantId, ctx.tenantId),
          eq(amostra.casoId, casoId),
          // `NOT IN` com NULL da NULL: amostra sem triagem (servico que dispensa)
          // precisa entrar explicitamente na conta.
          or(
            isNull(amostra.resultadoTriagem),
            notInArray(amostra.resultadoTriagem, ['bloqueado', 'recusado']),
          ),
          isNull(macroscopia.concluidaEm),
        ),
      )) as [{ quantidade: number }];
    if (pendentes.quantidade > 0) return false;

    const agora = new Date();
    const marcadas = await tx
      .update(ordemServico)
      .set({ faturavelEm: agora, faturavelOrigem: 'macroscopia', atualizadoEm: agora })
      .where(
        and(
          eq(ordemServico.tenantId, ctx.tenantId),
          eq(ordemServico.casoId, casoId),
          isNull(ordemServico.faturavelEm),
          notInArray(ordemServico.status, ['faturada', 'cancelada']),
        ),
      )
      .returning({ id: ordemServico.id, identificador: ordemServico.identificador });
    if (!marcadas[0]) return false;

    await this.publicarFaturavel(tx, casoId, marcadas[0].id, marcadas[0].identificador, 'macroscopia');
    return true;
  }

  private async publicarFaturavel(
    tx: Transacao,
    casoId: string,
    ordemId: string,
    identificador: string,
    origem: OrigemFaturavel,
  ): Promise<void> {
    await this.eventos.publicar(tx, {
      tipo: 'os.faturavel',
      casoId,
      moduloOrigem: MODULOS.M20_FINANCEIRO,
      objetoTipo: 'ordem_servico',
      objetoId: ordemId,
      payload: { identificador, origem },
    });
  }

  /**
   * Retrabalho do laboratorio (recorte, M08): consta na OS com valor ZERO.
   *
   * "Nao tem como eu cobrar do cliente - o erro foi nosso. Mas deve constar
   * na OS": quando for fechar o mes, o laboratorio sabe que aquilo saiu como
   * prejuizo. Valor zero nao mexe no total nem na fatura; a marca
   * `retrabalho` e o que o fechamento le.
   */
  async registrarRetrabalho(tx: Transacao, casoId: string, descricao: string): Promise<void> {
    const ctx = exigirContexto();

    const [ordem] = await tx
      .select({ id: ordemServico.id, status: ordemServico.status })
      .from(ordemServico)
      .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.casoId, casoId)))
      .limit(1);
    if (!ordem) throw new NotFoundException('O caso não tem Ordem de Serviço.');
    // Ordem cancelada nao tem fechamento onde o retrabalho apareceria.
    if (ordem.status === 'cancelada') return;

    const [{ maiorOrdem }] = (await tx
      .select({ maiorOrdem: sql<number>`coalesce(max(${itemOrdemServico.ordem}), 0)` })
      .from(itemOrdemServico)
      .where(
        and(eq(itemOrdemServico.tenantId, ctx.tenantId), eq(itemOrdemServico.ordemId, ordem.id)),
      )) as [{ maiorOrdem: number }];

    await tx.insert(itemOrdemServico).values({
      tenantId: ctx.tenantId,
      ordemId: ordem.id,
      descricao,
      quantidade: '1',
      valorUnitario: '0.00',
      retrabalho: true,
      ordem: maiorOrdem + 1,
    });
  }

  /**
   * Preco vigente para o par cliente x servico, nesta ordem: acordo
   * individual do cliente > tabela de precos do cliente (laboratorio,
   * clinica, hospital - segunda review) > valor padrao do servico. So e
   * consultado no momento em que um item ENTRA na ordem - nunca para reler
   * itens antigos.
   */
  /**
   * Preco para N amostras: a faixa da tabela do cliente quando existe
   * (documento do Hugo: "1 = 100, 2 = 160, 3 = 200"), senao linear. Faixa
   * abaixo de N e completada pelo unitario das amostras que excedem.
   */
  private async precoParaQuantidade(
    tx: Transacao,
    clienteId: string,
    servicoId: string,
    quantidade: number,
  ): Promise<{ valor: string; porFaixa: boolean }> {
    const ctx = exigirContexto();
    const unitario = await this.precoVigente(tx, clienteId, servicoId);
    if (quantidade < 2) return { valor: unitario, porFaixa: false };

    const [faixa] = await tx
      .select({ quantidade: faixaTabelaPreco.quantidade, valorTotal: faixaTabelaPreco.valorTotal })
      .from(cliente)
      .innerJoin(
        faixaTabelaPreco,
        and(
          eq(faixaTabelaPreco.tabelaId, cliente.tabelaPrecoId),
          eq(faixaTabelaPreco.servicoId, servicoId),
          eq(faixaTabelaPreco.tenantId, ctx.tenantId),
          sql`${faixaTabelaPreco.quantidade} <= ${quantidade}`,
        ),
      )
      .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, clienteId)))
      .orderBy(desc(faixaTabelaPreco.quantidade))
      .limit(1);
    if (!faixa) return { valor: unitario, porFaixa: false };

    const excedente = quantidade - faixa.quantidade;
    const total = Number(faixa.valorTotal) + excedente * Number(unitario);
    return { valor: total.toFixed(2), porFaixa: true };
  }

  private async precoVigente(
    tx: Transacao,
    clienteId: string,
    servicoId: string,
  ): Promise<string> {
    const ctx = exigirContexto();

    const [acordo] = await tx
      .select({ valor: precoCliente.valor })
      .from(precoCliente)
      .where(
        and(
          eq(precoCliente.tenantId, ctx.tenantId),
          eq(precoCliente.clienteId, clienteId),
          eq(precoCliente.servicoId, servicoId),
        ),
      )
      .limit(1);
    if (acordo) return acordo.valor;

    const [daTabela] = await tx
      .select({ valor: itemTabelaPreco.valor })
      .from(cliente)
      .innerJoin(
        itemTabelaPreco,
        and(
          eq(itemTabelaPreco.tabelaId, cliente.tabelaPrecoId),
          eq(itemTabelaPreco.servicoId, servicoId),
          eq(itemTabelaPreco.tenantId, ctx.tenantId),
        ),
      )
      .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, clienteId)))
      .limit(1);
    if (daTabela) return daTabela.valor;

    const [padrao] = await tx
      .select({ valor: servico.valorPadrao })
      .from(servico)
      .where(and(eq(servico.tenantId, ctx.tenantId), eq(servico.id, servicoId)))
      .limit(1);

    // Servico sem preco cadastrado entra zerado: a tela avisa e a recepcao
    // corrige antes do despacho. Melhor um zero visivel que um item ausente.
    return padrao?.valor ?? '0';
  }

  /** `apenasFaturaveis`: o que o financeiro pode colocar numa fatura agora. */
  async listar(status?: StatusOrdemServico, apenasFaturaveis = false) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const ordens = await tx
        .select({
          id: ordemServico.id,
          identificador: ordemServico.identificador,
          status: ordemServico.status,
          criadoEm: ordemServico.criadoEm,
          faturavelEm: ordemServico.faturavelEm,
          casoId: ordemServico.casoId,
          casoIdentificador: caso.identificador,
          clienteId: ordemServico.clienteId,
          clienteNome: cliente.nomeFantasia,
          // Particular: quem paga e o responsavel do paciente - e ele que a
          // tela mostra no lugar de "Particular".
          modalidade: caso.modalidade,
          responsavel: tutor.nome,
          // Referencia externa literal: interpolar a coluna aqui pode sair
          // sem qualificacao e capturar `i.id` (armadilha do M19).
          total: sql<string>`coalesce((
            select sum(round(i.quantidade * i.valor_unitario * (1 - i.desconto_percentual / 100), 2))
            from item_ordem_servico i
            where i.ordem_id = ordem_servico.id
          ), 0)::text`,
        })
        .from(ordemServico)
        .innerJoin(caso, eq(caso.id, ordemServico.casoId))
        .innerJoin(cliente, eq(cliente.id, ordemServico.clienteId))
        .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
        .leftJoin(tutor, eq(tutor.id, paciente.tutorId))
        .where(
          and(
            eq(ordemServico.tenantId, ctx.tenantId),
            ...(status ? [eq(ordemServico.status, status)] : []),
            ...(apenasFaturaveis
              ? [
                  isNotNull(ordemServico.faturavelEm),
                  notInArray(ordemServico.status, ['faturada', 'cancelada']),
                ]
              : []),
          ),
        )
        .orderBy(desc(ordemServico.criadoEm))
        .limit(200);

      return ordens;
    });
  }

  async buscarPorCaso(casoId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [ordem] = await tx
        .select({
          id: ordemServico.id,
          identificador: ordemServico.identificador,
          status: ordemServico.status,
          observacoes: ordemServico.observacoes,
          criadoEm: ordemServico.criadoEm,
          faturavelEm: ordemServico.faturavelEm,
          faturavelOrigem: ordemServico.faturavelOrigem,
          conferidaEm: ordemServico.conferidaEm,
          despachadaEm: ordemServico.despachadaEm,
          motivoCancelamento: ordemServico.motivoCancelamento,
          clienteNome: cliente.nomeFantasia,
        })
        .from(ordemServico)
        .innerJoin(cliente, eq(cliente.id, ordemServico.clienteId))
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.casoId, casoId)))
        .limit(1);

      if (!ordem) return null;

      const itens = await tx
        .select({
          id: itemOrdemServico.id,
          servicoId: itemOrdemServico.servicoId,
          descricao: itemOrdemServico.descricao,
          quantidade: itemOrdemServico.quantidade,
          valorUnitario: itemOrdemServico.valorUnitario,
          descontoPercentual: itemOrdemServico.descontoPercentual,
          retrabalho: itemOrdemServico.retrabalho,
        })
        .from(itemOrdemServico)
        .where(
          and(
            eq(itemOrdemServico.tenantId, ctx.tenantId),
            eq(itemOrdemServico.ordemId, ordem.id),
          ),
        )
        .orderBy(asc(itemOrdemServico.ordem), asc(itemOrdemServico.criadoEm));

      return { ...ordem, itens, total: totalDaOrdem(itens) };
    });
  }

  async adicionarItem(ordemId: string, dados: NovoItemOrdem) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const ordem = await this.exigirOrdem(tx, ordemId, [...ORDEM_EDITAVEL]);

      let descricao = dados.descricao?.trim() ?? '';
      let valor =
        dados.valorUnitario != null ? dados.valorUnitario.toFixed(2) : null;

      if (dados.servicoId) {
        const [alvo] = await tx
          .select({ nome: servico.nome })
          .from(servico)
          .where(and(eq(servico.tenantId, ctx.tenantId), eq(servico.id, dados.servicoId)))
          .limit(1);
        if (!alvo) throw new BadRequestException('Serviço não encontrado.');
        descricao = descricao || alvo.nome;
        valor = valor ?? (await this.precoVigente(tx, ordem.clienteId, dados.servicoId));
      }

      if (!descricao) {
        throw new BadRequestException('Item avulso precisa de descrição.');
      }
      if (valor == null) {
        throw new BadRequestException('Item avulso precisa de valor unitário.');
      }

      const [{ maiorOrdem }] = (await tx
        .select({ maiorOrdem: sql<number>`coalesce(max(${itemOrdemServico.ordem}), 0)` })
        .from(itemOrdemServico)
        .where(
          and(eq(itemOrdemServico.tenantId, ctx.tenantId), eq(itemOrdemServico.ordemId, ordemId)),
        )) as [{ maiorOrdem: number }];

      const [item] = await tx
        .insert(itemOrdemServico)
        .values({
          tenantId: ctx.tenantId,
          ordemId,
          servicoId: dados.servicoId ?? null,
          descricao,
          quantidade: String(dados.quantidade ?? 1),
          valorUnitario: valor,
          descontoPercentual: String(dados.descontoPercentual ?? 0),
          ordem: maiorOrdem + 1,
        })
        .returning({ id: itemOrdemServico.id });

      return { id: item!.id };
    });
  }

  async editarItem(ordemId: string, itemId: string, dados: EdicaoItemOrdem) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      await this.exigirOrdem(tx, ordemId, [...ORDEM_EDITAVEL]);

      const [anterior] = await tx
        .select()
        .from(itemOrdemServico)
        .where(
          and(
            eq(itemOrdemServico.tenantId, ctx.tenantId),
            eq(itemOrdemServico.id, itemId),
            eq(itemOrdemServico.ordemId, ordemId),
          ),
        )
        .limit(1);
      if (!anterior) throw new NotFoundException('Item não encontrado.');

      await tx
        .update(itemOrdemServico)
        .set({
          ...(dados.descricao !== undefined ? { descricao: dados.descricao.trim() } : {}),
          ...(dados.quantidade !== undefined ? { quantidade: String(dados.quantidade) } : {}),
          ...(dados.valorUnitario !== undefined
            ? { valorUnitario: dados.valorUnitario.toFixed(2) }
            : {}),
          ...(dados.descontoPercentual !== undefined
            ? { descontoPercentual: String(dados.descontoPercentual) }
            : {}),
          atualizadoEm: new Date(),
        })
        .where(and(eq(itemOrdemServico.tenantId, ctx.tenantId), eq(itemOrdemServico.id, itemId)));

      // Valor de OS e dado sensivel: alteracao fica no rastro de auditoria.
      await this.auditoria.registrar(tx, {
        entidade: 'item_ordem_servico',
        entidadeId: itemId,
        acao: 'editar',
        valorAnterior: {
          quantidade: anterior.quantidade,
          valorUnitario: anterior.valorUnitario,
          descontoPercentual: anterior.descontoPercentual,
        },
        valorNovo: dados as Record<string, unknown>,
      });

      return { ok: true };
    });
  }

  async removerItem(ordemId: string, itemId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      await this.exigirOrdem(tx, ordemId, [...ORDEM_EDITAVEL]);

      const removidos = await tx
        .delete(itemOrdemServico)
        .where(
          and(
            eq(itemOrdemServico.tenantId, ctx.tenantId),
            eq(itemOrdemServico.id, itemId),
            eq(itemOrdemServico.ordemId, ordemId),
          ),
        )
        .returning({ id: itemOrdemServico.id, descricao: itemOrdemServico.descricao });
      if (!removidos[0]) throw new NotFoundException('Item não encontrado.');

      await this.auditoria.registrar(tx, {
        entidade: 'item_ordem_servico',
        entidadeId: itemId,
        acao: 'remover',
        valorAnterior: { descricao: removidos[0].descricao },
      });

      return { ok: true };
    });
  }

  /**
   * A conferencia da saida: alguem olhou a OS e confirmou que tudo que ela
   * lista foi executado. Marco operacional - nao congela itens nem e o
   * portao da fatura (ver `faturavelEm`).
   */
  async conferir(ordemId: string) {
    return this.transicionar(ordemId, ['aberta'], 'conferida', 'os.conferida', (agora, ctx) => ({
      conferidaEm: agora,
      conferidaPorId: ctx.usuarioId,
    }));
  }

  async despachar(ordemId: string) {
    return this.transicionar(
      ordemId,
      ['conferida'],
      'despachada',
      'os.despachada',
      (agora, ctx) => ({
        despachadaEm: agora,
        despachadaPorId: ctx.usuarioId,
      }),
    );
  }

  async cancelar(ordemId: string, motivo: string) {
    if (!motivo.trim()) {
      throw new BadRequestException('Cancelamento de OS exige motivo.');
    }
    return this.transicionar(
      ordemId,
      ['aberta', 'conferida'],
      'cancelada',
      'os.cancelada',
      (agora) => ({
        canceladaEm: agora,
        motivoCancelamento: motivo.trim(),
      }),
    );
  }

  private async transicionar(
    ordemId: string,
    origens: StatusOrdemServico[],
    destino: StatusOrdemServico,
    tipoEvento: 'os.conferida' | 'os.despachada' | 'os.cancelada',
    campos: (
      agora: Date,
      ctx: ReturnType<typeof exigirContexto>,
    ) => Partial<typeof ordemServico.$inferInsert>,
  ) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const ordem = await this.exigirOrdem(tx, ordemId, origens);

      if (destino === 'conferida') {
        const [{ quantidadeItens }] = (await tx
          .select({ quantidadeItens: sql<number>`count(*)::int` })
          .from(itemOrdemServico)
          .where(
            and(
              eq(itemOrdemServico.tenantId, ctx.tenantId),
              eq(itemOrdemServico.ordemId, ordemId),
            ),
          )) as [{ quantidadeItens: number }];
        if (quantidadeItens === 0) {
          throw new BadRequestException('OS sem itens não pode ser conferida.');
        }
      }

      const agora = new Date();
      await tx
        .update(ordemServico)
        .set({ status: destino, atualizadoEm: agora, ...campos(agora, ctx) })
        .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.id, ordemId)));

      await this.eventos.publicar(tx, {
        tipo: tipoEvento,
        casoId: ordem.casoId,
        moduloOrigem: MODULOS.M20_FINANCEIRO,
        objetoTipo: 'ordem_servico',
        objetoId: ordemId,
        payload: { identificador: ordem.identificador },
      });

      return { ok: true, status: destino };
    });
  }

  private async exigirOrdem(tx: Transacao, ordemId: string, statusPermitidos: StatusOrdemServico[]) {
    const ctx = exigirContexto();

    const [ordem] = await tx
      .select({
        id: ordemServico.id,
        status: ordemServico.status,
        casoId: ordemServico.casoId,
        clienteId: ordemServico.clienteId,
        identificador: ordemServico.identificador,
      })
      .from(ordemServico)
      .where(and(eq(ordemServico.tenantId, ctx.tenantId), eq(ordemServico.id, ordemId)))
      .limit(1);

    if (!ordem) throw new NotFoundException('Ordem de Serviço não encontrada.');
    if (!statusPermitidos.includes(ordem.status as StatusOrdemServico)) {
      throw new BadRequestException(
        `Ordem ${ordem.identificador} está "${ordem.status}" e não permite esta operação.`,
      );
    }
    return ordem;
  }

  // --- Precos ------------------------------------------------------------

  /**
   * Precos do cliente: o catalogo inteiro com as tres camadas lado a lado -
   * valor padrao, valor da tabela que o cliente segue e acordo individual. A
   * tela mostra qual vence; o item de OS copia o vencedor no momento em que
   * entra (M01: nao retroage).
   */
  async precosDoCliente(clienteId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [dono] = await tx
        .select({ tabelaPrecoId: cliente.tabelaPrecoId, tabelaNome: tabelaPreco.nome })
        .from(cliente)
        .leftJoin(tabelaPreco, eq(tabelaPreco.id, cliente.tabelaPrecoId))
        .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, clienteId)))
        .limit(1);
      if (!dono) throw new NotFoundException('Cliente não encontrado.');

      const linhas = await tx
        .select({
          servicoId: servico.id,
          nome: servico.nome,
          codigo: servico.codigo,
          valorPadrao: servico.valorPadrao,
          valorTabela: itemTabelaPreco.valor,
          valorCliente: precoCliente.valor,
        })
        .from(servico)
        .leftJoin(
          itemTabelaPreco,
          and(
            eq(itemTabelaPreco.servicoId, servico.id),
            dono.tabelaPrecoId ? eq(itemTabelaPreco.tabelaId, dono.tabelaPrecoId) : sql`false`,
            eq(itemTabelaPreco.tenantId, ctx.tenantId),
          ),
        )
        .leftJoin(
          precoCliente,
          and(
            eq(precoCliente.servicoId, servico.id),
            eq(precoCliente.clienteId, clienteId),
            eq(precoCliente.tenantId, ctx.tenantId),
          ),
        )
        .where(and(eq(servico.tenantId, ctx.tenantId), isNull(servico.inativadoEm)))
        .orderBy(asc(servico.nome));

      return linhas.map((l) => ({ ...l, tabelaNome: dono.tabelaNome ?? null }));
    });
  }

  // --- Tabelas de preco (segunda review) -----------------------------------

  async listarTabelas() {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      return tx
        .select({
          id: tabelaPreco.id,
          nome: tabelaPreco.nome,
          descricao: tabelaPreco.descricao,
          inativadoEm: tabelaPreco.inativadoEm,
          // Referencia externa literal (armadilha da subconsulta correlacionada).
          clientes: sql<number>`(
            select count(*)::int from cliente c where c.tabela_preco_id = tabela_preco.id
          )`,
        })
        .from(tabelaPreco)
        .where(eq(tabelaPreco.tenantId, ctx.tenantId))
        // Ativas primeiro (NULL ordena por ultimo em ASC no Postgres), depois nome.
        .orderBy(sql`${tabelaPreco.inativadoEm} is not null`, asc(tabelaPreco.nome));
    });
  }

  /** So as ativas, para o formulario do cliente escolher. */
  async opcoesDeTabela() {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      return tx
        .select({ id: tabelaPreco.id, nome: tabelaPreco.nome })
        .from(tabelaPreco)
        .where(and(eq(tabelaPreco.tenantId, ctx.tenantId), isNull(tabelaPreco.inativadoEm)))
        .orderBy(asc(tabelaPreco.nome));
    });
  }

  async criarTabela(nome: string, descricao?: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const limpo = nome.trim();

      const [existente] = await tx
        .select({ id: tabelaPreco.id })
        .from(tabelaPreco)
        .where(and(eq(tabelaPreco.tenantId, ctx.tenantId), eq(tabelaPreco.nome, limpo)))
        .limit(1);
      if (existente) throw new BadRequestException(`Já existe uma tabela chamada "${limpo}".`);

      const [nova] = await tx
        .insert(tabelaPreco)
        .values({ tenantId: ctx.tenantId, nome: limpo, descricao: descricao?.trim() || null })
        .returning({ id: tabelaPreco.id });

      await this.auditoria.registrar(tx, {
        entidade: 'tabela_preco',
        entidadeId: nova!.id,
        acao: 'criar',
        valorNovo: { nome: limpo },
      });
      return { id: nova!.id };
    });
  }

  /** Renomear, descrever, inativar ou reativar. Inativar nao apaga (M01). */
  async editarTabela(
    id: string,
    dados: { nome?: string; descricao?: string | null; ativa?: boolean },
  ) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const tabela = await this.exigirTabela(tx, id);

      const mudancas: Partial<typeof tabelaPreco.$inferInsert> = {};
      if (dados.nome !== undefined && dados.nome.trim() !== tabela.nome) {
        const [colisao] = await tx
          .select({ id: tabelaPreco.id })
          .from(tabelaPreco)
          .where(and(eq(tabelaPreco.tenantId, ctx.tenantId), eq(tabelaPreco.nome, dados.nome.trim())))
          .limit(1);
        if (colisao) throw new BadRequestException(`Já existe uma tabela chamada "${dados.nome.trim()}".`);
        mudancas.nome = dados.nome.trim();
      }
      if (dados.descricao !== undefined) mudancas.descricao = dados.descricao?.trim() || null;
      if (dados.ativa !== undefined) {
        mudancas.inativadoEm = dados.ativa ? null : new Date();
        mudancas.inativadoPor = dados.ativa ? null : ctx.usuarioId;
      }
      if (Object.keys(mudancas).length === 0) return { ok: true };

      await tx
        .update(tabelaPreco)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(and(eq(tabelaPreco.tenantId, ctx.tenantId), eq(tabelaPreco.id, id)));

      await this.auditoria.registrar(tx, {
        entidade: 'tabela_preco',
        entidadeId: id,
        acao: 'editar',
        valorAnterior: { nome: tabela.nome, inativadoEm: tabela.inativadoEm },
        valorNovo: mudancas as Record<string, unknown>,
      });
      return { ok: true };
    });
  }

  /** Catalogo inteiro com o valor padrao e o valor desta tabela ao lado. */
  async itensDaTabela(tabelaId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      await this.exigirTabela(tx, tabelaId);

      return tx
        .select({
          servicoId: servico.id,
          nome: servico.nome,
          codigo: servico.codigo,
          valorPadrao: servico.valorPadrao,
          valorTabela: itemTabelaPreco.valor,
        })
        .from(servico)
        .leftJoin(
          itemTabelaPreco,
          and(
            eq(itemTabelaPreco.servicoId, servico.id),
            eq(itemTabelaPreco.tabelaId, tabelaId),
            eq(itemTabelaPreco.tenantId, ctx.tenantId),
          ),
        )
        .where(and(eq(servico.tenantId, ctx.tenantId), isNull(servico.inativadoEm)))
        .orderBy(asc(servico.nome));
    });
  }

  /** Faixas por quantidade de um servico na tabela (documento do Hugo). */
  async faixasDaTabela(tabelaId: string, servicoId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      await this.exigirTabela(tx, tabelaId);
      return tx
        .select({
          quantidade: faixaTabelaPreco.quantidade,
          valorTotal: faixaTabelaPreco.valorTotal,
        })
        .from(faixaTabelaPreco)
        .where(
          and(
            eq(faixaTabelaPreco.tenantId, ctx.tenantId),
            eq(faixaTabelaPreco.tabelaId, tabelaId),
            eq(faixaTabelaPreco.servicoId, servicoId),
          ),
        )
        .orderBy(asc(faixaTabelaPreco.quantidade));
    });
  }

  /** Define (ou remove, com total nulo) o total de N amostras do servico na tabela. */
  async definirFaixaTabela(
    tabelaId: string,
    servicoId: string,
    quantidade: number,
    valorTotal: number | null,
  ) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      await this.exigirTabela(tx, tabelaId);

      if (valorTotal == null) {
        await tx
          .delete(faixaTabelaPreco)
          .where(
            and(
              eq(faixaTabelaPreco.tenantId, ctx.tenantId),
              eq(faixaTabelaPreco.tabelaId, tabelaId),
              eq(faixaTabelaPreco.servicoId, servicoId),
              eq(faixaTabelaPreco.quantidade, quantidade),
            ),
          );
        return { ok: true };
      }

      await tx
        .insert(faixaTabelaPreco)
        .values({
          tenantId: ctx.tenantId,
          tabelaId,
          servicoId,
          quantidade,
          valorTotal: valorTotal.toFixed(2),
        })
        .onConflictDoUpdate({
          target: [
            faixaTabelaPreco.tenantId,
            faixaTabelaPreco.tabelaId,
            faixaTabelaPreco.servicoId,
            faixaTabelaPreco.quantidade,
          ],
          set: { valorTotal: valorTotal.toFixed(2), atualizadoEm: new Date() },
        });

      await this.auditoria.registrar(tx, {
        entidade: 'faixa_tabela_preco',
        entidadeId: tabelaId,
        acao: 'definir',
        valorNovo: { servicoId, quantidade, valorTotal: valorTotal.toFixed(2) },
      });
      return { ok: true };
    });
  }

  /** Define ou remove (valor nulo) o preco de um servico na tabela. */
  async definirItemTabela(tabelaId: string, servicoId: string, valor: number | null) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      await this.exigirTabela(tx, tabelaId);

      if (valor == null) {
        await tx
          .delete(itemTabelaPreco)
          .where(
            and(
              eq(itemTabelaPreco.tenantId, ctx.tenantId),
              eq(itemTabelaPreco.tabelaId, tabelaId),
              eq(itemTabelaPreco.servicoId, servicoId),
            ),
          );
        return { ok: true };
      }

      await tx
        .insert(itemTabelaPreco)
        .values({ tenantId: ctx.tenantId, tabelaId, servicoId, valor: valor.toFixed(2) })
        .onConflictDoUpdate({
          target: [itemTabelaPreco.tenantId, itemTabelaPreco.tabelaId, itemTabelaPreco.servicoId],
          set: { valor: valor.toFixed(2), atualizadoEm: new Date() },
        });

      await this.auditoria.registrar(tx, {
        entidade: 'item_tabela_preco',
        entidadeId: tabelaId,
        acao: 'definir',
        valorNovo: { servicoId, valor: valor.toFixed(2) },
      });
      return { ok: true };
    });
  }

  private async exigirTabela(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [tabela] = await tx
      .select({ id: tabelaPreco.id, nome: tabelaPreco.nome, inativadoEm: tabelaPreco.inativadoEm })
      .from(tabelaPreco)
      .where(and(eq(tabelaPreco.tenantId, ctx.tenantId), eq(tabelaPreco.id, id)))
      .limit(1);
    if (!tabela) throw new NotFoundException('Tabela de preços não encontrada.');
    return tabela;
  }

  /** Define ou remove (valor nulo) o acordo do cliente para um servico. */
  async definirPrecoCliente(clienteId: string, servicoId: string, valor: number | null) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      if (valor == null) {
        await tx
          .delete(precoCliente)
          .where(
            and(
              eq(precoCliente.tenantId, ctx.tenantId),
              eq(precoCliente.clienteId, clienteId),
              eq(precoCliente.servicoId, servicoId),
            ),
          );
        return { ok: true };
      }

      await tx
        .insert(precoCliente)
        .values({
          tenantId: ctx.tenantId,
          clienteId,
          servicoId,
          valor: valor.toFixed(2),
        })
        .onConflictDoUpdate({
          target: [precoCliente.tenantId, precoCliente.clienteId, precoCliente.servicoId],
          set: { valor: valor.toFixed(2), atualizadoEm: new Date() },
        });

      await this.auditoria.registrar(tx, {
        entidade: 'preco_cliente',
        entidadeId: clienteId,
        acao: 'definir',
        valorNovo: { servicoId, valor: valor.toFixed(2) },
      });

      return { ok: true };
    });
  }
}
