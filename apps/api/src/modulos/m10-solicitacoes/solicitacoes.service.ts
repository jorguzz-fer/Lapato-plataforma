import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  amostra,
  andamentoSolicitacao,
  caso,
  etapaTipoSolicitacao,
  mensagemSolicitacao,
  paciente,
  pendencia,
  perfil,
  setor,
  solicitacao,
  subtipoSolicitacao,
  tipoPendencia,
  tipoSolicitacao,
  usuario,
  usuarioPerfil,
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
  /** Segundo nivel do catalogo: qual corante, qual marcador. */
  subtipoId?: string;
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
  /**
   * Quem originou: interna | cliente | veterinario | guardian. O Portal abre
   * como `cliente` - e o que separa "o laboratorio decidiu pedir" de "o
   * cliente pediu", que muda quem cobra e quem responde.
   */
  origem?: string;
  /** M10: visibilidade externa controlada - nao | parcial | sim. */
  visibilidadePortal?: string;
  /** Texto que o cliente le no lugar da descricao interna (traducao contextual). */
  textoPortal?: string;
  /**
   * Amostras a que o pedido se refere (quinta revisao): "digita DB28901,
   * aparece DB28901 A, B e C; o usuario escolhe qual - pode escolher apenas 1
   * dos 3 ou todos". Cada amostra escolhida vira uma solicitacao propria,
   * porque cada uma tem o seu caminho na bancada. Vazio = o caso inteiro.
   */
  amostraIds?: string[];
}

export interface NovaPendencia {
  casoId: string;
  solicitacaoId?: string;
  /** Tipo do catalogo (quinta revisao); o texto livre segue aceito no `tipo`. */
  tipoId?: string;
  tipo: string;
  descricao: string;
  status?: StatusPendencia;
  nivelBloqueio?: NivelBloqueio;
  etapaBloqueada?: Etapa;
  suspendePrazo?: boolean;
  setorResponsavel?: string;
  /**
   * Destino nominal. Quinta revisao: "o patologista podera criar pendencias
   * para ele proprio" - e e o mesmo campo que faz isso, apontando para quem
   * criou.
   */
  responsavelId?: string;
  visivelPortal?: boolean;
  /** Amostras a que a pendencia se refere; vazio = o caso inteiro. */
  amostraIds?: string[];
}

/** Subabas da tela principal (M10 secao 51). */
export type AbaSolicitacoes = 'abertas' | 'minhas' | 'vencidas' | 'concluidas' | 'todas';

/**
 * Uma linha das listas "para mim" e "pedi" da tela de chegada.
 *
 * Quarta revisao com o Hugo: a lista diz o que e, de que caso, desde quando,
 * em que estagio e com quem esta - as mesmas colunas que ele desenhou no
 * PowerPoint que levou para a reuniao.
 *
 * As datas sao `Date` porque e isso que a consulta devolve; viram string ISO
 * so na serializacao da resposta. O formato do fio e descrito no front, em
 * `apps/web/src/api.ts`.
 */
export interface DemandaMinha {
  id: string;
  identificador: string;
  tipo: string;
  nomeTipo: string | null;
  descricao: string;
  prioridade: string;
  status: string;
  etapaAtual: number;
  totalEtapas: number;
  ultimaEtapa: string | null;
  setorResponsavel: string | null;
  prazoEm: Date | null;
  criadaEm: Date;
  casoId: string | null;
  caso: string | null;
  paciente: string | null;
  solicitante: string | null;
  responsavel: string | null;
}

/** Pendencia enderecada a mim, com as colunas do documento da quinta revisao. */
export interface PendenciaMinha {
  id: string;
  tipo: string;
  descricao: string;
  status: string;
  nivelBloqueio: string;
  criadaEm: Date;
  solicitacaoId: string | null;
  solicitacao: string | null;
  solicitante: string | null;
  casoId: string;
  caso: string | null;
  paciente: string | null;
}

/**
 * O bloco "minhas demandas" da tela de chegada, inteiro.
 *
 * Tipado de verdade, e nao `unknown[]` com um `as` do outro lado. Antes, o M07
 * redeclarava este formato por conta propria e o colava com um cast - entao um
 * campo renomeado na consulta (`criadaEm` -> `criadoEm`) compilava normalmente
 * e so aparecia como `undefined` na tela. Agora ha uma declaracao so, e a
 * propria consulta precisa caber nela: o renome quebra a compilacao aqui,
 * antes do deploy.
 */
