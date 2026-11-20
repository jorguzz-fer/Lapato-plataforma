import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import {
  andamentoSolicitacao,
  caso,
  etapaTipoSolicitacao,
  mensagemSolicitacao,
  paciente,
  pendencia,
  solicitacao,
  tipoSolicitacao,
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
  /**
   * Tipo do catalogo (quarta revisao). Com ele a solicitacao ganha fluxo
   * proprio; sem ele continua valendo o `tipo` em texto, que e como as
   * solicitacoes nascidas dentro do sistema (o recorte do M08) entram.
   */
  tipoId?: string;
  tipo: string;
  categoria?: string;
  descricao: string;
  justificativa?: string;
  prioridade?: Prioridade;
  objetoTipo?: string;
  objetoId?: string;
  setorResponsavel?: string;
  /**
   * Destino da solicitacao. Review: "eu recomendo sempre o nome da pessoa,
   * porque voce sabe quem colocou a mao - senao vai pro setor, tem cinco
   * tecnicos, um espera que o outro faca, ninguem faz e fica pendurado".
   */
  responsavelId?: string;
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
      /**
       * O tipo do catalogo manda no que a solicitacao sabe de si: se exige
       * aprovacao e para que setor vai quando quem pede nao escolhe uma
       * pessoa. Quem passa `exigeAprovacao` explicitamente vence o catalogo -
       * e como o M08 cria o recorte.
       */
      const tipo = dados.tipoId ? await this.exigirTipo(tx, dados.tipoId) : null;

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
      const exigeAprovacao = dados.exigeAprovacao ?? tipo?.exigeAprovacao ?? false;
      const status: StatusSolicitacao = exigeAprovacao
        ? 'aguardando_analise'
        : 'aguardando_execucao';

      const [nova] = await tx
        .insert(solicitacao)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          casoId: dados.casoId ?? null,
          tipoId: tipo?.id ?? null,
          tipo: tipo?.chave ?? dados.tipo,
          categoria: dados.categoria ?? null,
          origem: 'interna',
          descricao: dados.descricao,
          justificativa: dados.justificativa ?? null,
          prioridade: dados.prioridade ?? 'rotina',
          status,
          objetoTipo: dados.objetoTipo ?? null,
          objetoId: dados.objetoId ?? null,
          solicitantePorId: ctx.usuarioId,
          responsavelId: dados.responsavelId ?? null,
          setorResponsavel:
            dados.setorResponsavel ?? (dados.responsavelId ? null : tipo?.setorPadrao ?? null),
          prazoEm: dados.prazoEm ?? null,
          exigeAprovacao,
        })
        .returning({ id: solicitacao.id });

      await this.eventos.publicar(tx, {
        tipo: 'solicitacao.criada',
        casoId: dados.casoId ?? null,
        moduloOrigem: MODULOS.M10_SOLICITACOES,
        objetoTipo: 'solicitacao',
        objetoId: nova!.id,
        payload: {
          identificador,
          tipo: tipo?.chave ?? dados.tipo,
          nomeTipo: tipo?.nome ?? dados.tipo,
          prioridade: dados.prioridade ?? 'rotina',
        },
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
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);
      this.garantirExecutavel(atual.status);
      await this.concluirEmTransacao(tx, atual, resultadoTecnico);
    });
  }

  /** Recusa concluir o que nao esta aberto, ou o que ainda espera aprovacao. */
  private garantirExecutavel(status: StatusSolicitacao): void {
    if (!STATUS_ABERTOS.includes(status)) {
      throw new BadRequestException(`Esta solicitação não está aberta (status atual: ${status}).`);
    }
    if (status === 'aguardando_analise') {
      throw new BadRequestException(
        'Esta solicitação ainda aguarda aprovação - conclua a análise antes da execução.',
      );
    }
  }

  /**
   * Conclusao propriamente dita, compartilhada pela conclusao direta e pela
   * ultima etapa do fluxo do tipo - as duas tem de resolver as pendencias
   * vinculadas e publicar o mesmo evento, ou o caso fica preso por uma
   * pendencia que o trabalho ja resolveu.
   */
  private async concluirEmTransacao(
    tx: Transacao,
    atual: { id: string; casoId: string | null; identificador: string; tipo: string },
    resultadoTecnico?: string,
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx
      .update(solicitacao)
      .set({
        status: 'concluida',
        concluidaEm: new Date(),
        concluidaPorId: ctx.usuarioId,
        resultadoTecnico: resultadoTecnico?.trim() || null,
        atualizadoEm: new Date(),
      })
      .where(eq(solicitacao.id, atual.id));

    await this.eventos.publicar(tx, {
      tipo: 'solicitacao.concluida',
      casoId: atual.casoId,
      moduloOrigem: MODULOS.M10_SOLICITACOES,
      objetoTipo: 'solicitacao',
      objetoId: atual.id,
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
          eq(pendencia.solicitacaoId, atual.id),
          inArray(pendencia.status, PENDENCIA_ABERTA),
        ),
      );

    for (const p of vinculadas) {
      await this.encerrarPendencia(tx, p.id, p.casoId, 'Execução da solicitação concluída.');
    }
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
          /** Nome do catalogo; a chave em texto fica no `tipo` para o legado. */
          nomeTipo: tipoSolicitacao.nome,
          etapaAtual: solicitacao.etapaAtual,
          /**
           * Review: "cê precisa saber em que status tá - eu pedi, tá no estágio
           * 3 de 4". Duas subconsultas em vez de dois joins porque o join com
           * as etapas multiplicaria as linhas da fila.
           */
          totalEtapas: sql<number>`(
            select count(*)::int from etapa_tipo_solicitacao e
            where e.tenant_id = ${solicitacao.tenantId} and e.tipo_id = ${solicitacao.tipoId}
          )`,
          ultimaEtapa: sql<string | null>`(
            select a.rotulo from andamento_solicitacao a
            where a.tenant_id = ${solicitacao.tenantId} and a.solicitacao_id = ${solicitacao.id}
            order by a.ordem desc limit 1
          )`,
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
        .leftJoin(tipoSolicitacao, eq(tipoSolicitacao.id, solicitacao.tipoId))
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
          nomeTipo: tipoSolicitacao.nome,
          etapaAtual: solicitacao.etapaAtual,
          totalEtapas: sql<number>`(
            select count(*)::int from etapa_tipo_solicitacao e
            where e.tenant_id = ${solicitacao.tenantId} and e.tipo_id = ${solicitacao.tipoId}
          )`,
          descricao: solicitacao.descricao,
          prioridade: solicitacao.prioridade,
          status: solicitacao.status,
          resultadoTecnico: solicitacao.resultadoTecnico,
          criadaEm: solicitacao.criadoEm,
        })
        .from(solicitacao)
        .leftJoin(tipoSolicitacao, eq(tipoSolicitacao.id, solicitacao.tipoId))
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

  // --- tipos e fluxo (quarta revisao) ---------------------------------------

  /**
   * Catalogo de tipos ativos, com as etapas de cada um.
   *
   * Alimenta tres telas com a mesma verdade: o formulario de solicitacao, a
   * aba da Administracao e o Portal (que recebe so os tipos marcados).
   */
  async listarTipos(apenasPortal = false): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const filtros = [eq(tipoSolicitacao.tenantId, ctx.tenantId), isNull(tipoSolicitacao.inativadoEm)];
      if (apenasPortal) filtros.push(eq(tipoSolicitacao.visivelPortal, true));

      const tipos = await tx
        .select({
          id: tipoSolicitacao.id,
          chave: tipoSolicitacao.chave,
          nome: tipoSolicitacao.nome,
          descricao: tipoSolicitacao.descricao,
          exigeAprovacao: tipoSolicitacao.exigeAprovacao,
          visivelPortal: tipoSolicitacao.visivelPortal,
          setorPadrao: tipoSolicitacao.setorPadrao,
          ordem: tipoSolicitacao.ordem,
        })
        .from(tipoSolicitacao)
        .where(and(...filtros))
        .orderBy(asc(tipoSolicitacao.ordem), asc(tipoSolicitacao.nome));

      if (tipos.length === 0) return [];

      const etapas = await tx
        .select({
          tipoId: etapaTipoSolicitacao.tipoId,
          ordem: etapaTipoSolicitacao.ordem,
          rotulo: etapaTipoSolicitacao.rotulo,
          setor: etapaTipoSolicitacao.setor,
          textoPortal: etapaTipoSolicitacao.textoPortal,
        })
        .from(etapaTipoSolicitacao)
        .where(
          and(
            eq(etapaTipoSolicitacao.tenantId, ctx.tenantId),
            inArray(
              etapaTipoSolicitacao.tipoId,
              tipos.map((t) => t.id),
            ),
          ),
        )
        .orderBy(asc(etapaTipoSolicitacao.ordem));

      return tipos.map((t) => ({ ...t, etapas: etapas.filter((e) => e.tipoId === t.id) }));
    });
  }

  /**
   * Avanca uma etapa do fluxo do tipo.
   *
   * Review com o Hugo: "ela vai clicando, e isso vai caminhando... e ai a gente
   * sabe que no dia quinze esse material foi devolvido pro Hugo". Um clique =
   * uma linha na trilha, com rotulo, data, hora e nome - e a ultima etapa
   * conclui a solicitacao, que e o momento em que ela sai da lista de quem
   * executa e volta para quem pediu.
   */
  async avancar(
    id: string,
    observacao?: string,
  ): Promise<{ etapa: number; total: number; rotulo: string; concluida: boolean }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);
      this.garantirExecutavel(atual.status);

      if (!atual.tipoId) {
        throw new BadRequestException(
          'Esta solicitação não segue um tipo do catálogo, então não tem etapas - conclua a execução direto.',
        );
      }

      const etapas = await this.etapasDoTipo(tx, atual.tipoId);
      if (etapas.length === 0) {
        throw new BadRequestException(
          'O tipo desta solicitação não tem etapas configuradas. Configure o fluxo na Administração ou conclua a execução direto.',
        );
      }

      const proxima = etapas[atual.etapaAtual];
      if (!proxima) {
        throw new BadRequestException('O fluxo desta solicitação já passou pela última etapa.');
      }

      const ordem = atual.etapaAtual + 1;
      const ultima = ordem === etapas.length;
      const nota = observacao?.trim() || null;

      await tx.insert(andamentoSolicitacao).values({
        tenantId: ctx.tenantId,
        solicitacaoId: id,
        ordem,
        // Congelado: renomear a etapa na Administracao nao reescreve o passado.
        rotulo: proxima.rotulo,
        observacao: nota,
        registradoPorId: ctx.usuarioId,
      });

      await tx
        .update(solicitacao)
        .set({
          etapaAtual: ordem,
          /**
           * O setor da etapa passa a responder pela solicitacao: a fila segue o
           * fluxo sozinha, em vez de alguem ter de reatribuir a cada passo.
           */
          ...(proxima.setor ? { setorResponsavel: proxima.setor } : {}),
          ...(ultima ? {} : { status: 'em_execucao' as const }),
          atualizadoEm: new Date(),
        })
        .where(eq(solicitacao.id, id));

      await this.eventos.publicar(tx, {
        tipo: 'solicitacao.etapa_avancada',
        casoId: atual.casoId,
        moduloOrigem: MODULOS.M10_SOLICITACOES,
        objetoTipo: 'solicitacao',
        objetoId: id,
        /**
         * Visivel ao cliente quando o tipo e dele: e por este evento que o
         * Portal mostra "em que fase esta" sem ninguem mandar mensagem.
         */
        visibilidade: atual.visibilidadePortal === 'nao' ? 'interno' : 'externo',
        payload: {
          identificador: atual.identificador,
          etapa: ordem,
          total: etapas.length,
          rotulo: proxima.rotulo,
          textoPortal: proxima.textoPortal,
        },
      });

      await this.auditoria.registrar(tx, {
        entidade: 'solicitacao',
        entidadeId: id,
        acao: 'avancar_etapa',
        casoId: atual.casoId ?? undefined,
        valorNovo: { etapa: ordem, rotulo: proxima.rotulo, observacao: nota },
      });

      /**
       * Review: o ultimo clique da tecnica ("enviado pro patologista") E a
       * conclusao da execucao - nao existe um segundo botao depois dele.
       */
      if (ultima) {
        await this.concluirEmTransacao(tx, atual, nota ?? proxima.rotulo);
      }

      return { etapa: ordem, total: etapas.length, rotulo: proxima.rotulo, concluida: ultima };
    });
  }

  /**
   * Trilha de uma solicitacao: o fluxo configurado e o que ja aconteceu.
   *
   * Vai inteira para a tela porque e assim que a review pediu que se leia -
   * "tem um fluxo dele aqui embaixo", com o que falta visivel ao lado do que
   * ja foi feito.
   */
  async trilha(id: string): Promise<{
    etapaAtual: number;
    etapas: { ordem: number; rotulo: string; setor: string | null }[];
    andamento: {
      ordem: number;
      rotulo: string;
      observacao: string | null;
      registradoEm: Date;
      por: string | null;
    }[];
  }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);

      const etapas = atual.tipoId ? await this.etapasDoTipo(tx, atual.tipoId) : [];

      const andamento = await tx
        .select({
          ordem: andamentoSolicitacao.ordem,
          rotulo: andamentoSolicitacao.rotulo,
          observacao: andamentoSolicitacao.observacao,
          registradoEm: andamentoSolicitacao.registradoEm,
          por: usuario.nomeCompleto,
        })
        .from(andamentoSolicitacao)
        .leftJoin(usuario, eq(usuario.id, andamentoSolicitacao.registradoPorId))
        .where(
          and(
            eq(andamentoSolicitacao.tenantId, ctx.tenantId),
            eq(andamentoSolicitacao.solicitacaoId, id),
          ),
        )
        .orderBy(asc(andamentoSolicitacao.ordem));

      return {
        etapaAtual: atual.etapaAtual,
        etapas: etapas.map((e) => ({ ordem: e.ordem, rotulo: e.rotulo, setor: e.setor })),
        andamento,
      };
    });
  }

  // --- internos -------------------------------------------------------------

  /** Tipo ativo do catalogo; inativo recusa solicitacao nova (M01 secao 21). */
  private async exigirTipo(tx: Transacao, tipoId: string) {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select()
      .from(tipoSolicitacao)
      .where(and(eq(tipoSolicitacao.tenantId, ctx.tenantId), eq(tipoSolicitacao.id, tipoId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Tipo de solicitação não encontrado.');
    if (linha.inativadoEm) {
      throw new BadRequestException(
        `O tipo "${linha.nome}" está inativo e não aceita solicitações novas.`,
      );
    }
    return linha;
  }

  private async etapasDoTipo(tx: Transacao, tipoId: string) {
    const ctx = exigirContexto();

    return tx
      .select({
        ordem: etapaTipoSolicitacao.ordem,
        rotulo: etapaTipoSolicitacao.rotulo,
        setor: etapaTipoSolicitacao.setor,
        textoPortal: etapaTipoSolicitacao.textoPortal,
      })
      .from(etapaTipoSolicitacao)
      .where(
        and(
          eq(etapaTipoSolicitacao.tenantId, ctx.tenantId),
          eq(etapaTipoSolicitacao.tipoId, tipoId),
        ),
      )
      .orderBy(asc(etapaTipoSolicitacao.ordem));
  }

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
