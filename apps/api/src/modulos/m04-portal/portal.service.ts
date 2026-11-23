import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
  caso,
  cliente,
  estadoCaso,
  eventoDominio,
  historicoClinico,
  laudo,
  laudoVersao,
  paciente,
  pendencia,
  servico,
  solicitacao,
  tipoSolicitacao,
  tutor,
  veterinario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  eventoExterno,
  statusExterno,
  type Etapa,
  type TipoEvento,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { StorageFactory } from '../../core/storage/storage.provider.js';
import { SolicitacoesService } from '../m10-solicitacoes/solicitacoes.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M04 - Portal do Cliente.
 *
 * "O Portal nao devera ser um sistema separado conectado ao LAPATO. Ele devera
 * ser o proprio LAPATO visto pela perspectiva do cliente" (secao 87).
 *
 * Tres regras estruturam este servico:
 *
 * 1. **Isolamento por cliente e absoluto** (secao 5). Toda consulta parte do
 *    `clienteId` da CONTA, nunca de um parametro do request - trocar o id na
 *    URL nao muda o que se ve, porque o id nao vem da URL. E o mesmo principio
 *    do `tenantId` (ADR 0002).
 * 2. **O Portal nao e dono de nada** (secao 83). Ele le do M05, M07, M10 e M11
 *    e escreve APENAS onde o cliente e a fonte legitima: historico clinico
 *    complementar e solicitacoes.
 * 3. **O externo nao ve o interno** (secoes 11-12, 20, 55, 63). Status
 *    traduzidos, linha do tempo filtrada por lista de permitidos, e laudo
 *    somente depois de liberado - rascunho, nota interna e versao nao assinada
 *    nao existem deste lado.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
    private readonly eventos: EventosService,
    private readonly storage: StorageFactory,
    /**
     * O Portal nao e dono da solicitacao (secao 83): quem numera, aplica o
     * fluxo do tipo e publica o evento e o M10. Aqui so se decide que o
     * cliente pode pedir aquilo, para aquele caso.
     */
    private readonly demandas: SolicitacoesService,
  ) {}

  /**
   * O cliente da conta.
   *
   * Conta externa sem cliente vinculado nao acessa o Portal: sem ele nao ha
   * escopo, e "sem escopo" nao pode significar "tudo".
   */
  private clienteDaConta(): string {
    const ctx = exigirContexto();
    if (!ctx.clienteId) {
      throw new ForbiddenException(
        'Esta conta não está vinculada a um cliente e por isso não acessa o Portal.',
      );
    }
    return ctx.clienteId;
  }

  /** Painel inicial (secao 9): contagens do que exige atencao. */
  async painel() {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();

    return this.db.executar(async (tx) => {
      const [instituicao] = await tx
        .select({ nome: cliente.nomeFantasia })
        .from(cliente)
        .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, clienteId)))
        .limit(1);

      const [emAndamento] = await tx
        .select({ total: count() })
        .from(caso)
        .innerJoin(estadoCaso, eq(estadoCaso.casoId, caso.id))
        .where(
          and(
            eq(caso.tenantId, ctx.tenantId),
            eq(caso.clienteId, clienteId),
            sql`${estadoCaso.etapa} not in ('liberado', 'arquivado', 'cancelado')`,
          ),
        );

      const [liberados] = await tx
        .select({ total: count() })
        .from(caso)
        .innerJoin(laudo, eq(laudo.casoId, caso.id))
        .where(
          and(
            eq(caso.tenantId, ctx.tenantId),
            eq(caso.clienteId, clienteId),
            isNotNull(laudo.liberadoEm),
          ),
        );

      /**
       * Secao 34: nem toda pendencia interna aparece aqui. So as marcadas como
       * visiveis no Portal - as demais sao conversa do laboratorio consigo
       * mesmo.
       */
      const [pendencias] = await tx
        .select({ total: count() })
        .from(pendencia)
        .innerJoin(caso, eq(caso.id, pendencia.casoId))
        .where(
          and(
            eq(pendencia.tenantId, ctx.tenantId),
            eq(caso.clienteId, clienteId),
            eq(pendencia.visivelPortal, true),
            sql`${pendencia.status} in ('aberta', 'aguardando_veterinario', 'aguardando_cliente')`,
          ),
        );

      // A mesma regra da lista: o que o laboratorio pede a si mesmo nao conta.
      const [solicitacoes] = await tx
        .select({ total: count() })
        .from(solicitacao)
        .innerJoin(caso, eq(caso.id, solicitacao.casoId))
        .where(
          and(
            eq(solicitacao.tenantId, ctx.tenantId),
            eq(caso.clienteId, clienteId),
            ne(solicitacao.visibilidadePortal, 'nao'),
            sql`${solicitacao.status} not in ('concluida', 'cancelada', 'recusada')`,
          ),
        );

      return {
        cliente: instituicao?.nome ?? '',
        examesEmAndamento: emAndamento?.total ?? 0,
        laudosLiberados: liberados?.total ?? 0,
        pendenciasAguardandoVoce: pendencias?.total ?? 0,
        solicitacoesAbertas: solicitacoes?.total ?? 0,
      };
    });
  }

  /**
   * Exames do cliente (secoes 11, 15-17).
   *
   * `q` busca por paciente, tutor e registro - os tres jeitos pelos quais o
   * cliente lembra de um exame. Ele nao decora o numero do caso.
   */
  async exames(filtro: { q?: string; situacao?: 'andamento' | 'liberados' | 'todos' }) {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();
    const situacao = filtro.situacao ?? 'todos';

    return this.db.executar(async (tx) => {
      const busca = filtro.q?.trim();

      const linhas = await tx
        .select({
          id: caso.id,
          identificador: caso.identificador,
          paciente: paciente.nome,
          tutor: tutor.nome,
          servico: servico.nome,
          veterinario: veterinario.nome,
          recebidoEm: caso.recebidoEm,
          criadoEm: caso.criadoEm,
          etapa: estadoCaso.etapa,
          bloqueado: estadoCaso.bloqueado,
          previsaoLiberacao: estadoCaso.previsaoLiberacao,
          liberadoEm: laudo.liberadoEm,
        })
        .from(caso)
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .leftJoin(tutor, eq(tutor.id, paciente.tutorId))
        .leftJoin(veterinario, eq(veterinario.id, caso.veterinarioId))
        .leftJoin(estadoCaso, eq(estadoCaso.casoId, caso.id))
        .leftJoin(laudo, eq(laudo.casoId, caso.id))
        .where(
          and(
            eq(caso.tenantId, ctx.tenantId),
            eq(caso.clienteId, clienteId),
            busca
              ? or(
                  ilike(paciente.nome, `%${busca}%`),
                  ilike(tutor.nome, `%${busca}%`),
                  ilike(caso.identificador, `%${busca}%`),
                )
              : undefined,
            situacao === 'liberados' ? isNotNull(laudo.liberadoEm) : undefined,
            situacao === 'andamento' ? isNull(laudo.liberadoEm) : undefined,
          ),
        )
        .orderBy(desc(caso.criadoEm))
        .limit(200);

      return linhas.map((l) => ({
        id: l.id,
        identificador: l.identificador,
        paciente: l.paciente,
        tutor: l.tutor,
        servico: l.servico,
        veterinario: l.veterinario,
        recebidoEm: l.recebidoEm,
        criadoEm: l.criadoEm,
        // Secao 12: o cliente nunca ve a etapa tecnica.
        status: statusExterno((l.etapa ?? 'aguardando_recebimento') as Etapa, l.bloqueado ?? false),
        /**
         * Secao 13: prazo suspenso nao e prazo vencido. Quando o caso esta
         * bloqueado, a previsao some em vez de mostrar uma data que o
         * laboratorio ja sabe que nao vale.
         */
        previsaoLiberacao: l.bloqueado ? null : l.previsaoLiberacao,
        laudoDisponivel: l.liberadoEm !== null,
      }));
    });
  }

  /** Dossie externo (secao 18): a versao do caso que o cliente pode ver. */
  async exame(casoId: string) {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();

    return this.db.executar(async (tx) => {
      const [registro] = await tx
        .select({
          id: caso.id,
          identificador: caso.identificador,
          paciente: paciente.nome,
          tutor: tutor.nome,
          especieId: paciente.especieId,
          servico: servico.nome,
          veterinario: veterinario.nome,
          recebidoEm: caso.recebidoEm,
          criadoEm: caso.criadoEm,
          etapa: estadoCaso.etapa,
          bloqueado: estadoCaso.bloqueado,
          previsaoLiberacao: estadoCaso.previsaoLiberacao,
          laudoId: laudo.id,
          liberadoEm: laudo.liberadoEm,
        })
        .from(caso)
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .leftJoin(tutor, eq(tutor.id, paciente.tutorId))
        .leftJoin(veterinario, eq(veterinario.id, caso.veterinarioId))
        .leftJoin(estadoCaso, eq(estadoCaso.casoId, caso.id))
        .leftJoin(laudo, eq(laudo.casoId, caso.id))
        .where(
          and(
            eq(caso.tenantId, ctx.tenantId),
            eq(caso.id, casoId),
            // O isolamento entra na CONSULTA: caso de outro cliente nao e "403",
            // e simplesmente inexistente daqui (secao 5).
            eq(caso.clienteId, clienteId),
          ),
        )
        .limit(1);

      if (!registro) throw new NotFoundException('Exame não encontrado.');

      const [historicos, pendencias, linhaDoTempo, versoes] = await Promise.all([
        tx
          .select({
            id: historicoClinico.id,
            texto: historicoClinico.texto,
            origem: historicoClinico.origem,
            complementar: historicoClinico.complementar,
            criadoEm: historicoClinico.criadoEm,
          })
          .from(historicoClinico)
          .where(
            and(
              eq(historicoClinico.tenantId, ctx.tenantId),
              eq(historicoClinico.casoId, casoId),
            ),
          )
          .orderBy(asc(historicoClinico.criadoEm)),
        tx
          .select({
            id: pendencia.id,
            tipo: pendencia.tipo,
            descricao: pendencia.descricao,
            status: pendencia.status,
            criadoEm: pendencia.criadoEm,
          })
          .from(pendencia)
          .where(
            and(
              eq(pendencia.tenantId, ctx.tenantId),
              eq(pendencia.casoId, casoId),
              eq(pendencia.visivelPortal, true),
            ),
          )
          .orderBy(desc(pendencia.criadoEm)),
        tx
          .select({ tipo: eventoDominio.tipo, ocorridoEm: eventoDominio.ocorridoEm })
          .from(eventoDominio)
          .where(
            and(eq(eventoDominio.tenantId, ctx.tenantId), eq(eventoDominio.casoId, casoId)),
          )
          .orderBy(asc(eventoDominio.ocorridoEm)),
        registro.laudoId
          ? tx
              .select({
                id: laudoVersao.id,
                versao: laudoVersao.versao,
                tipo: laudoVersao.tipo,
                assinadaEm: laudoVersao.assinadaEm,
                substituida: laudoVersao.substituida,
                codigoValidacao: laudoVersao.codigoValidacao,
              })
              .from(laudoVersao)
              .where(
                and(
                  eq(laudoVersao.tenantId, ctx.tenantId),
                  eq(laudoVersao.laudoId, registro.laudoId),
                  // Secao 20: rascunho nao existe aqui. So o que foi assinado.
                  isNotNull(laudoVersao.assinadaEm),
                ),
              )
              .orderBy(desc(laudoVersao.versao))
          : Promise.resolve([]),
      ]);

      return {
        id: registro.id,
        identificador: registro.identificador,
        paciente: registro.paciente,
        tutor: registro.tutor,
        servico: registro.servico,
        veterinario: registro.veterinario,
        recebidoEm: registro.recebidoEm,
        criadoEm: registro.criadoEm,
        status: statusExterno(
          (registro.etapa ?? 'aguardando_recebimento') as Etapa,
          registro.bloqueado ?? false,
        ),
        previsaoLiberacao: registro.bloqueado ? null : registro.previsaoLiberacao,
        prazoSuspenso: registro.bloqueado ?? false,
        historicos,
        pendencias,
        /**
         * Secao 63: a linha do tempo externa e uma TRADUCAO, nao um recorte.
         * Evento sem rotulo externo nao aparece - e o padrao e nao aparecer.
         */
        linhaDoTempo: linhaDoTempo
          .map((e) => ({
            rotulo: eventoExterno(e.tipo as TipoEvento),
            ocorridoEm: e.ocorridoEm,
          }))
          .filter((e): e is { rotulo: string; ocorridoEm: Date } => e.rotulo !== null),
        // Sem laudo liberado, o cliente nao ve versao nenhuma.
        laudo:
          registro.liberadoEm && versoes.length > 0
            ? {
                liberadoEm: registro.liberadoEm,
                versoes: versoes.map((v) => ({
                  id: v.id,
                  versao: v.versao,
                  tipo: v.tipo,
                  assinadaEm: v.assinadaEm,
                  // Secao 20: nova versao ou adendo precisa ficar claro.
                  vigente: !v.substituida,
                  codigoValidacao: v.codigoValidacao,
                })),
              }
            : null,
      };
    });
  }

  /**
   * Complementacao do historico clinico (secoes 23-24).
   *
   * Acrescenta - nunca substitui. "Uma informacao clinica previamente enviada
   * nao devera simplesmente ser substituida sem registro", porque o patologista
   * precisa reconstruir a sequencia do que soube e quando.
   */
  async complementarHistorico(casoId: string, texto: string): Promise<void> {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();

    if (!texto?.trim()) {
      throw new BadRequestException('Escreva a informação a acrescentar.');
    }

    return this.db.executar(async (tx) => {
      await this.exigirCasoDoCliente(tx, casoId, clienteId);

      await tx.insert(historicoClinico).values({
        tenantId: ctx.tenantId,
        casoId,
        texto: texto.trim(),
        origem: 'portal',
        complementar: true,
        registradoPorId: ctx.usuarioId,
      });

      /**
       * O complemento entra na linha do tempo do caso: quem esta laudando
       * precisa saber que chegou informacao nova, sem depender de alguem avisar.
       */
      await this.eventos.publicar(tx, {
        tipo: 'historico.complementado',
        casoId,
        moduloOrigem: MODULOS.M04_PORTAL,
        payload: { origem: 'portal' },
      });

      await this.auditoria.registrar(tx, {
        entidade: 'historico_clinico',
        entidadeId: casoId,
        acao: 'complementar',
        casoId,
        valorNovo: { origem: 'portal' },
      });
    });
  }

  /**
   * Solicitacoes do cliente (secoes 30-31), com os status externos.
   *
   * **So as que tem visibilidade externa** (M10: `visibilidade_portal`). Ser do
   * caso do cliente nao basta: a reamostragem, a revisao interna e o problema
   * tecnico tambem moram no caso dele, e a descricao interna e o registro
   * tecnico do laboratorio ("erro tecnico na HE, suspeita de linfoma"). Antes
   * deste filtro, tudo isso aparecia no Portal palavra por palavra.
   *
   * Pelo mesmo motivo o texto devolvido e o `texto_portal` - a traducao
   * contextual -, nunca a `descricao`. So quem foi marcado como visivel por
   * inteiro (`sim`) mostra a descricao quando nao ha traducao.
   */
  async solicitacoes() {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();

    return this.db.executar((tx) =>
      tx
        .select({
          id: solicitacao.id,
          identificador: solicitacao.identificador,
          tipo: solicitacao.tipo,
          nomeTipo: tipoSolicitacao.nome,
          descricao: sql<string | null>`coalesce(
            ${solicitacao.textoPortal},
            case when ${solicitacao.visibilidadePortal} = 'sim' then ${solicitacao.descricao} end
          )`,
          status: solicitacao.status,
          criadoEm: solicitacao.criadoEm,
          casoIdentificador: caso.identificador,
          paciente: paciente.nome,
          /**
           * Em que fase esta, na lingua do cliente.
           *
           * Quarta revisao com o Hugo: "ele vai saber em que fase tá: tá
           * solicitado, já foi encaminhado, foi separado". A fase nao e o
           * rotulo interno da etapa - e o `texto_portal` dela, a traducao
           * contextual do M10. Etapa sem texto nao aparece aqui: o cliente nao
           * precisa saber que o bloco foi "enviado ao processamento".
           */
          fase: sql<string | null>`(
            select e.texto_portal
            from andamento_solicitacao a
            join etapa_tipo_solicitacao e
              on e.tenant_id = a.tenant_id
             and e.tipo_id = ${solicitacao.tipoId}
             and e.ordem = a.ordem
            where a.tenant_id = ${solicitacao.tenantId}
              and a.solicitacao_id = ${solicitacao.id}
              and e.texto_portal is not null
            order by a.ordem desc
            limit 1
          )`,
        })
        .from(solicitacao)
        .innerJoin(caso, eq(caso.id, solicitacao.casoId))
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .leftJoin(tipoSolicitacao, eq(tipoSolicitacao.id, solicitacao.tipoId))
        .where(
          and(
            eq(solicitacao.tenantId, ctx.tenantId),
            eq(caso.clienteId, clienteId),
            ne(solicitacao.visibilidadePortal, 'nao'),
          ),
        )
        .orderBy(desc(solicitacao.criadoEm))
        .limit(100),
    );
  }

  /**
   * O que o cliente pode pedir sozinho.
   *
   * So os tipos que a Administracao marcou como visiveis no Portal. A lista e
   * curta de proposito: devolucao de bloco, devolucao de lamina, segunda
   * opiniao, copia de laudo - o que a review mostrou chegando por WhatsApp.
   */
  async tiposSolicitacao() {
    const ctx = exigirContexto();
    this.clienteDaConta();

    return this.db.executar((tx) =>
      tx
        .select({
          id: tipoSolicitacao.id,
          nome: tipoSolicitacao.nome,
          descricao: tipoSolicitacao.descricao,
        })
        .from(tipoSolicitacao)
        .where(
          and(
            eq(tipoSolicitacao.tenantId, ctx.tenantId),
            eq(tipoSolicitacao.visivelPortal, true),
            isNull(tipoSolicitacao.inativadoEm),
          ),
        )
        .orderBy(asc(tipoSolicitacao.ordem), asc(tipoSolicitacao.nome)),
    );
  }

  /**
   * O cliente abre a solicitacao.
   *
   * A reuniao inteira nasce de uma devolucao de bloco pedida por WhatsApp:
   * "ele nao faz mais solicitacao pelo WhatsApp, faz pelo login deles... e aí
   * quando ele entrar no sistema ele vai saber em que fase tá". Aqui se decide
   * apenas que o cliente pode pedir AQUILO para AQUELE caso; numerar, aplicar
   * o fluxo do tipo e publicar o evento e trabalho do M10.
   */
  async abrirSolicitacao(dados: {
    casoId: string;
    tipoId: string;
    descricao: string;
  }): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();

    if (!dados.descricao?.trim()) {
      throw new BadRequestException('Escreva o que está sendo solicitado.');
    }

    return this.db.executar(async (tx) => {
      await this.exigirCasoDoCliente(tx, dados.casoId, clienteId);

      const [tipo] = await tx
        .select()
        .from(tipoSolicitacao)
        .where(
          and(
            eq(tipoSolicitacao.tenantId, ctx.tenantId),
            eq(tipoSolicitacao.id, dados.tipoId),
            eq(tipoSolicitacao.visivelPortal, true),
            isNull(tipoSolicitacao.inativadoEm),
          ),
        )
        .limit(1);

      /**
       * Mesma mensagem para tipo inexistente, inativo e nao liberado ao
       * Portal: distinguir os tres contaria ao cliente o que existe do lado de
       * dentro.
       */
      if (!tipo) {
        throw new NotFoundException('Este tipo de solicitação não está disponível.');
      }

      const criada = await this.demandas.criarEmTransacao(tx, {
        casoId: dados.casoId,
        tipoId: tipo.id,
        tipo: tipo.chave,
        descricao: dados.descricao.trim(),
        origem: 'cliente',
        /** Pedida por ele: ele acompanha a fase sem precisar ligar. */
        visibilidadePortal: 'parcial',
        textoPortal: dados.descricao.trim(),
      });

      await this.auditoria.registrar(tx, {
        entidade: 'solicitacao',
        entidadeId: criada.id,
        acao: 'abrir_pelo_portal',
        casoId: dados.casoId,
        valorNovo: { tipo: tipo.chave, origem: 'cliente' },
      });

      return criada;
    });
  }

  /**
   * PDF do laudo (secoes 19-20).
   *
   * Tres condicoes, e nao uma: a versao tem de ser do cliente, estar
   * ASSINADA e pertencer a um laudo LIBERADO. Assinado sem liberacao ainda e
   * documento interno - o ato que o entrega ao mundo e a liberacao
   * (DIRETRIZES secao 17).
   */
  async baixarLaudo(versaoId: string): Promise<{ bytes: Buffer; nomeArquivo: string }> {
    const ctx = exigirContexto();
    const clienteId = this.clienteDaConta();

    return this.db.executar(async (tx) => {
      const [linha] = await tx
        .select({
          pdfChave: laudoVersao.pdfChave,
          versao: laudoVersao.versao,
          assinadaEm: laudoVersao.assinadaEm,
          liberadoEm: laudo.liberadoEm,
          casoId: caso.id,
          casoIdentificador: caso.identificador,
        })
        .from(laudoVersao)
        .innerJoin(laudo, eq(laudo.id, laudoVersao.laudoId))
        .innerJoin(caso, eq(caso.id, laudo.casoId))
        .where(
          and(
            eq(laudoVersao.tenantId, ctx.tenantId),
            eq(laudoVersao.id, versaoId),
            eq(caso.clienteId, clienteId),
          ),
        )
        .limit(1);

      if (!linha || !linha.assinadaEm || !linha.liberadoEm || !linha.pdfChave) {
        // Mesma resposta para "nao existe", "nao e seu" e "ainda nao liberado":
        // distinguir revelaria a existencia do documento (secao 5).
        throw new NotFoundException('Laudo não disponível.');
      }

      /**
       * Secao 22: o acesso ao laudo pelo Portal e registrado - quem viu, quando.
       * A auditoria completa e do M22; aqui so se garante que o rastro existe.
       */
      await this.auditoria.registrar(tx, {
        entidade: 'laudo_versao',
        entidadeId: versaoId,
        acao: 'baixar_portal',
        casoId: linha.casoId,
        valorNovo: { versao: linha.versao },
      });

      return {
        bytes: await this.storage.criar().baixar(linha.pdfChave),
        nomeArquivo: `${linha.casoIdentificador}-v${linha.versao}.pdf`,
      };
    });
  }

  // --- internos --------------------------------------------------------------

  /**
   * Confirma que o caso e do cliente da conta.
   *
   * Repetido em toda escrita de proposito: a leitura ja filtra na consulta, mas
   * escrita que so valida "existe" aceitaria o id de outro cliente (secao 5).
   */
  private async exigirCasoDoCliente(
    tx: Transacao,
    casoId: string,
    clienteId: string,
  ): Promise<void> {
    const ctx = exigirContexto();

    const [registro] = await tx
      .select({ id: caso.id })
      .from(caso)
      .where(
        and(
          eq(caso.tenantId, ctx.tenantId),
          eq(caso.id, casoId),
          eq(caso.clienteId, clienteId),
        ),
      )
      .limit(1);

    if (!registro) throw new NotFoundException('Exame não encontrado.');
  }
}