export interface MinhasDemandas {
  paraMim: DemandaMinha[];
  pedi: DemandaMinha[];
  pendencias: PendenciaMinha[];
}

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

  /**
   * Cria a solicitacao - uma por amostra escolhida.
   *
   * Quinta revisao: "digita DB28901, aparece DB28901 A, B e C; o usuario
   * escolhe qual - pode escolher apenas 1 dos 3 ou todos". Tres amostras
   * escolhidas viram tres solicitacoes, e nao uma com tres alvos, porque cada
   * uma anda no seu passo na bancada: o bloco A pode voltar hoje e o C sexta.
   */
  async criar(
    dados: NovaSolicitacao,
  ): Promise<{ id: string; identificador: string; criadas: number }> {
    const amostras = dados.amostraIds ?? [];

    return this.db.executar(async (tx) => {
      if (amostras.length === 0) {
        const unica = await this.criarEmTransacao(tx, dados);
        return { ...unica, criadas: 1 };
      }

      const feitas: Array<{ id: string; identificador: string }> = [];
      for (const amostraId of amostras) {
        const rotulo = await this.rotuloDaAmostra(tx, amostraId, dados.casoId);
        feitas.push(
          await this.criarEmTransacao(tx, {
            ...dados,
            objetoTipo: 'amostra',
            objetoId: amostraId,
            // O identificador da amostra entra na descricao: quem executa le a
            // lista sem abrir cada pedido para saber de qual bloco se trata.
            descricao: `${rotulo} — ${dados.descricao}`,
          }),
        );
      }
      return { ...feitas[0]!, criadas: feitas.length };
    });
  }

  /** Confere que a amostra e do caso e devolve o identificador dela. */
  private async rotuloDaAmostra(
    tx: Transacao,
    amostraId: string,
    casoId: string | undefined,
  ): Promise<string> {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select({ identificador: amostra.identificador, casoId: amostra.casoId })
      .from(amostra)
      .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.id, amostraId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Amostra não encontrada.');
    if (casoId && linha.casoId !== casoId) {
      throw new BadRequestException('A amostra não pertence a este caso.');
    }
    return linha.identificador;
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
       * pessoa. `exigeAprovacao` explicito so pode ENDURECER o catalogo (ver a
       * decisao do status, mais abaixo).
       */
      const tipo = dados.tipoId ? await this.exigirTipo(tx, dados.tipoId) : null;

      /**
       * Quinta revisao: "o ideal e que possamos ajustar o que cada login
       * podera solicitar". A restricao e por perfil e mora no tipo; lista
       * vazia continua significando "qualquer um".
       */
      if (tipo && tipo.perfisPermitidos.length > 0) {
        const meus = await this.perfisDoUsuario(tx, ctx.usuarioId);
        if (!tipo.perfisPermitidos.some((chave) => meus.has(chave))) {
          throw new ForbiddenException(
            `O seu perfil não pode abrir solicitações do tipo "${tipo.nome}".`,
          );
        }
      }

      const subtipo = dados.subtipoId
        ? await this.exigirSubtipo(tx, dados.subtipoId, tipo?.id)
        : null;

      /**
       * E o outro lado da mesma regra: "tanto quem pode solicitar quanto quem
       * pode receber". Checado no servidor tambem, e nao so escondido do
       * seletor, porque uma solicitacao endereçada a quem nao executa aquele
       * tipo e uma solicitacao parada.
       */
      if (dados.responsavelId) {
        await this.exigirDestinatario(tx, dados.responsavelId);
        if (tipo && tipo.perfisDestino.length > 0) {
          const dele = await this.perfisDoUsuario(tx, dados.responsavelId);
          if (!tipo.perfisDestino.some((chave) => dele.has(chave))) {
            throw new BadRequestException(
              `Solicitações do tipo "${tipo.nome}" não vão para o perfil do destinatário escolhido.`,
            );
          }
        }
      }

      const identificador = await this.numeracao.proximaSolicitacao(
        tx,
        new Date().getFullYear(),
      );

      /**
       * Secao 11: quem exige aprovacao previa (IHQ de alto custo, secao 29)
       * nasce aguardando analise; o resto ja cai na fila de execucao. "Criada"
       * como estado de repouso nao existe na pratica - criada sem proximo passo
       * e exatamente a demanda esquecida que o modulo quer eliminar.
       *
       * Quem pede pode EXIGIR aprovacao que o catalogo nao exige, mas nao pode
       * DISPENSAR a que ele exige. Antes valia `dados.exigeAprovacao ?? catalogo`,
       * e `exigeAprovacao: false` no corpo fazia a recepcao - que nao tem
       * `solicitacao:aprovar` - abrir uma IHQ de alto custo direto na fila de
       * execucao. Dispensar aprovacao e aprovar, e aprovar tem permissao propria.
       */
      const exigeAprovacao = (tipo?.exigeAprovacao ?? false) || dados.exigeAprovacao === true;
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
          subtipoId: subtipo?.id ?? null,
          // Congelado: renomear o catalogo nao reescreve o pedido.
          subtipo: subtipo?.nome ?? null,
          tipo: tipo?.chave ?? dados.tipo,
          categoria: dados.categoria ?? null,
          origem: dados.origem ?? 'interna',
          visibilidadePortal: dados.visibilidadePortal ?? 'nao',
          textoPortal: dados.textoPortal ?? null,
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

      /**
       * A primeira etapa do fluxo e a propria solicitacao (documento do Hugo:
       * "Solicitacao -> Separacao do bloco -> ..."). Ela ja aconteceu quando
       * este metodo rodou, entao fica registrada agora, com a hora e o nome de
       * quem pediu - ninguem precisa clicar em "avancar" para dizer que pediu.
       */
      let etapaAtual = 0;
      if (tipo) {
        const etapas = await this.etapasDoTipo(tx, tipo.id);
        for (const etapa of etapas) {
          if (!etapa.automatica) break;
          await tx.insert(andamentoSolicitacao).values({
            tenantId: ctx.tenantId,
            solicitacaoId: nova!.id,
            ordem: etapa.ordem,
            rotulo: etapa.rotulo,
            registradoPorId: ctx.usuarioId,
          });
          etapaAtual = etapa.ordem;
        }
        if (etapaAtual > 0) {
          await tx
            .update(solicitacao)
            .set({ etapaAtual })
            .where(eq(solicitacao.id, nova!.id));
        }
      }

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
          subtipo: subtipo?.nome ?? null,
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
  async criarPendencia(dados: NovaPendencia): Promise<{ id: string; criadas: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      /**
       * Tipo do catalogo (quinta revisao). O catalogo traz o nome que vai para
       * a tela e o bloqueio que o laboratorio decidiu como padrao para aquele
       * tipo - "Autorizacao" trava o caso, "Cadastral" nao. Quem cria ainda
       * pode mudar o nivel no formulario; o padrao e so o default.
       */
      let rotulo = dados.tipo.trim();
      let nivel = dados.nivelBloqueio ?? 'nao';
      let tipoCatalogoId: string | null = null;

      if (dados.tipoId) {
        const tipo = await this.exigirTipoPendencia(tx, dados.tipoId);
        tipoCatalogoId = tipo.id;
        rotulo = tipo.nome;
        if (!dados.nivelBloqueio) nivel = tipo.bloqueiaPadrao;
      }

      if (!rotulo) throw new BadRequestException('Informe o tipo da pendência.');

      /**
       * Destino nominal (quinta revisao): "o patologista podera criar
       * pendencias para ele proprio ou enviar para outro usuario". Quando
       * aponta para uma pessoa, conferimos que ela existe e esta ativa - uma
       * pendencia endereçada a quem saiu do laboratorio e uma pendencia
       * perdida.
       */
      const responsavelId = dados.responsavelId
        ? await this.exigirDestinatario(tx, dados.responsavelId)
        : null;

      /**
       * Uma pendencia por amostra escolhida. O documento mostra o mesmo gesto
       * da solicitacao: digita o registro, aparecem as amostras, escolhe-se
       * uma, algumas ou todas. Cada amostra tem o seu desfecho, entao cada uma
       * tem a sua pendencia - resolver a da amostra A nao resolve a da C.
       * Nenhuma amostra escolhida = a pendencia e do caso inteiro.
       */
      const alvos: Array<{ amostraId: string | null; rotuloAmostra: string | null }> = [];
      // Serializado de proposito: uma transacao atende uma consulta por vez.
      for (const amostraId of dados.amostraIds ?? []) {
        alvos.push({
          amostraId,
          rotuloAmostra: await this.rotuloDaAmostra(tx, amostraId, dados.casoId),
        });
      }
      if (alvos.length === 0) alvos.push({ amostraId: null, rotuloAmostra: null });

      const ids: string[] = [];

      for (const alvo of alvos) {
        const descricao = alvo.rotuloAmostra
          ? `${alvo.rotuloAmostra}: ${dados.descricao}`
          : dados.descricao;

        const [nova] = await tx
          .insert(pendencia)
          .values({
            tenantId: ctx.tenantId,
            casoId: dados.casoId,
            solicitacaoId: dados.solicitacaoId ?? null,
            tipoId: tipoCatalogoId,
            tipo: rotulo,
            descricao,
            status: dados.status ?? 'aberta',
            nivelBloqueio: nivel,
            etapaBloqueada: dados.etapaBloqueada ?? null,
            objetoTipo: alvo.amostraId ? 'amostra' : null,
            objetoId: alvo.amostraId,
            suspendePrazo: dados.suspendePrazo ?? false,
            responsavelId,
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
          payload: {
            tipo: rotulo,
            nivelBloqueio: nivel,
            ...(alvo.rotuloAmostra ? { amostra: alvo.rotuloAmostra } : {}),
          },
        });

        if (nivel !== 'nao') {
          await this.fluxo.bloquear(tx, dados.casoId, {
            nivel,
            origem: MODULOS.M10_SOLICITACOES,
            origemId: nova!.id,
            motivo: descricao,
            etapaBloqueada: dados.etapaBloqueada,
            condicaoLiberacao: 'Resolver a pendência.',
          });
        }

        if (dados.suspendePrazo) {
          await this.fluxo.suspenderPrazo(tx, dados.casoId, {
            motivo: descricao,
            origem: MODULOS.M10_SOLICITACOES,
            origemId: nova!.id,
          });
        }

        ids.push(nova!.id);
      }

      return { id: ids[0]!, criadas: ids.length };
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

  /**
   * As minhas demandas, para a tela de chegada.
   *
   * Quarta revisao com o Hugo: "sempre que cada um de nos entrar no sistema, a
   * primeira coisa que aparece sao as nossas pendencias e prioridades". Duas
   * listas, porque sao dois papeis diferentes no mesmo dia:
   *
   * - `paraMim`: o que esperam que EU faca (destino nominal, ou o setor em que
   *   eu trabalho). E a fila da Raquel.
   * - `pedi`: o que EU pedi e ainda nao voltou - "eu pedi uma coloracao de PAS,
   *   ela precisa voltar pra mim pra que eu leia... senao ele esquece".
   *
   * O estagio vem junto ("tá no estágio 3 de 4") porque sem ele a lista diz o
   * que falta mas nao diz quanto falta, e e isso que se responde ao telefone.
   */
  async minhasDemandas(): Promise<MinhasDemandas> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [eu] = await tx
        .select({ setor: setor.tipo })
        .from(usuario)
        .leftJoin(setor, eq(setor.id, usuario.setorPrincipalId))
        .where(and(eq(usuario.tenantId, ctx.tenantId), eq(usuario.id, ctx.usuarioId)))
        .limit(1);

      const responsavel = aliasedTable(usuario, 'responsavel');
      const colunas = {
        id: solicitacao.id,
        identificador: solicitacao.identificador,
        tipo: solicitacao.tipo,
        nomeTipo: tipoSolicitacao.nome,
        descricao: solicitacao.descricao,
        prioridade: solicitacao.prioridade,
        status: solicitacao.status,
        etapaAtual: solicitacao.etapaAtual,
        totalEtapas: sql<number>`(
          select count(*)::int from etapa_tipo_solicitacao e
          where e.tenant_id = ${solicitacao.tenantId} and e.tipo_id = ${solicitacao.tipoId}
        )`,
        ultimaEtapa: sql<string | null>`(
          select a.rotulo from andamento_solicitacao a
          where a.tenant_id = ${solicitacao.tenantId} and a.solicitacao_id = ${solicitacao.id}
          order by a.ordem desc limit 1
        )`,
        setorResponsavel: solicitacao.setorResponsavel,
        prazoEm: solicitacao.prazoEm,
        criadaEm: solicitacao.criadoEm,
        casoId: solicitacao.casoId,
        caso: caso.identificador,
        paciente: paciente.nome,
        solicitante: usuario.nomeCompleto,
        responsavel: responsavel.nomeCompleto,
      };

      const consulta = (filtro: SQL) =>
        tx
          .select(colunas)
          .from(solicitacao)
          .leftJoin(caso, eq(caso.id, solicitacao.casoId))
          .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
          .leftJoin(usuario, eq(usuario.id, solicitacao.solicitantePorId))
          .leftJoin(responsavel, eq(responsavel.id, solicitacao.responsavelId))
          .leftJoin(tipoSolicitacao, eq(tipoSolicitacao.id, solicitacao.tipoId))
          .where(
            and(
              eq(solicitacao.tenantId, ctx.tenantId),
              inArray(solicitacao.status, STATUS_ABERTOS),
              filtro,
            ),
          )
          // Mais antiga primeiro: a demanda esquecida e o inimigo (secao 92).
          .orderBy(asc(solicitacao.criadoEm))
          .limit(50);

      /**
       * O setor entra na fila so quando a pessoa tem setor principal cadastrado.
       * Sem ele, a lista fica nos destinos nominais - que e a recomendacao da
       * review de todo modo.
       */
      const meuDestino = eu?.setor
        ? or(
            eq(solicitacao.responsavelId, ctx.usuarioId),
            eq(solicitacao.setorResponsavel, eu.setor),
          )!
        : eq(solicitacao.responsavelId, ctx.usuarioId);

      // Em sequencia, e nao em Promise.all: as duas rodam na MESMA transacao, e
      // uma transacao atende uma consulta por vez.
      const paraMim = await consulta(meuDestino);
      const pedi = await consulta(eq(solicitacao.solicitantePorId, ctx.usuarioId));

      /**
       * Pendencias enderecadas a mim - inclusive as que eu mesmo criei para
       * mim, que e o uso que a quinta revisao descreve: "o patologista podera
       * criar pendencias para ele proprio".
       *
       * As colunas sao as do documento (identificador, a solicitacao que a
       * gerou, a data e quem pediu) mais o caso, porque o botao "Laudar" da
       * tela precisa saber para onde ir.
       */
      const solicitanteP = aliasedTable(usuario, 'solicitante_pendencia');
      const pendencias = await tx
        .select({
          id: pendencia.id,
          tipo: pendencia.tipo,
          descricao: pendencia.descricao,
          status: pendencia.status,
          nivelBloqueio: pendencia.nivelBloqueio,
          criadaEm: pendencia.criadoEm,
          solicitacaoId: pendencia.solicitacaoId,
          solicitacao: solicitacao.identificador,
          solicitante: solicitanteP.nomeCompleto,
          casoId: pendencia.casoId,
          caso: caso.identificador,
          paciente: paciente.nome,
        })
        .from(pendencia)
        .innerJoin(caso, eq(caso.id, pendencia.casoId))
        .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
        .leftJoin(solicitacao, eq(solicitacao.id, pendencia.solicitacaoId))
        .leftJoin(solicitanteP, eq(solicitanteP.id, pendencia.criadaPorId))
        .where(
          and(
            eq(pendencia.tenantId, ctx.tenantId),
            inArray(pendencia.status, PENDENCIA_ABERTA),
            eq(pendencia.responsavelId, ctx.usuarioId),
          ),
        )
        .orderBy(asc(pendencia.criadoEm))
        .limit(50);

      return { paraMim, pedi, pendencias };
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
          perfisPermitidos: tipoSolicitacao.perfisPermitidos,
          perfisDestino: tipoSolicitacao.perfisDestino,
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
          automatica: etapaTipoSolicitacao.automatica,
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

      /**
       * Segundo nivel do catalogo (quinta revisao): "coloracao especial" nao
       * e um pedido, e doze - PAS, Ziehl-Neelsen, Gram... O subtipo e o que o
       * formulario pergunta em seguida ao tipo, e o que vai no rotulo da
       * demanda em vez de "coloracao especial" sem mais.
       */
      const subtipos = await tx
        .select({
          id: subtipoSolicitacao.id,
          tipoId: subtipoSolicitacao.tipoId,
          nome: subtipoSolicitacao.nome,
          ordem: subtipoSolicitacao.ordem,
        })
        .from(subtipoSolicitacao)
        .where(
          and(
            eq(subtipoSolicitacao.tenantId, ctx.tenantId),
            isNull(subtipoSolicitacao.inativadoEm),
            inArray(
              subtipoSolicitacao.tipoId,
              tipos.map((t) => t.id),
            ),
          ),
        )
        .orderBy(asc(subtipoSolicitacao.ordem), asc(subtipoSolicitacao.nome));

      return tipos.map((t) => ({
        ...t,
        etapas: etapas.filter((e) => e.tipoId === t.id),
        subtipos: subtipos.filter((sub) => sub.tipoId === t.id),
      }));
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

  /** Tipos de pendencia ativos do catalogo (quinta revisao). */
  async listarTiposPendencia(): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: tipoPendencia.id,
          chave: tipoPendencia.chave,
          nome: tipoPendencia.nome,
          bloqueiaPadrao: tipoPendencia.bloqueiaPadrao,
          ordem: tipoPendencia.ordem,
        })
        .from(tipoPendencia)
        .where(and(eq(tipoPendencia.tenantId, ctx.tenantId), isNull(tipoPendencia.inativadoEm)))
        .orderBy(asc(tipoPendencia.ordem), asc(tipoPendencia.nome)),
    );
  }

  /**
   * Amostras do caso, para o formulario escolher o alvo do pedido.
   *
   * Quinta revisao: "digita DB28901, aparece DB28901 A, B e C". A letra e a
   * descricao bastam - quem pede coloracao sabe de qual fragmento esta
   * falando pela regiao, nao pelo uuid.
   */
  async amostrasDoCaso(
    casoId: string,
  ): Promise<Array<{ id: string; identificador: string; descricao: string | null }>> {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: amostra.id,
          identificador: amostra.identificador,
          descricao: amostra.descricao,
        })
        .from(amostra)
        .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.casoId, casoId)))
        .orderBy(asc(amostra.identificador)),
    );
  }

  // --- internos -------------------------------------------------------------

  /** Chaves dos perfis de um usuario, para a restricao por perfil do catalogo. */
  private async perfisDoUsuario(tx: Transacao, usuarioId: string): Promise<Set<string>> {
    const linhas = await tx
      .select({ chave: perfil.chave })
      .from(usuarioPerfil)
      .innerJoin(perfil, eq(perfil.id, usuarioPerfil.perfilId))
      .where(eq(usuarioPerfil.usuarioId, usuarioId));
    return new Set(linhas.map((l) => l.chave).filter((c): c is string => !!c));
  }

  private async exigirTipoPendencia(tx: Transacao, tipoId: string) {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select()
      .from(tipoPendencia)
      .where(and(eq(tipoPendencia.tenantId, ctx.tenantId), eq(tipoPendencia.id, tipoId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Tipo de pendência não encontrado.');
    if (linha.inativadoEm) {
      throw new BadRequestException(`O tipo "${linha.nome}" está inativo.`);
    }
    return linha;
  }

  /**
   * Destino nominal: usuario interno e ativo. Mandar pendencia para quem saiu
   * do laboratorio e o mesmo que nao mandar para ninguem - so que com a
   * aparencia de resolvido.
   */
  private async exigirDestinatario(tx: Transacao, usuarioId: string): Promise<string> {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select({ id: usuario.id, inativadoEm: usuario.inativadoEm })
      .from(usuario)
      .where(and(eq(usuario.tenantId, ctx.tenantId), eq(usuario.id, usuarioId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Destinatário não encontrado.');
    if (linha.inativadoEm) {
      throw new BadRequestException('O destinatário escolhido está inativo.');
    }
    return linha.id;
  }

  private async exigirSubtipo(tx: Transacao, subtipoId: string, tipoId: string | undefined) {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select()
      .from(subtipoSolicitacao)
      .where(
        and(eq(subtipoSolicitacao.tenantId, ctx.tenantId), eq(subtipoSolicitacao.id, subtipoId)),
      )
      .limit(1);

    if (!linha) throw new NotFoundException('Subtipo de solicitação não encontrado.');
    if (linha.inativadoEm) {
      throw new BadRequestException(`O subtipo "${linha.nome}" está inativo.`);
    }
    if (tipoId && linha.tipoId !== tipoId) {
      throw new BadRequestException('Este subtipo pertence a outro tipo de solicitação.');
    }
    return linha;
  }

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
        automatica: etapaTipoSolicitacao.automatica,
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
