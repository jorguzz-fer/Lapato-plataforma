import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  cliente,
  movimentacaoLogistica,
  ofertaServico,
  rotaLogistica,
  solicitacaoLogistica,
  usuario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  PERMISSOES,
  STATUS_LOGISTICO_ABERTO,
  type AchadoGuardian,
  type StatusSolicitacaoLogistica,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/** Paradas que ainda nao sairam do lugar - podem ser removidas ou trocadas de rota. */
const STATUS_PARADA_PLANEJADA: StatusSolicitacaoLogistica[] = [
  'recebida',
  'aguardando_informacao',
  'aguardando_triagem',
  'aguardando_aceite',
  'aceita',
  'agendada',
];

/**
 * M19 - Rotas (secoes 37 a 47).
 *
 * A rota e a agenda de UM encarregado num dia: uma sequencia de paradas. O
 * documento pede que a montagem seja manual (secao 38) e a sugestao automatica
 * seja opcional (secao 39) - aqui esta a manual, e a ordem e o que a central
 * decidir.
 *
 * Incluir numa rota e ATRIBUIR (secao 44 registra o momento da inclusao): a
 * parada que ainda nao tinha dono passa a ter, e as ofertas abertas morrem.
 */
@Injectable()
export class LogisticaRotasService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly guardian: GuardianService,
  ) {}

  async criar(dados: {
    encarregadoId: string;
    data: string;
    veiculo?: string | null;
    observacoes?: string | null;
    solicitacaoIds: string[];
  }): Promise<{ id: string; paradas: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [enc] = await tx
        .select({ id: usuario.id, nome: usuario.nomeCompleto })
        .from(usuario)
        .where(
          and(
            eq(usuario.tenantId, ctx.tenantId),
            eq(usuario.id, dados.encarregadoId),
            eq(usuario.status, 'ativo'),
          ),
        )
        .limit(1);
      if (!enc) throw new BadRequestException('Encarregado inexistente ou inativo.');

      const [rota] = await tx
        .insert(rotaLogistica)
        .values({
          tenantId: ctx.tenantId,
          encarregadoId: dados.encarregadoId,
          data: dados.data,
          veiculo: dados.veiculo ?? null,
          observacoes: dados.observacoes ?? null,
          criadaPorId: ctx.usuarioId,
        })
        .returning({ id: rotaLogistica.id });

      await this.incluir(tx, rota!.id, dados.encarregadoId, enc.nome, dados.solicitacaoIds, 1);

      await this.auditoria.registrar(tx, {
        entidade: 'rota_logistica',
        entidadeId: rota!.id,
        acao: 'criar',
        valorNovo: { encarregadoId: dados.encarregadoId, data: dados.data, paradas: dados.solicitacaoIds },
      });

      return { id: rota!.id, paradas: dados.solicitacaoIds.length };
    });
  }

  /**
   * Secao 43: incluir, remover ou reordenar paradas com a rota em andamento.
   * A lista recebida e a ordem final; o que saiu dela e removido, desde que
   * ainda nao tenha comecado.
   */
  async reordenar(rotaId: string, solicitacaoIds: string[]): Promise<void> {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const rota = await this.buscar(tx, rotaId);
      if (rota.status === 'encerrada') throw new BadRequestException('Rota encerrada não muda.');

      const atuais = await tx
        .select({ id: solicitacaoLogistica.id, status: solicitacaoLogistica.status })
        .from(solicitacaoLogistica)
        .where(and(eq(solicitacaoLogistica.tenantId, ctx.tenantId), eq(solicitacaoLogistica.rotaId, rotaId)));

      const novas = new Set(solicitacaoIds);
      for (const parada of atuais) {
        if (novas.has(parada.id)) continue;
        if (!STATUS_PARADA_PLANEJADA.includes(parada.status) && STATUS_LOGISTICO_ABERTO.includes(parada.status)) {
          throw new BadRequestException(
            'Uma parada já iniciada não sai da rota. Conclua ou registre a não realização.',
          );
        }
        await tx
          .update(solicitacaoLogistica)
          .set({ rotaId: null, ordemNaRota: null, atualizadoEm: new Date() })
          .where(eq(solicitacaoLogistica.id, parada.id));
        await this.registrar(tx, parada.id, {
          tipo: 'removida_da_rota',
          descricao: 'Retirada da rota do dia.',
          detalhe: { rotaId },
        });
      }

      const [enc] = await tx
        .select({ nome: usuario.nomeCompleto })
        .from(usuario)
        .where(eq(usuario.id, rota.encarregadoId))
        .limit(1);

      const jaNaRota = new Set(atuais.map((p) => p.id));
      const aIncluir = solicitacaoIds.filter((id) => !jaNaRota.has(id));
      await this.incluir(tx, rotaId, rota.encarregadoId, enc?.nome ?? '', aIncluir, 1);

      // A ordem final, para todas.
      for (const [i, id] of solicitacaoIds.entries()) {
        await tx
          .update(solicitacaoLogistica)
          .set({ ordemNaRota: i + 1 })
          .where(and(eq(solicitacaoLogistica.id, id), eq(solicitacaoLogistica.rotaId, rotaId)));
      }

      await this.auditoria.registrar(tx, {
        entidade: 'rota_logistica',
        entidadeId: rotaId,
        acao: 'reordenar',
        valorAnterior: { paradas: atuais.map((p) => p.id) },
        valorNovo: { paradas: solicitacaoIds },
      });
    });
  }

  /** Secao 47: iniciar registra data e hora; as paradas aceitas viram agendadas. */
  async iniciar(rotaId: string): Promise<void> {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const rota = await this.buscar(tx, rotaId);
      this.exigirDono(rota);
      if (rota.status !== 'planejada') throw new BadRequestException('A rota já foi iniciada.');

      const agora = new Date();
      await tx
        .update(rotaLogistica)
        .set({ status: 'em_andamento', iniciadaEm: agora, atualizadoEm: agora })
        .where(eq(rotaLogistica.id, rotaId));

      const paradas = await tx
        .update(solicitacaoLogistica)
        .set({ status: 'agendada', atualizadoEm: agora })
        .where(
          and(
            eq(solicitacaoLogistica.tenantId, ctx.tenantId),
            eq(solicitacaoLogistica.rotaId, rotaId),
            eq(solicitacaoLogistica.status, 'aceita'),
          ),
        )
        .returning({ id: solicitacaoLogistica.id, casoId: solicitacaoLogistica.casoId });

      for (const p of paradas) {
        await this.registrar(tx, p.id, {
          tipo: 'rota_iniciada',
          statusAnterior: 'aceita',
          statusNovo: 'agendada',
          visivelPortal: true,
          descricao: `Rota do dia iniciada por ${ctx.nomeCompleto}.`,
          detalhe: { rotaId },
        });
      }

      await this.eventos.publicar(tx, {
        tipo: 'logistica.rota_iniciada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        objetoTipo: 'rota_logistica',
        objetoId: rotaId,
        visibilidade: 'interno',
        payload: { encarregadoId: rota.encarregadoId, paradas: paradas.length },
      });
    });
  }

  /**
   * Encerrar (secao 111: "rota encerrada com solicitacao pendente" e achado
   * do Guardian). Parada aberta bloqueia; a resposta lista cada uma, com o
   * que fazer, em vez de um erro seco.
   */
  async encerrar(rotaId: string): Promise<void> {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const rota = await this.buscar(tx, rotaId);
      this.exigirDono(rota);
      if (rota.status === 'encerrada') throw new BadRequestException('A rota já está encerrada.');

      const pendentes = await tx
        .select({
          id: solicitacaoLogistica.id,
          identificador: solicitacaoLogistica.identificador,
          status: solicitacaoLogistica.status,
        })
        .from(solicitacaoLogistica)
        .where(
          and(
            eq(solicitacaoLogistica.tenantId, ctx.tenantId),
            eq(solicitacaoLogistica.rotaId, rotaId),
            inArray(solicitacaoLogistica.status, STATUS_LOGISTICO_ABERTO),
          ),
        );

      const achados: AchadoGuardian[] = pendentes.map((p) => ({
        codigo: 'LOGISTICA_ROTA_COM_PENDENCIA',
        nivel: 'critico',
        mensagem: `${p.identificador} ainda está "${p.status}" e pertence a esta rota.`,
        modulo: MODULOS.M19_LOGISTICA,
        comoResolver:
          p.status === 'entregue'
            ? 'Conclua o serviço.'
            : 'Registre a entrega, a não realização com motivo, ou tire a parada da rota.',
        evidencias: { solicitacaoId: p.id, status: p.status },
      }));
      this.guardian.garantirSemBloqueio(achados, 'encerrar a rota');

      const agora = new Date();
      await tx
        .update(rotaLogistica)
        .set({ status: 'encerrada', encerradaEm: agora, atualizadoEm: agora })
        .where(eq(rotaLogistica.id, rotaId));

      await this.eventos.publicar(tx, {
        tipo: 'logistica.rota_encerrada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        objetoTipo: 'rota_logistica',
        objetoId: rotaId,
        visibilidade: 'interno',
        payload: { encarregadoId: rota.encarregadoId },
      });
    });
  }

  async listar(filtros: { data?: string; encarregadoId?: string; minhas?: boolean }) {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          id: rotaLogistica.id,
          data: rotaLogistica.data,
          status: rotaLogistica.status,
          veiculo: rotaLogistica.veiculo,
          encarregadoId: rotaLogistica.encarregadoId,
          encarregado: usuario.nomeCompleto,
          iniciadaEm: rotaLogistica.iniciadaEm,
          encerradaEm: rotaLogistica.encerradaEm,
          /** Coluna externa por extenso — mesma armadilha do M18. */
          paradas: sql<number>`(
            select count(*)::int from ${solicitacaoLogistica} s
            where s.rota_id = rota_logistica.id and s.tenant_id = rota_logistica.tenant_id
          )`,
          concluidas: sql<number>`(
            select count(*)::int from ${solicitacaoLogistica} s
            where s.rota_id = rota_logistica.id and s.tenant_id = rota_logistica.tenant_id
              and s.status in ('concluida','nao_realizada','cancelada')
          )`,
        })
        .from(rotaLogistica)
        .innerJoin(usuario, eq(usuario.id, rotaLogistica.encarregadoId))
        .where(
          and(
            eq(rotaLogistica.tenantId, ctx.tenantId),
            filtros.data ? eq(rotaLogistica.data, filtros.data) : undefined,
            filtros.minhas
              ? eq(rotaLogistica.encarregadoId, ctx.usuarioId)
              : filtros.encarregadoId
                ? eq(rotaLogistica.encarregadoId, filtros.encarregadoId)
                : undefined,
          ),
        )
        .orderBy(desc(rotaLogistica.data), asc(usuario.nomeCompleto))
        .limit(200),
    );
  }

  /** A rota com as paradas na ordem (secao 41): "apenas as informacoes necessarias". */
  async ficha(rotaId: string) {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const rota = await this.buscar(tx, rotaId);
      const [enc] = await tx
        .select({ nome: usuario.nomeCompleto })
        .from(usuario)
        .where(eq(usuario.id, rota.encarregadoId))
        .limit(1);

      const paradas = await tx
        .select({
          id: solicitacaoLogistica.id,
          identificador: solicitacaoLogistica.identificador,
          ordem: solicitacaoLogistica.ordemNaRota,
          tipoServico: solicitacaoLogistica.tipoServico,
          tipoOperacao: solicitacaoLogistica.tipoOperacao,
          cliente: cliente.nomeFantasia,
          endereco: solicitacaoLogistica.endereco,
          pontoReferencia: solicitacaoLogistica.pontoReferencia,
          contatoNoLocal: solicitacaoLogistica.contatoNoLocal,
          telefoneContato: solicitacaoLogistica.telefoneContato,
          janelaInicio: solicitacaoLogistica.janelaInicio,
          janelaFim: solicitacaoLogistica.janelaFim,
          prioridade: solicitacaoLogistica.prioridade,
          tipoMaterial: solicitacaoLogistica.tipoMaterial,
          requisitosEspeciais: solicitacaoLogistica.requisitosEspeciais,
          status: solicitacaoLogistica.status,
          comOcorrencia: solicitacaoLogistica.comOcorrencia,
        })
        .from(solicitacaoLogistica)
        .innerJoin(cliente, eq(cliente.id, solicitacaoLogistica.clienteId))
        .where(and(eq(solicitacaoLogistica.tenantId, ctx.tenantId), eq(solicitacaoLogistica.rotaId, rotaId)))
        .orderBy(asc(solicitacaoLogistica.ordemNaRota));

      return { ...rota, encarregado: enc?.nome ?? null, paradas };
    });
  }

  // --- internos ---------------------------------------------------------------

  private async incluir(
    tx: Transacao,
    rotaId: string,
    encarregadoId: string,
    encarregadoNome: string,
    solicitacaoIds: string[],
    primeiraOrdem: number,
  ): Promise<void> {
    const ctx = exigirContexto();
    if (solicitacaoIds.length === 0) return;

    const [ultima] = await tx
      .select({ n: sql<number>`coalesce(max(${solicitacaoLogistica.ordemNaRota}), 0)::int` })
      .from(solicitacaoLogistica)
      .where(and(eq(solicitacaoLogistica.tenantId, ctx.tenantId), eq(solicitacaoLogistica.rotaId, rotaId)));
    let ordem = Math.max(primeiraOrdem, (ultima?.n ?? 0) + 1);

    for (const id of solicitacaoIds) {
      const [s] = await tx
        .select({
          id: solicitacaoLogistica.id,
          identificador: solicitacaoLogistica.identificador,
          status: solicitacaoLogistica.status,
          encarregadoId: solicitacaoLogistica.encarregadoId,
          rotaId: solicitacaoLogistica.rotaId,
          aceitaEm: solicitacaoLogistica.aceitaEm,
        })
        .from(solicitacaoLogistica)
        .where(and(eq(solicitacaoLogistica.tenantId, ctx.tenantId), eq(solicitacaoLogistica.id, id)))
        .limit(1);
      if (!s) throw new NotFoundException(`Solicitação ${id} não encontrada.`);
      if (!STATUS_LOGISTICO_ABERTO.includes(s.status)) {
        throw new BadRequestException(`${s.identificador} está encerrada e não entra em rota.`);
      }
      if (s.rotaId && s.rotaId !== rotaId) {
        throw new BadRequestException(`${s.identificador} já está em outra rota.`);
      }
      if (s.encarregadoId && s.encarregadoId !== encarregadoId) {
        throw new BadRequestException(
          `${s.identificador} está com outro encarregado. Reatribua antes de incluir na rota.`,
        );
      }

      const agora = new Date();
      const viraAceita = !s.encarregadoId && STATUS_PARADA_PLANEJADA.includes(s.status);

      await tx
        .update(solicitacaoLogistica)
        .set({
          rotaId,
          ordemNaRota: ordem,
          encarregadoId,
          aceitaEm: s.aceitaEm ?? (viraAceita ? agora : null),
          status: viraAceita ? 'aceita' : s.status,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, id));

      if (!s.encarregadoId) {
        await tx
          .update(ofertaServico)
          .set({ status: 'encerrada', respondidaEm: agora })
          .where(
            and(
              eq(ofertaServico.tenantId, ctx.tenantId),
              eq(ofertaServico.solicitacaoId, id),
              eq(ofertaServico.status, 'enviada'),
            ),
          );
      }

      await this.registrar(tx, id, {
        tipo: 'incluida_em_rota',
        statusAnterior: s.status,
        statusNovo: viraAceita ? 'aceita' : s.status,
        visivelPortal: viraAceita,
        descricao: `Incluída na rota de ${encarregadoNome} (parada ${ordem}).`,
        detalhe: { rotaId, ordem, atribuidaPelaRota: !s.encarregadoId },
      });
      ordem += 1;
    }
  }

  private exigirDono(rota: { encarregadoId: string }): void {
    const ctx = exigirContexto();
    if (rota.encarregadoId === ctx.usuarioId) return;
    if (ctx.permissoes.has(PERMISSOES.LOGISTICA_ATRIBUIR)) return;
    throw new ForbiddenException('Esta rota é de outro encarregado.');
  }

  private async buscar(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(rotaLogistica)
      .where(and(eq(rotaLogistica.tenantId, ctx.tenantId), eq(rotaLogistica.id, id)))
      .limit(1);
    if (!linha) throw new NotFoundException('Rota não encontrada.');
    return linha;
  }

  private async registrar(
    tx: Transacao,
    solicitacaoId: string,
    dados: {
      tipo: string;
      statusAnterior?: StatusSolicitacaoLogistica;
      statusNovo?: StatusSolicitacaoLogistica;
      visivelPortal?: boolean;
      descricao?: string;
      detalhe?: Record<string, unknown>;
    },
  ): Promise<void> {
    const ctx = exigirContexto();
    await tx.insert(movimentacaoLogistica).values({
      tenantId: ctx.tenantId,
      solicitacaoId,
      tipo: dados.tipo,
      statusAnterior: dados.statusAnterior ?? null,
      statusNovo: dados.statusNovo ?? null,
      visivelPortal: dados.visivelPortal ?? false,
      descricao: dados.descricao ?? null,
      detalhe: dados.detalhe ?? {},
      responsavelId: ctx.usuarioId,
    });
  }
}
