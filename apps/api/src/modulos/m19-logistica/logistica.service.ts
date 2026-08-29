import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  cliente,
  movimentacaoLogistica,
  ofertaServico,
  solicitacaoLogistica,
  usuario,
  type Transacao,
} from '@lapato/db';
import {
  MINUTOS_VALIDADE_OFERTA,
  MODULOS,
  STATUS_LOGISTICO_ABERTO,
  statusExternoDe,
  type CanalOrigemLogistico,
  type ConservacaoLogistica,
  type PrioridadeLogistica,
  type RequisitoEspecialLogistico,
  type StatusSolicitacaoLogistica,
  type TipoOperacaoLogistica,
  type TipoServicoLogistico,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface NovaSolicitacaoLogistica {
  tipoServico: TipoServicoLogistico;
  tipoOperacao: TipoOperacaoLogistica;
  canalOrigem: CanalOrigemLogistico;
  clienteId: string;
  unidadeId?: string | null;
  casoId?: string | null;
  endereco: string;
  pontoReferencia?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  contatoNoLocal?: string | null;
  telefoneContato?: string | null;
  dataDesejada?: string | null;
  janelaInicio?: string | null;
  janelaFim?: string | null;
  volumesEstimados?: number | null;
  tipoMaterial?: string | null;
  conservacao?: ConservacaoLogistica | null;
  requisitosEspeciais?: RequisitoEspecialLogistico[];
  prioridade?: PrioridadeLogistica;
  observacoes?: string | null;
  valorCentavos?: number | null;
}

/**
 * M19 - Logistica.
 *
 * Esta fatia cobre o caminho ate o servico ter dono: a solicitacao nasce, e
 * ofertada a varios encarregados ao mesmo tempo, e o primeiro que aceitar leva.
 *
 * Execucao com evidencias, rota e entrega vem nas fatias seguintes; o que fica
 * pronto aqui e a parte que o documento trata como estruturante - a secao 132
 * abre com "toda solicitacao logistica devera possuir numero unico" e "o aceite
 * devera ser registrado".
 */
@Injectable()
export class LogisticaService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
  ) {}

  /**
   * Abre a solicitacao (secoes 12 a 24).
   *
   * O canal de origem entra como dado, e nao como tabela separada: a secao 4
   * exige que o pedido vindo de telefone, WhatsApp ou Portal vire "um unico
   * registro operacional no LAPATO".
   */
  async criar(dados: NovaSolicitacaoLogistica): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [alvo] = await tx
        .select({ id: cliente.id })
        .from(cliente)
        .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, dados.clienteId)))
        .limit(1);
      if (!alvo) throw new NotFoundException('Cliente não encontrado.');

      const agora = new Date();
      const identificador = await this.numeracao.proximaColeta(tx, agora.getFullYear());

      const [nova] = await tx
        .insert(solicitacaoLogistica)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          tipoServico: dados.tipoServico,
          tipoOperacao: dados.tipoOperacao,
          canalOrigem: dados.canalOrigem,
          clienteId: dados.clienteId,
          unidadeId: dados.unidadeId ?? null,
          casoId: dados.casoId ?? null,
          endereco: dados.endereco.trim(),
          pontoReferencia: dados.pontoReferencia ?? null,
          latitude: dados.latitude ?? null,
          longitude: dados.longitude ?? null,
          contatoNoLocal: dados.contatoNoLocal ?? null,
          telefoneContato: dados.telefoneContato ?? null,
          dataDesejada: dados.dataDesejada ? new Date(dados.dataDesejada) : null,
          janelaInicio: dados.janelaInicio ?? null,
          janelaFim: dados.janelaFim ?? null,
          volumesEstimados: dados.volumesEstimados ?? null,
          tipoMaterial: dados.tipoMaterial ?? null,
          conservacao: dados.conservacao ?? null,
          requisitosEspeciais: dados.requisitosEspeciais ?? [],
          prioridade: dados.prioridade ?? 'rotina',
          observacoes: dados.observacoes ?? null,
          valorCentavos: dados.valorCentavos ?? null,
          status: 'recebida',
          criadaPorId: ctx.usuarioId,
        })
        .returning({ id: solicitacaoLogistica.id });

      await this.registrar(tx, nova!.id, {
        tipo: 'criada',
        statusNovo: 'recebida',
        visivelPortal: true,
        descricao: `Solicitação ${identificador} registrada por ${dados.canalOrigem}.`,
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.solicitacao_criada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: dados.casoId ?? null,
        objetoTipo: 'solicitacao_logistica',
        objetoId: nova!.id,
        visibilidade: 'externo',
        payload: { identificador, tipoServico: dados.tipoServico, canal: dados.canalOrigem },
      });

      return { id: nova!.id, identificador };
    });
  }

  /**
   * Oferta o servico a varios encarregados de uma vez (secoes 140 a 143).
   *
   * O documento chama de "oferta", e nao de atribuicao, por um motivo: a secao
   * 144 diz que "o primeiro usuario elegivel que concluir ACEITAR SERVICO
   * assumira automaticamente a solicitacao". Quem envia escolhe os candidatos;
   * quem decide e quem esta com o celular na mao.
   *
   * A mensagem em si sai pelo M26 (secao 141) - aqui o que se publica e o
   * evento. Manter o envio dentro deste modulo criaria o "sistema proprio de
   * notificacoes" que a secao 131 proibe.
   */
  async ofertar(
    solicitacaoId: string,
    encarregadoIds: string[],
    minutosValidade = MINUTOS_VALIDADE_OFERTA,
  ): Promise<{ ofertas: number; novas: number; renovadas: number; expiraEm: string }> {
    const ctx = exigirContexto();

    if (encarregadoIds.length === 0) {
      throw new BadRequestException('Escolha ao menos um encarregado para receber a oferta.');
    }

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);

      if (atual.encarregadoId) {
        throw new BadRequestException(
          `Esta solicitação já foi assumida. Para trocar o responsável, use a reatribuição.`,
        );
      }
      if (!STATUS_LOGISTICO_ABERTO.includes(atual.status)) {
        throw new BadRequestException(
          'Solicitação encerrada não recebe oferta. Reagende para criar uma nova tentativa.',
        );
      }

      const elegiveis = await tx
        .select({ id: usuario.id })
        .from(usuario)
        .where(
          and(
            eq(usuario.tenantId, ctx.tenantId),
            inArray(usuario.id, encarregadoIds),
            eq(usuario.status, 'ativo'),
          ),
        );

      if (elegiveis.length !== encarregadoIds.length) {
        throw new BadRequestException('Encarregado inexistente ou inativo na lista.');
      }

      const expiraEm = new Date(Date.now() + minutosValidade * 60_000);
      const escolhidos = elegiveis.map((e) => e.id);

      /**
       * `onConflictDoNothing` na chave (solicitacao, encarregado): reenviar a
       * oferta para quem ja a tem nao pode criar uma segunda linha concorrendo
       * pelo mesmo aceite. Clicar duas vezes em ENVIAR OFERTA e comum.
       */
      const criadas = await tx
        .insert(ofertaServico)
        .values(
          escolhidos.map((id) => ({
            tenantId: ctx.tenantId,
            solicitacaoId,
            encarregadoId: id,
            status: 'enviada' as const,
            expiraEm,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: ofertaServico.id });

      /**
       * Reenviar RENOVA o prazo de quem ja tinha a oferta.
       *
       * Sem isto, apertar ENVIAR OFERTA de novo - que e o que a central faz
       * quando ninguem responde - nao produziria efeito nenhum sobre as ofertas
       * prestes a vencer: elas expirariam do mesmo jeito, e o operador ficaria
       * olhando um botao que parece funcionar e nao funciona.
       */
      const renovadas = await tx
        .update(ofertaServico)
        .set({ expiraEm })
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            inArray(ofertaServico.encarregadoId, escolhidos),
            eq(ofertaServico.status, 'enviada'),
            // As recem-criadas ja nascem com o prazo certo.
            ...(criadas.length > 0 ? [notInArray(ofertaServico.id, criadas.map((c) => c.id))] : []),
          ),
        )
        .returning({ id: ofertaServico.id });

      await tx
        .update(solicitacaoLogistica)
        .set({ status: 'aguardando_aceite', atualizadoEm: new Date() })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      /**
       * A descricao diz o que REALMENTE aconteceu, e nao quantos nomes foram
       * marcados na tela. Um reenvio que so renovou prazos registrado como
       * "ofertado a 2 encarregados" faria a timeline contar a mesma oferta duas
       * vezes - e a timeline e o que sustenta a auditoria da secao 113.
       */
      const descricao =
        criadas.length > 0
          ? `Serviço ofertado a ${criadas.length} encarregado(s).` +
            (renovadas.length > 0 ? ` Prazo renovado para outros ${renovadas.length}.` : '')
          : `Prazo da oferta renovado para ${renovadas.length} encarregado(s).`;

      await this.registrar(tx, solicitacaoId, {
        tipo: criadas.length > 0 ? 'oferta_enviada' : 'oferta_renovada',
        statusAnterior: atual.status,
        statusNovo: 'aguardando_aceite',
        visivelPortal: criadas.length > 0,
        descricao,
        detalhe: {
          novas: criadas.length,
          renovadas: renovadas.length,
          expiraEm: expiraEm.toISOString(),
        },
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.oferta_enviada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: 'solicitacao_logistica',
        objetoId: solicitacaoId,
        visibilidade: 'interno',
        payload: {
          identificador: atual.identificador,
          encarregadoIds: elegiveis.map((e) => e.id),
          expiraEm: expiraEm.toISOString(),
        },
      });

      return {
        ofertas: escolhidos.length,
        novas: criadas.length,
        renovadas: renovadas.length,
        expiraEm: expiraEm.toISOString(),
      };
    });
  }

  /**
   * O aceite competitivo (secoes 144 e 145).
   *
   * "A operacao devera ser transacional para impedir aceite simultaneo por dois
   * encarregados."
   *
   * A garantia nao vem de ler-e-depois-escrever, que abriria a janela classica
   * entre a leitura e o UPDATE: vem de um unico UPDATE condicionado a
   * `encarregado_id IS NULL`. Dois encarregados clicando no mesmo segundo
   * disputam a mesma linha; o Postgres serializa, o primeiro preenche a coluna e
   * o segundo nao encontra mais nenhuma linha para atualizar. Quem perde recebe
   * a mensagem da secao 145 - "solicitacao ja assumida por outro encarregado" -
   * em vez de um erro tecnico.
   */
  async aceitar(solicitacaoId: string): Promise<{ identificador: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [oferta] = await tx
        .select({ id: ofertaServico.id, status: ofertaServico.status, expiraEm: ofertaServico.expiraEm })
        .from(ofertaServico)
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            eq(ofertaServico.encarregadoId, ctx.usuarioId),
          ),
        )
        .limit(1);

      if (!oferta) {
        throw new NotFoundException('Este serviço não foi ofertado a você.');
      }
      if (oferta.status === 'encerrada' || oferta.status === 'aceita') {
        throw new BadRequestException('Solicitação já assumida por outro encarregado.');
      }
      if (oferta.expiraEm && oferta.expiraEm < new Date()) {
        throw new BadRequestException(
          'A oferta expirou e voltou para a fila. Fale com a central se ainda puder atender.',
        );
      }

      const agora = new Date();

      const assumidas = await tx
        .update(solicitacaoLogistica)
        .set({
          encarregadoId: ctx.usuarioId,
          status: 'aceita',
          aceitaEm: agora,
          atualizadoEm: agora,
        })
        .where(
          and(
            eq(solicitacaoLogistica.id, solicitacaoId),
            eq(solicitacaoLogistica.tenantId, ctx.tenantId),
            // A condicao que decide a corrida.
            isNull(solicitacaoLogistica.encarregadoId),
          ),
        )
        .returning({
          identificador: solicitacaoLogistica.identificador,
          casoId: solicitacaoLogistica.casoId,
        });

      const assumida = assumidas[0];
      if (!assumida) {
        throw new BadRequestException('Solicitação já assumida por outro encarregado.');
      }

      await tx
        .update(ofertaServico)
        .set({ status: 'aceita', respondidaEm: agora })
        .where(eq(ofertaServico.id, oferta.id));

      /**
       * Secao 145: as demais ofertas sao encerradas na hora. Quem abrir o link
       * depois ve "ja assumida" em vez de um botao que falharia no clique.
       */
      await tx
        .update(ofertaServico)
        .set({ status: 'encerrada', respondidaEm: agora })
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            ne(ofertaServico.id, oferta.id),
            eq(ofertaServico.status, 'enviada'),
          ),
        );

      await this.registrar(tx, solicitacaoId, {
        tipo: 'aceita',
        statusAnterior: 'aguardando_aceite',
        statusNovo: 'aceita',
        visivelPortal: true,
        descricao: `Serviço assumido por ${ctx.nomeCompleto}.`,
      });

      await this.auditoria.registrar(tx, {
        entidade: 'solicitacao_logistica',
        entidadeId: solicitacaoId,
        acao: 'aceitar',
        valorNovo: { encarregadoId: ctx.usuarioId, aceitaEm: agora.toISOString() },
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.servico_aceito',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: assumida.casoId,
        objetoTipo: 'solicitacao_logistica',
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: { identificador: assumida.identificador, encarregadoId: ctx.usuarioId },
      });

      return { identificador: assumida.identificador };
    });
  }

  /**
   * Recusa (secao 147).
   *
   * "Sem impedir que os demais encarregados aceitem" - por isso a recusa mexe
   * apenas na linha de quem recusou, e nunca no status da solicitacao.
   */
  async recusar(solicitacaoId: string, motivo?: string): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const recusadas = await tx
        .update(ofertaServico)
        .set({ status: 'recusada', respondidaEm: new Date(), motivoRecusa: motivo ?? null })
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            eq(ofertaServico.encarregadoId, ctx.usuarioId),
            eq(ofertaServico.status, 'enviada'),
          ),
        )
        .returning({ id: ofertaServico.id });

      if (recusadas.length === 0) {
        throw new BadRequestException('Não há oferta aberta sua para este serviço.');
      }

      await this.registrar(tx, solicitacaoId, {
        tipo: 'oferta_recusada',
        descricao: `${ctx.nomeCompleto} não pôde atender.`,
        detalhe: motivo ? { motivo } : {},
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.oferta_recusada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        objetoTipo: 'solicitacao_logistica',
        objetoId: solicitacaoId,
        visibilidade: 'interno',
        payload: { encarregadoId: ctx.usuarioId, motivo: motivo ?? null },
      });
    });
  }

  /** Secao 86: cancelar registra quem pediu, o motivo, a data e o horario. */
  async cancelar(solicitacaoId: string, motivo: string): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);

      if (!STATUS_LOGISTICO_ABERTO.includes(atual.status)) {
        throw new BadRequestException('Esta solicitação já está encerrada.');
      }

      const agora = new Date();

      await tx
        .update(solicitacaoLogistica)
        .set({
          status: 'cancelada',
          canceladaEm: agora,
          canceladaPorId: ctx.usuarioId,
          motivoCancelamento: motivo,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      // Ofertas em aberto morrem junto: nao faz sentido alguem aceitar um
      // servico cancelado e sair para a rua.
      await tx
        .update(ofertaServico)
        .set({ status: 'encerrada', respondidaEm: agora })
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            eq(ofertaServico.status, 'enviada'),
          ),
        );

      await this.registrar(tx, solicitacaoId, {
        tipo: 'cancelada',
        statusAnterior: atual.status,
        statusNovo: 'cancelada',
        visivelPortal: true,
        descricao: motivo,
      });

      await this.auditoria.registrar(tx, {
        entidade: 'solicitacao_logistica',
        entidadeId: solicitacaoId,
        acao: 'cancelar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'cancelada' },
        justificativa: motivo,
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.solicitacao_cancelada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: 'solicitacao_logistica',
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: { identificador: atual.identificador, motivo },
      });
    });
  }

  /** A fila logistica (secoes 28 e 29). */
  async listar(filtros: {
    status?: StatusSolicitacaoLogistica;
    apenasAbertas?: boolean;
    minhasOfertas?: boolean;
  }): Promise<unknown[]> {
    const ctx = exigirContexto();
    const encarregado = aliasedTable(usuario, 'encarregado');

    return this.db.executar(async (tx) => {
      const condicoes = [eq(solicitacaoLogistica.tenantId, ctx.tenantId)];
      if (filtros.status) condicoes.push(eq(solicitacaoLogistica.status, filtros.status));
      if (filtros.apenasAbertas) {
        condicoes.push(inArray(solicitacaoLogistica.status, STATUS_LOGISTICO_ABERTO));
      }

      const linhas = await tx
        .select({
          id: solicitacaoLogistica.id,
          identificador: solicitacaoLogistica.identificador,
          tipoServico: solicitacaoLogistica.tipoServico,
          tipoOperacao: solicitacaoLogistica.tipoOperacao,
          canalOrigem: solicitacaoLogistica.canalOrigem,
          cliente: cliente.nomeFantasia,
          endereco: solicitacaoLogistica.endereco,
          contatoNoLocal: solicitacaoLogistica.contatoNoLocal,
          telefoneContato: solicitacaoLogistica.telefoneContato,
          dataDesejada: solicitacaoLogistica.dataDesejada,
          janelaInicio: solicitacaoLogistica.janelaInicio,
          janelaFim: solicitacaoLogistica.janelaFim,
          prioridade: solicitacaoLogistica.prioridade,
          tipoMaterial: solicitacaoLogistica.tipoMaterial,
          conservacao: solicitacaoLogistica.conservacao,
          requisitosEspeciais: solicitacaoLogistica.requisitosEspeciais,
          volumesEstimados: solicitacaoLogistica.volumesEstimados,
          valorCentavos: solicitacaoLogistica.valorCentavos,
          status: solicitacaoLogistica.status,
          encarregado: encarregado.nomeCompleto,
          encarregadoId: solicitacaoLogistica.encarregadoId,
          criadaEm: solicitacaoLogistica.criadoEm,
          /**
           * A correlacao escreve `solicitacao_logistica.id` por extenso de
           * proposito. Numa subconsulta de tabela unica o Drizzle emite a coluna
           * externa sem qualificar, e ela passa a resolver no escopo INTERNO -
           * a condicao vira `o.solicitacao_id = o.id`, que nao da erro e devolve
           * zero em silencio. Mesmo cuidado do M18.
           */
          ofertasAbertas: sql<number>`(
            select count(*)::int from ${ofertaServico} o
            where o.solicitacao_id = solicitacao_logistica.id
              and o.tenant_id = solicitacao_logistica.tenant_id
              and o.status = 'enviada'
          )`,
        })
        .from(solicitacaoLogistica)
        .innerJoin(cliente, eq(cliente.id, solicitacaoLogistica.clienteId))
        .leftJoin(encarregado, eq(encarregado.id, solicitacaoLogistica.encarregadoId))
        .where(and(...condicoes))
        .orderBy(desc(solicitacaoLogistica.criadoEm))
        .limit(200);

      if (!filtros.minhasOfertas) return linhas;

      /**
       * A caixa do encarregado: so o que foi ofertado a ELE e ainda esta aberto,
       * mais o que ele ja assumiu. Filtrado depois da consulta principal para
       * nao duplicar a montagem da linha - o volume aqui e de uma jornada de
       * trabalho, nao de um ano de historico.
       */
      const minhas = await tx
        .select({ solicitacaoId: ofertaServico.solicitacaoId })
        .from(ofertaServico)
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.encarregadoId, ctx.usuarioId),
            eq(ofertaServico.status, 'enviada'),
          ),
        );

      const ofertadas = new Set(minhas.map((m) => m.solicitacaoId));
      return linhas.filter(
        (l) => ofertadas.has(l.id) || l.encarregadoId === ctx.usuarioId,
      );
    });
  }

  /** A ficha completa, com a timeline da secao 88. */
  async ficha(solicitacaoId: string) {
    const ctx = exigirContexto();
    const encarregado = aliasedTable(usuario, 'encarregado');

    return this.db.executar(async (tx) => {
      const [cabecalho] = await tx
        .select({
          id: solicitacaoLogistica.id,
          identificador: solicitacaoLogistica.identificador,
          tipoServico: solicitacaoLogistica.tipoServico,
          tipoOperacao: solicitacaoLogistica.tipoOperacao,
          canalOrigem: solicitacaoLogistica.canalOrigem,
          clienteId: solicitacaoLogistica.clienteId,
          cliente: cliente.nomeFantasia,
          casoId: solicitacaoLogistica.casoId,
          endereco: solicitacaoLogistica.endereco,
          pontoReferencia: solicitacaoLogistica.pontoReferencia,
          contatoNoLocal: solicitacaoLogistica.contatoNoLocal,
          telefoneContato: solicitacaoLogistica.telefoneContato,
          dataDesejada: solicitacaoLogistica.dataDesejada,
          janelaInicio: solicitacaoLogistica.janelaInicio,
          janelaFim: solicitacaoLogistica.janelaFim,
          volumesEstimados: solicitacaoLogistica.volumesEstimados,
          tipoMaterial: solicitacaoLogistica.tipoMaterial,
          conservacao: solicitacaoLogistica.conservacao,
          requisitosEspeciais: solicitacaoLogistica.requisitosEspeciais,
          prioridade: solicitacaoLogistica.prioridade,
          observacoes: solicitacaoLogistica.observacoes,
          valorCentavos: solicitacaoLogistica.valorCentavos,
          status: solicitacaoLogistica.status,
          encarregadoId: solicitacaoLogistica.encarregadoId,
          encarregado: encarregado.nomeCompleto,
          aceitaEm: solicitacaoLogistica.aceitaEm,
          motivoCancelamento: solicitacaoLogistica.motivoCancelamento,
          criadaEm: solicitacaoLogistica.criadoEm,
        })
        .from(solicitacaoLogistica)
        .innerJoin(cliente, eq(cliente.id, solicitacaoLogistica.clienteId))
        .leftJoin(encarregado, eq(encarregado.id, solicitacaoLogistica.encarregadoId))
        .where(
          and(
            eq(solicitacaoLogistica.tenantId, ctx.tenantId),
            eq(solicitacaoLogistica.id, solicitacaoId),
          ),
        )
        .limit(1);

      if (!cabecalho) throw new NotFoundException('Solicitação logística não encontrada.');

      const convidado = aliasedTable(usuario, 'convidado');
      const ofertas = await tx
        .select({
          id: ofertaServico.id,
          encarregadoId: ofertaServico.encarregadoId,
          encarregado: convidado.nomeCompleto,
          status: ofertaServico.status,
          enviadaEm: ofertaServico.enviadaEm,
          expiraEm: ofertaServico.expiraEm,
          respondidaEm: ofertaServico.respondidaEm,
          motivoRecusa: ofertaServico.motivoRecusa,
        })
        .from(ofertaServico)
        .innerJoin(convidado, eq(convidado.id, ofertaServico.encarregadoId))
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
          ),
        )
        .orderBy(asc(ofertaServico.enviadaEm));

      const autor = aliasedTable(usuario, 'autor');
      const timeline = await tx
        .select({
          tipo: movimentacaoLogistica.tipo,
          statusAnterior: movimentacaoLogistica.statusAnterior,
          statusNovo: movimentacaoLogistica.statusNovo,
          descricao: movimentacaoLogistica.descricao,
          detalhe: movimentacaoLogistica.detalhe,
          visivelPortal: movimentacaoLogistica.visivelPortal,
          ocorridoEm: movimentacaoLogistica.ocorridoEm,
          responsavel: autor.nomeCompleto,
        })
        .from(movimentacaoLogistica)
        .leftJoin(autor, eq(autor.id, movimentacaoLogistica.responsavelId))
        .where(
          and(
            eq(movimentacaoLogistica.tenantId, ctx.tenantId),
            eq(movimentacaoLogistica.solicitacaoId, solicitacaoId),
          ),
        )
        .orderBy(asc(movimentacaoLogistica.ocorridoEm));

      return {
        ...cabecalho,
        /** Secao 27: a traducao para o cliente sai daqui, nunca do Portal. */
        statusExterno: statusExternoDe(cabecalho.status),
        ofertas,
        timeline,
      };
    });
  }

  // --- internos --------------------------------------------------------------

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

  private async buscar(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(solicitacaoLogistica)
      .where(
        and(eq(solicitacaoLogistica.tenantId, ctx.tenantId), eq(solicitacaoLogistica.id, id)),
      )
      .limit(1);
    if (!linha) throw new NotFoundException('Solicitação logística não encontrada.');
    return linha;
  }
}
