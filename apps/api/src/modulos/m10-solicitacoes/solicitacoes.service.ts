import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  caso,
  mensagemSolicitacao,
  paciente,
  pendencia,
  solicitacao,
  usuario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  type Etapa,
  type NivelBloqueio,
  type Prioridade,
  type StatusPendencia,
  type StatusSolicitacao,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface NovaSolicitacao {
  casoId?: string;
  tipo: string;
  categoria?: string;
  descricao: string;
  justificativa?: string;
  prioridade?: Prioridade;
  objetoTipo?: string;
  objetoId?: string;
  setorResponsavel?: string;
  prazoEm?: Date;
  exigeAprovacao?: boolean;
}

export interface NovaPendencia {
  casoId: string;
  solicitacaoId?: string;
  tipo: string;
  descricao: string;
  status?: StatusPendencia;
  nivelBloqueio?: NivelBloqueio;
  etapaBloqueada?: Etapa;
  suspendePrazo?: boolean;
  setorResponsavel?: string;
  visivelPortal?: boolean;
}

/** Subabas da tela principal (M10 secao 51). */
export type AbaSolicitacoes = 'abertas' | 'minhas' | 'vencidas' | 'concluidas' | 'todas';

const STATUS_ABERTOS: StatusSolicitacao[] = [
  'criada',
  'aguardando_analise',
  'aprovada',
  'aguardando_execucao',
  'em_execucao',
  'aguardando_informacao',
  'parcialmente_concluida',
];

const PENDENCIA_ABERTA: StatusPendencia[] = [
  'aberta',
  'aguardando_acao_interna',
  'aguardando_cliente',
  'aguardando_veterinario',
  'aguardando_patologista',
  'aguardando_autorizacao',
  'aguardando_execucao_tecnica',
  'respondida',
  'em_validacao',
];

/**
 * M10 - Solicitacoes e Pendencias.
 *
 * Principio do modulo (secao 1): toda acao necessaria para o caso avancar tem
 * responsavel, status, prazo, origem e historico identificaveis - em lugar de
 * mensagens, planilhas e comentarios soltos (secao 50).
 *
 * Papel arquitetural (secao 3): este modulo e dono da DEMANDA, nunca da
 * execucao. O patologista pede o PAS aqui; quem executa e o modulo tecnico, e a
 * conclusao volta como "execucao concluida". Pela mesma razao, o impacto de uma
 * pendencia no fluxo (secoes 21-22) e apenas INFORMADO ao M07 - bloqueio e
 * suspensao de prazo sao decisao e escrita do motor de fluxo, nao daqui.
 */
@Injectable()
export class SolicitacoesService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
    private readonly fluxo: FluxoService,
  ) {}

  // --- solicitacoes ---------------------------------------------------------

  async criar(dados: NovaSolicitacao): Promise<{ id: string; identificador: string }> {
    return this.db.executar((tx) => this.criarEmTransacao(tx, dados));
  }

  /**
   * Variante para quem ja esta numa transacao (o recorte do M08 reabre a
   * macroscopia, registra a solicitacao e lanca o retrabalho na OS como um
   * unico ato - metade disso gravada seria pior que nada).
   */
  async criarEmTransacao(
    tx: Transacao,
    dados: NovaSolicitacao,
  ): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    {
      const identificador = await this.numeracao.proximaSolicitacao(
        tx,
        new Date().getFullYear(),
      );

      /**
       * Secao 11: quem exige aprovacao previa (IHQ de alto custo, secao 29)
       * nasce aguardando analise; o resto ja cai na fila de execucao. "Criada"
       * como estado de repouso nao existe na pratica - criada sem proximo passo
       * e exatamente a demanda esquecida que o modulo quer eliminar.
       */
      const status: StatusSolicitacao = dados.exigeAprovacao
        ? 'aguardando_analise'
        : 'aguardando_execucao';

      const [nova] = await tx
        .insert(solicitacao)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          casoId: dados.casoId ?? null,
          tipo: dados.tipo,
          categoria: dados.categoria ?? null,
          origem: 'interna',
          descricao: dados.descricao,
          justificativa: dados.justificativa ?? null,
          prioridade: dados.prioridade ?? 'rotina',
          status,
          objetoTipo: dados.objetoTipo ?? null,
          objetoId: dados.objetoId ?? null,
          solicitantePorId: ctx.usuarioId,
          setorResponsavel: dados.setorResponsavel ?? null,
          prazoEm: dados.prazoEm ?? null,
          exigeAprovacao: dados.exigeAprovacao ?? false,
        })
        .returning({ id: solicitacao.id });

      await this.eventos.publicar(tx, {
        tipo: 'solicitacao.criada',
        casoId: dados.casoId ?? null,
        moduloOrigem: MODULOS.M10_SOLICITACOES,
        objetoTipo: 'solicitacao',
        objetoId: nova!.id,
        payload: { identificador, tipo: dados.tipo, prioridade: dados.prioridade ?? 'rotina' },
      });

      return { id: nova!.id, identificador };
    }
  }

  /**
   * Analise da solicitacao que exige aprovacao (secao 29).
   *
   * A recusa exige motivo - mesma logica do retorno de revisao do laudo: sem
   * ele, quem pediu fica adivinhando por que nao vai acontecer.
   */
  async analisar(id: string, resultado: 'aprovada' | 'recusada', motivo?: string): Promise<void> {
    const ctx = exigirContexto();

    if (resultado === 'recusada' && !motivo?.trim()) {
      throw new BadRequestException('Recusar uma solicitação exige o motivo.');
    }

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);

      if (atual.status !== 'aguardando_analise') {
        throw new BadRequestException(
          `Esta solicitação não está aguardando análise (status atual: ${atual.status}).`,
        );
      }

      await tx
        .update(solicitacao)
        .set(
          resultado === 'aprovada'
            ? {
                status: 'aguardando_execucao',
                aprovadaPorId: ctx.usuarioId,
                aprovadaEm: new Date(),
                atualizadoEm: new Date(),
              }
            : { status: 'recusada', motivoRecusa: motivo!.trim(), atualizadoEm: new Date() },
        )
        .where(eq(solicitacao.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'solicitacao',
        entidadeId: id,
        acao: resultado === 'aprovada' ? 'aprovar' : 'recusar',
        casoId: atual.casoId ?? undefined,
        justificativa: motivo?.trim(),
        valorAnterior: { status: atual.status },
        valorNovo: { status: resultado === 'aprovada' ? 'aguardando_execucao' : 'recusada' },
      });
    });
  }

  /**
   * Execucao concluida (secao 3): o modulo tecnico devolve o resultado.
   *
   * Secao 82 do M10 ecoa o laudo: aqui entra o RESULTADO TECNICO ("PAS
   * realizado, laminas A2-N1/N2 disponiveis"), nunca a interpretacao - essa
   * pertence ao modulo diagnostico.
   */
  async concluir(id: string, resultadoTecnico?: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);

      if (!STATUS_ABERTOS.includes(atual.status)) {
        throw new BadRequestException(
          `Esta solicitação não está aberta (status atual: ${atual.status}).`,
        );
      }
      if (atual.status === 'aguardando_analise') {
        throw new BadRequestException(
          'Esta solicitação ainda aguarda aprovação - conclua a análise antes da execução.',
        );
      }

      await tx
        .update(solicitacao)
        .set({
          status: 'concluida',
          concluidaEm: new Date(),
          concluidaPorId: ctx.usuarioId,
          resultadoTecnico: resultadoTecnico?.trim() || null,
          atualizadoEm: new Date(),
        })
        .where(eq(solicitacao.id, id));

      await this.eventos.publicar(tx, {
        tipo: 'solicitacao.concluida',
        casoId: atual.casoId,
        moduloOrigem: MODULOS.M10_SOLICITACOES,
        objetoTipo: 'solicitacao',
        objetoId: id,
        payload: { identificador: atual.identificador, tipo: atual.tipo },
      });

      /**
       * Secao 93 - resolucao automatica: a pendencia "aguardando PAS" morre
       * junto com a conclusao da execucao, sem alguem lembrar de fecha-la.
       * Pendencias que exigem validacao humana (secao 94) nao entram aqui
       * porque nao nascem vinculadas a uma solicitacao executavel.
       */
      const vinculadas = await tx
        .select({ id: pendencia.id, casoId: pendencia.casoId })
        .from(pendencia)
        .where(
          and(
            eq(pendencia.tenantId, ctx.tenantId),
            eq(pendencia.solicitacaoId, id),
            inArray(pendencia.status, PENDENCIA_ABERTA),
          ),
        );

      for (const p of vinculadas) {
        await this.encerrarPendencia(tx, p.id, p.casoId, 'Execução da solicitação concluída.');
      }
    });
  }

  async cancelar(id: string, motivo: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);

      /**
       * Secao 108: historico imutavel. Concluida nao se cancela - o que ja foi
       * executado aconteceu; arrependimento vira nova solicitacao ou correcao,
       * nunca apagamento.
       */
      if (!STATUS_ABERTOS.includes(atual.status)) {
        throw new BadRequestException(
          `Esta solicitação não está aberta (status atual: ${atual.status}).`,
        );
      }

      await tx
        .update(solicitacao)
        .set({
          status: 'cancelada',
          canceladaEm: new Date(),
          motivoCancelamento: motivo.trim(),
          atualizadoEm: new Date(),
        })
        .where(eq(solicitacao.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'solicitacao',
        entidadeId: id,
        acao: 'cancelar',
        casoId: atual.casoId ?? undefined,
        justificativa: motivo.trim(),
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'cancelada' },
      });
    });
  }

  // --- pendencias -----------------------------------------------------------

  /**
   * Cria a pendencia e INFORMA o impacto ao M07 (secoes 21-22): bloqueio
   * parcial/total (por etapa, quando houver) e suspensao de prazo. A decisao
   * sobre o estado global do caso e do motor de fluxo, nunca daqui.
   */
  async criarPendencia(dados: NovaPendencia): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const nivel = dados.nivelBloqueio ?? 'nao';

      const [nova] = await tx
        .insert(pendencia)
        .values({
          tenantId: ctx.tenantId,
          casoId: dados.casoId,
          solicitacaoId: dados.solicitacaoId ?? null,
          tipo: dados.tipo,
          descricao: dados.descricao,
          status: dados.status ?? 'aberta',
          nivelBloqueio: nivel,
          etapaBloqueada: dados.etapaBloqueada ?? null,
          suspendePrazo: dados.suspendePrazo ?? false,
          setorResponsavel: dados.setorResponsavel ?? null,
          visivelPortal: dados.visivelPortal ?? false,
          criadaPorId: ctx.usuarioId,
        })
        .returning({ id: pendencia.id });

      await this.eventos.publicar(tx, {
        tipo: 'pendencia.criada',
        casoId: dados.casoId,
        moduloOrigem: MODULOS.M10_SOLICITACOES,
        objetoTipo: 'pendencia',
        objetoId: nova!.id,
        // Secao 45: nem toda pendencia e visivel ao cliente.
        visibilidade: dados.visivelPortal ? 'externo' : 'interno',
        payload: { tipo: dados.tipo, nivelBloqueio: nivel },
      });

      if (nivel !== 'nao') {
        await this.fluxo.bloquear(tx, dados.casoId, {
          nivel,
          origem: MODULOS.M10_SOLICITACOES,
          origemId: nova!.id,
          motivo: dados.descricao,
          etapaBloqueada: dados.etapaBloqueada,
          condicaoLiberacao: 'Resolver a pendência.',
        });
      }

      if (dados.suspendePrazo) {
        await this.fluxo.suspenderPrazo(tx, dados.casoId, {
          motivo: dados.descricao,
          origem: MODULOS.M10_SOLICITACOES,
          origemId: nova!.id,
        });
      }

      return { id: nova!.id };
    });
  }

  /**
   * Resolucao manual (secao 94): alguem olhou, validou e encerrou. A resolucao
   * e obrigatoria porque e ela que conta, no historico, COMO a pendencia saiu
   * do caminho - "resolvida" sem desfecho descrito e quase tao opaco quanto a
   * pendencia esquecida.
   */
  async resolverPendencia(id: string, resolucao: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [atual] = await tx
        .select({ id: pendencia.id, casoId: pendencia.casoId, status: pendencia.status })
        .from(pendencia)
        .where(and(eq(pendencia.tenantId, ctx.tenantId), eq(pendencia.id, id)))
        .limit(1);

      if (!atual) throw new NotFoundException('Pendência não encontrada.');
      if (!PENDENCIA_ABERTA.includes(atual.status)) {
        throw new BadRequestException(
          `Esta pendência não está aberta (status atual: ${atual.status}).`,
        );
      }

      await this.encerrarPendencia(tx, id, atual.casoId, resolucao.trim());
    });
  }

  /** Encerramento comum as resolucoes manual (secao 94) e automatica (secao 93). */
  private async encerrarPendencia(
    tx: Transacao,
    id: string,
    casoId: string,
    resolucao: string,
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx
      .update(pendencia)
      .set({
        status: 'resolvida',
        resolvidaEm: new Date(),
        resolvidaPorId: ctx.usuarioId,
        resolucao,
        atualizadoEm: new Date(),
      })
      .where(and(eq(pendencia.tenantId, ctx.tenantId), eq(pendencia.id, id)));

    /**
     * O desbloqueio e idempotente por origem: se esta pendencia nao criou
     * bloqueio nem suspensao, as chamadas nao encontram nada para liberar.
     * Cobre tambem a pendencia da triagem bloqueada (M06), que nasce la mas
     * pertence a este modulo - resolver aqui destrava o caso la.
     */
    await this.fluxo.desbloquear(tx, casoId, id, `Pendência resolvida: ${resolucao}`);
    await this.fluxo.retomarPrazo(tx, casoId, id);

    await this.eventos.publicar(tx, {
      tipo: 'pendencia.resolvida',
      casoId,
      moduloOrigem: MODULOS.M10_SOLICITACOES,
      objetoTipo: 'pendencia',
      objetoId: id,
      payload: { resolucao },
    });
  }

  // --- consultas ------------------------------------------------------------

  /** Fila de solicitacoes por subaba (secao 51), mais recentes primeiro. */
  async listar(aba: AbaSolicitacoes): Promise<unknown[]> {
    const ctx = exigirContexto();
    const responsavel = aliasedTable(usuario, 'responsavel');

    const filtros = [eq(solicitacao.tenantId, ctx.tenantId)];
    if (aba === 'abertas') filtros.push(inArray(solicitacao.status, STATUS_ABERTOS));
    // Segunda review (Hugo): o que o patologista pediu nao pode se perder -
    // "ele solicitou uma coloracao especial... isso aparece para ele na tela".
    if (aba === 'minhas') {
      filtros.push(
        inArray(solicitacao.status, STATUS_ABERTOS),
        eq(solicitacao.solicitantePorId, ctx.usuarioId),
      );
    }
    if (aba === 'concluidas')
      filtros.push(inArray(solicitacao.status, ['concluida', 'recusada', 'cancelada']));
    if (aba === 'vencidas') {
      filtros.push(
        inArray(solicitacao.status, STATUS_ABERTOS),
        isNotNull(solicitacao.prazoEm),
        lt(solicitacao.prazoEm, new Date()),
      );
    }

    return this.db.executar((tx) =>
      tx
        .select({
          id: solicitacao.id,
          identificador: solicitacao.identificador,
          tipo: solicitacao.tipo,
          descricao: solicitacao.descricao,
          justificativa: solicitacao.justificativa,
          prioridade: solicitacao.prioridade,
          status: solicitacao.status,
          exigeAprovacao: solicitacao.exigeAprovacao,
          motivoRecusa: solicitacao.motivoRecusa,
          resultadoTecnico: solicitacao.resultadoTecnico,
          setorResponsavel: solicitacao.setorResponsavel,
          prazoEm: solicitacao.prazoEm,
          criadaEm: solicitacao.criadoEm,
          concluidaEm: solicitacao.concluidaEm,
          casoId: solicitacao.casoId,
          caso: caso.identificador,
          paciente: paciente.nome,
          solicitante: usuario.nomeCompleto,
          responsavel: responsavel.nomeCompleto,
        })
        .from(solicitacao)
        .leftJoin(caso, eq(caso.id, solicitacao.casoId))
        .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
        .leftJoin(usuario, eq(usuario.id, solicitacao.solicitantePorId))
        .leftJoin(responsavel, eq(responsavel.id, solicitacao.responsavelId))
        .where(and(...filtros))
        .orderBy(desc(solicitacao.criadoEm))
        .limit(200),
    );
  }

  /** Pendencias abertas da instituicao, mais antigas primeiro (secao 92). */
  async listarPendencias(): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: pendencia.id,
          tipo: pendencia.tipo,
          descricao: pendencia.descricao,
          status: pendencia.status,
          nivelBloqueio: pendencia.nivelBloqueio,
          etapaBloqueada: pendencia.etapaBloqueada,
          suspendePrazo: pendencia.suspendePrazo,
          setorResponsavel: pendencia.setorResponsavel,
          visivelPortal: pendencia.visivelPortal,
          criadaEm: pendencia.criadoEm,
          casoId: pendencia.casoId,
          caso: caso.identificador,
          paciente: paciente.nome,
        })
        .from(pendencia)
        .innerJoin(caso, eq(caso.id, pendencia.casoId))
        .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
        .where(
          and(
            eq(pendencia.tenantId, ctx.tenantId),
            inArray(pendencia.status, PENDENCIA_ABERTA),
          ),
        )
        .orderBy(asc(pendencia.criadoEm))
        .limit(200),
    );
  }

  /**
   * Numeros do M10 para o painel de chegada.
   *
   * O painel nao consulta `pendencia` por conta propria de proposito: quem
   * decide o que conta como "aberta" e o modulo dono do dado (DIRETRIZES
   * secao 8.10). Quando essa lista mudar, o painel acompanha sozinho.
   */
  async resumoPainel(): Promise<{
    pendenciasAbertas: number;
    pendenciasBloqueantes: number;
    solicitacoesAbertas: number;
  }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [pendencias] = await tx
        .select({
          abertas: sql<number>`count(*)::int`,
          bloqueantes: sql<number>`(count(*) filter (where ${pendencia.nivelBloqueio} <> 'nao'))::int`,
        })
        .from(pendencia)
        .where(
          and(eq(pendencia.tenantId, ctx.tenantId), inArray(pendencia.status, PENDENCIA_ABERTA)),
        );

      const [solicitacoes] = await tx
        .select({ abertas: sql<number>`count(*)::int` })
        .from(solicitacao)
        .where(
          and(eq(solicitacao.tenantId, ctx.tenantId), inArray(solicitacao.status, STATUS_ABERTOS)),
        );

      return {
        pendenciasAbertas: pendencias?.abertas ?? 0,
        pendenciasBloqueantes: pendencias?.bloqueantes ?? 0,
        solicitacoesAbertas: solicitacoes?.abertas ?? 0,
      };
    });
  }

  /** Aba SOLICITACOES do dossie (secao 89): tudo do caso, aberto e encerrado. */
  async doCaso(casoId: string): Promise<{ solicitacoes: unknown[]; pendencias: unknown[] }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const solicitacoes = await tx
        .select({
          id: solicitacao.id,
          identificador: solicitacao.identificador,
          tipo: solicitacao.tipo,
          descricao: solicitacao.descricao,
          prioridade: solicitacao.prioridade,
          status: solicitacao.status,
          resultadoTecnico: solicitacao.resultadoTecnico,
          criadaEm: solicitacao.criadoEm,
        })
        .from(solicitacao)
        .where(and(eq(solicitacao.tenantId, ctx.tenantId), eq(solicitacao.casoId, casoId)))
        .orderBy(desc(solicitacao.criadoEm));

      const pendencias = await tx
        .select({
          id: pendencia.id,
          tipo: pendencia.tipo,
          descricao: pendencia.descricao,
          status: pendencia.status,
          nivelBloqueio: pendencia.nivelBloqueio,
          resolucao: pendencia.resolucao,
          criadaEm: pendencia.criadoEm,
        })
        .from(pendencia)
        .where(and(eq(pendencia.tenantId, ctx.tenantId), eq(pendencia.casoId, casoId)))
        .orderBy(desc(pendencia.criadoEm));

      return { solicitacoes, pendencias };
    });
  }

  // --- conversa estruturada (secao 49) --------------------------------------

  async mensagens(solicitacaoId: string): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: mensagemSolicitacao.id,
          texto: mensagemSolicitacao.texto,
          externa: mensagemSolicitacao.externa,
          autor: usuario.nomeCompleto,
          criadaEm: mensagemSolicitacao.criadoEm,
        })
        .from(mensagemSolicitacao)
        .leftJoin(usuario, eq(usuario.id, mensagemSolicitacao.autorId))
        .where(
          and(
            eq(mensagemSolicitacao.tenantId, ctx.tenantId),
            eq(mensagemSolicitacao.solicitacaoId, solicitacaoId),
          ),
        )
        .orderBy(asc(mensagemSolicitacao.criadoEm)),
    );
  }

  async comentar(solicitacaoId: string, texto: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, solicitacaoId);

      await tx.insert(mensagemSolicitacao).values({
        tenantId: ctx.tenantId,
        solicitacaoId,
        autorId: ctx.usuarioId,
        texto: texto.trim(),
      });
    });
  }

  // --- internos -------------------------------------------------------------

  private async buscar(tx: Transacao, id: string) {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select()
      .from(solicitacao)
      .where(and(eq(solicitacao.tenantId, ctx.tenantId), eq(solicitacao.id, id)))
      .limit(1);

    if (!linha) throw new NotFoundException('Solicitação não encontrada.');
    return linha;
  }
}
