import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  amostra,
  caso,
  cassete,
  lesaoMacroscopica,
  macroscopia,
  margemMacroscopica,
  servico,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  identificadorCassete,
  motivoBancadaBloqueada,
  type CorCassete,
  type CorMargem,
  type FixacaoMacroscopia,
  type Lateralidade,
  type MetodoAmostragem,
  comporDescricaoMacro,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { CopilotoFactory } from '../../core/ia/copiloto.provider.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { SugestoesService } from '../../core/ia/sugestoes.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { OrdensService } from '../m20-ordens/ordens.service.js';
import { SolicitacoesService } from '../m10-solicitacoes/solicitacoes.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosMacroscopia {
  descricaoTexto?: string;
  caracteristicas?: Record<string, unknown>;
  comprimentoCm?: number;
  larguraCm?: number;
  alturaCm?: number;
  pesoG?: number;
  /** Quinta revisao: "Em conjunto" - varios fragmentos medidos como um monte. */
  medidasEmConjunto?: boolean;
  /** Quinta revisao: Adequada | Parcial | Inadequada, vista ao abrir o pote. */
  fixacao?: FixacaoMacroscopia;
  materialTotalmenteIncluido?: boolean;
  lesoes?: Array<{
    rotulo: string;
    tipo?: string;
    localizacao?: string;
    lateralidade?: Lateralidade;
    maiorEixoCm?: number;
    menorEixoCm?: number;
    terceiroEixoCm?: number;
    /** Terceira revisao: a macro desta lesao - bloquinhos marcados e o texto. */
    caracteristicas?: Record<string, unknown>;
    descricaoTexto?: string | null;
  }>;
  margens?: Array<{
    nome: string;
    metodoAmostragem?: MetodoAmostragem;
    distanciaCm?: number;
    tinta?: Record<string, unknown>;
    /** Quinta revisao: a cor da tinta, como valor proprio. */
    cor?: CorMargem | null;
    naoAvaliavel?: boolean;
    /** Rotulo da lesao a que a margem pertence (L01...). */
    lesaoRotulo?: string | null;
  }>;
  cassetes?: Array<{
    tecidoOrigem: string;
    descricao?: string;
    exigeDescalcificacao?: boolean;
    fragmentos?: number;
    /** Quinta revisao: a cor do cassete, para separar na bateria. */
    cor?: CorCassete;
    /** Quinta revisao: "Mesmo cassete" - divide o cassete com outra lesao. */
    compartilhado?: boolean;
    /** Rotulo da lesao de onde o cassete saiu (L01...). */
    lesaoRotulo?: string | null;
  }>;
}

/**
 * M08 - Macroscopia.
 *
 * Finalidade do modulo: "transformar uma peca anatomica em representacao
 * estruturada, mensuravel, fotografada e amostrada".
 *
 * Uma ficha por AMOSTRA, nao por caso. Campos estruturados e texto livre
 * coexistem - exigencia explicita, um nao substitui o outro.
 */
@Injectable()
export class MacroscopiaService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly fluxo: FluxoService,
    private readonly guardian: GuardianService,
    private readonly sugestoes: SugestoesService,
    private readonly copiloto: CopilotoFactory,
    private readonly ordens: OrdensService,
    private readonly solicitacoes: SolicitacoesService,
  ) {}

  async iniciar(amostraId: string): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const alvo = await this.buscarAmostra(tx, amostraId);

      /**
       * M05 -> M06 -> M08: a bancada so recebe material que o laboratorio
       * registrou ter recebido e que passou pela triagem.
       *
       * Antes daqui a checagem olhava so o resultado da triagem, e por isso
       * deixava passar o caso em que ela **nunca aconteceu** - resultado nulo
       * nao e "bloqueado". Dava para descrever e encassetar material recem
       * cadastrado, sem recebimento nem conferencia, quebrando a cadeia de
       * custodia logo no primeiro elo.
       */
      const impedimento = motivoBancadaBloqueada(
        await this.estadoPreAnalitico(tx, alvo.casoId, alvo.resultadoTriagem),
        'macroscopia',
      );
      if (impedimento) throw new BadRequestException(impedimento);

      const [existente] = await tx
        .select({ id: macroscopia.id })
        .from(macroscopia)
        .where(
          and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.amostraId, amostraId)),
        )
        .limit(1);

      if (existente) return { id: existente.id };

      const [nova] = await tx
        .insert(macroscopia)
        .values({
          tenantId: ctx.tenantId,
          casoId: alvo.casoId,
          amostraId,
          iniciadaEm: new Date(),
          executadaPorId: ctx.usuarioId,
        })
        .returning({ id: macroscopia.id });

      await this.eventos.publicar(tx, {
        tipo: 'macroscopia.iniciada',
        casoId: alvo.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        objetoTipo: 'amostra',
        objetoId: amostraId,
      });

      await this.fluxo.processarEvento(tx, alvo.casoId, 'macroscopia.iniciada');

      return { id: nova!.id };
    });
  }

  async salvar(macroscopiaId: string, dados: DadosMacroscopia): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const registro = await this.buscarMacroscopia(tx, macroscopiaId);

      if (registro.concluidaEm) {
        // M08: alteracao apos a conclusao tem controle especial e permissao
        // propria (`macroscopia:alterar_apos_conclusao`).
        throw new BadRequestException(
          'Macroscopia já concluída. Use a rota de alteração pós-conclusão.',
        );
      }

      await tx
        .update(macroscopia)
        .set({
          descricaoTexto: dados.descricaoTexto ?? registro.descricaoTexto,
          caracteristicas: dados.caracteristicas ?? registro.caracteristicas,
          comprimentoCm: dados.comprimentoCm?.toString() ?? registro.comprimentoCm,
          larguraCm: dados.larguraCm?.toString() ?? registro.larguraCm,
          alturaCm: dados.alturaCm?.toString() ?? registro.alturaCm,
          pesoG: dados.pesoG?.toString() ?? registro.pesoG,
          medidasEmConjunto: dados.medidasEmConjunto ?? registro.medidasEmConjunto,
          fixacao: dados.fixacao ?? registro.fixacao,
          materialTotalmenteIncluido:
            dados.materialTotalmenteIncluido ?? registro.materialTotalmenteIncluido,
          atualizadoEm: new Date(),
        })
        .where(eq(macroscopia.id, macroscopiaId));

      /**
       * Lesao e margem sao identificadas pelo rotulo/nome dentro da ficha, e o
       * conflito nesse par significa "esta e a mesma lesao", nao "ja existe,
       * ignore". Enquanto a macroscopia nao esta concluida ela e rascunho: uma
       * medida corrigida precisa gravar. Ignorar o conflito faria a correcao
       * sumir sem aviso - o salvamento responderia sucesso sem ter salvo nada.
       */
      if (dados.lesoes) {
        for (const l of dados.lesoes) {
          await tx
            .insert(lesaoMacroscopica)
            .values({
              tenantId: ctx.tenantId,
              macroscopiaId,
              rotulo: l.rotulo,
              tipo: l.tipo ?? null,
              localizacao: l.localizacao ?? null,
              lateralidade: l.lateralidade ?? 'nao_aplicavel',
              maiorEixoCm: l.maiorEixoCm?.toString() ?? null,
              menorEixoCm: l.menorEixoCm?.toString() ?? null,
              terceiroEixoCm: l.terceiroEixoCm?.toString() ?? null,
              caracteristicas: l.caracteristicas ?? {},
              descricaoTexto: l.descricaoTexto ?? null,
            })
            .onConflictDoUpdate({
              target: [lesaoMacroscopica.macroscopiaId, lesaoMacroscopica.rotulo],
              set: {
                tipo: l.tipo ?? null,
                localizacao: l.localizacao ?? null,
                lateralidade: l.lateralidade ?? 'nao_aplicavel',
                maiorEixoCm: l.maiorEixoCm?.toString() ?? null,
                menorEixoCm: l.menorEixoCm?.toString() ?? null,
                terceiroEixoCm: l.terceiroEixoCm?.toString() ?? null,
                ...(l.caracteristicas !== undefined ? { caracteristicas: l.caracteristicas } : {}),
                ...(l.descricaoTexto !== undefined ? { descricaoTexto: l.descricaoTexto } : {}),
                atualizadoEm: new Date(),
              },
            });
        }
      }

      // Terceira revisao: margem e cassete apontam para a lesao pelo rotulo.
      const lesaoPorRotulo = new Map(
        (
          await tx
            .select({ id: lesaoMacroscopica.id, rotulo: lesaoMacroscopica.rotulo })
            .from(lesaoMacroscopica)
            .where(eq(lesaoMacroscopica.macroscopiaId, macroscopiaId))
        ).map((l) => [l.rotulo, l.id]),
      );
      const lesaoDe = (rotulo?: string | null) => {
        if (!rotulo) return null;
        const id = lesaoPorRotulo.get(rotulo);
        if (!id) throw new BadRequestException(`Lesão "${rotulo}" não existe nesta ficha.`);
        return id;
      };

      if (dados.margens) {
        for (const m of dados.margens) {
          await tx
            .insert(margemMacroscopica)
            .values({
              tenantId: ctx.tenantId,
              macroscopiaId,
              nome: m.nome,
              // M13: o metodo importa para interpretar a distancia depois.
              metodoAmostragem: m.metodoAmostragem ?? null,
              distanciaCm: m.distanciaCm?.toString() ?? null,
              tinta: m.tinta ?? null,
              cor: m.cor ?? null,
              naoAvaliavel: m.naoAvaliavel ?? false,
              lesaoId: lesaoDe(m.lesaoRotulo ?? null),
            })
            .onConflictDoUpdate({
              target: [margemMacroscopica.macroscopiaId, margemMacroscopica.nome],
              set: {
                metodoAmostragem: m.metodoAmostragem ?? null,
                distanciaCm: m.distanciaCm?.toString() ?? null,
                tinta: m.tinta ?? null,
                // `undefined` mantem a cor; `null` apaga.
                ...(m.cor !== undefined ? { cor: m.cor } : {}),
                naoAvaliavel: m.naoAvaliavel ?? false,
                // `undefined` mantem a lesao; `null` desliga.
                ...(m.lesaoRotulo !== undefined ? { lesaoId: lesaoDe(m.lesaoRotulo) } : {}),
                atualizadoEm: new Date(),
              },
            });
        }
      }

      if (dados.cassetes?.length) {
        await this.gerarCassetes(
          tx,
          registro,
          dados.cassetes.map((c) => ({ ...c, lesaoId: lesaoDe(c.lesaoRotulo) })),
        );
      }
    });
  }

  /**
   * Conclusao da macroscopia.
   *
   * M08: residente e tecnico em treinamento executam, mas **nao concluem sem
   * aprovacao**. Por isso a checagem de `exigeSupervisao` acontece aqui, alem
   * da permissao no controller.
   */
  async concluir(macroscopiaId: string): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const registro = await this.buscarMacroscopia(tx, macroscopiaId);

      if (registro.concluidaEm) {
        throw new BadRequestException('Macroscopia já concluída.');
      }

      if (ctx.exigeSupervisao) {
        throw new ForbiddenException(
          'Perfil em supervisão não conclui macroscopia. É necessária aprovação de um responsável.',
        );
      }

      const achados = await this.guardian.verificarConclusaoMacroscopia(tx, macroscopiaId);
      await this.sugestoes.registrarAchadosGuardian(
        tx,
        achados,
        registro.casoId,
        'conclusao_macroscopia',
      );
      this.guardian.garantirSemBloqueio(achados, 'concluir macroscopia');

      await tx
        .update(macroscopia)
        .set({ concluidaEm: new Date(), atualizadoEm: new Date() })
        .where(eq(macroscopia.id, macroscopiaId));

      const cassetes = await tx
        .select({ identificador: cassete.identificador })
        .from(cassete)
        .where(
          and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.macroscopiaId, macroscopiaId)),
        );

      await this.eventos.publicar(tx, {
        tipo: 'cassetes.gerados',
        casoId: registro.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        payload: { cassetes: cassetes.map((c) => c.identificador) },
      });

      await this.eventos.publicar(tx, {
        tipo: 'macroscopia.concluida',
        casoId: registro.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        objetoTipo: 'amostra',
        objetoId: registro.amostraId,
        payload: { totalCassetes: cassetes.length },
      });

      await this.fluxo.processarEvento(tx, registro.casoId, 'macroscopia.concluida');

      /**
       * Segunda review: "finalizou a macroscopia, pode fechar a OS e gerar
       * fatura" - so aqui se sabe quantas pecas sao. O M20 decide se todas as
       * amostras do caso ja passaram (idempotente para o recorte).
       */
      await this.ordens.marcarFaturavelSeCompleta(tx, registro.casoId);
    });
  }

  /**
   * Recorte: o patologista leu a lamina e a amostragem nao foi representativa.
   *
   * O que a review fixou: (1) volta-se ao material remanescente e faz-se
   * NOVA macroscopia da mesma amostra; (2) o cliente nao paga - "o erro foi
   * nosso" - mas o retrabalho CONSTA na OS, com valor zero, para o fechamento
   * do mes enxergar o custo; (3) "o espaco para liberacao do laudo e o mesmo":
   * o prazo nao reinicia, nada e suspenso.
   *
   * Reabrir a ficha (em vez de criar outra) mantem uma macroscopia por
   * amostra; a historia fica na linha do tempo - concluida, recorte
   * solicitado, concluida de novo - que e onde o M07 manda a historia ficar.
   * Os cassetes ja gerados sao objetos fisicos e permanecem; os novos entram
   * na segunda conclusao.
   */
  async solicitarRecorte(
    amostraId: string,
    motivo: string,
  ): Promise<{ solicitacaoId: string; identificador: string }> {
    const ctx = exigirContexto();
    if (!motivo.trim()) {
      throw new BadRequestException(
        'Recorte exige motivo: é ele que explica, no fechamento do mês, o custo não cobrado.',
      );
    }

    return this.db.executar(async (tx) => {
      const [registro] = await tx
        .select({
          id: macroscopia.id,
          casoId: macroscopia.casoId,
          concluidaEm: macroscopia.concluidaEm,
          amostraIdentificador: amostra.identificador,
        })
        .from(macroscopia)
        .innerJoin(amostra, eq(amostra.id, macroscopia.amostraId))
        .where(and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.amostraId, amostraId)))
        .limit(1);
      if (!registro) throw new NotFoundException('A amostra ainda não tem macroscopia.');
      if (!registro.concluidaEm) {
        throw new BadRequestException(
          'A macroscopia desta amostra ainda está aberta — não há o que recortar.',
        );
      }

      await tx
        .update(macroscopia)
        .set({ concluidaEm: null, atualizadoEm: new Date() })
        .where(eq(macroscopia.id, registro.id));

      // M10 e dono da demanda: o pedido vira solicitacao, com numero e rastro.
      const solicitacao = await this.solicitacoes.criarEmTransacao(tx, {
        casoId: registro.casoId,
        tipo: 'recorte',
        descricao: `Recorte da amostra ${registro.amostraIdentificador}: ${motivo.trim()}`,
        justificativa: 'Amostragem não representativa — retrabalho do laboratório, sem cobrança.',
        objetoTipo: 'amostra',
        objetoId: amostraId,
        setorResponsavel: 'macroscopia',
      });

      await this.ordens.registrarRetrabalho(
        tx,
        registro.casoId,
        `Recorte — amostra ${registro.amostraIdentificador} (${solicitacao.identificador})`,
      );

      await this.eventos.publicar(tx, {
        tipo: 'macroscopia.recorte_solicitado',
        casoId: registro.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        objetoTipo: 'amostra',
        objetoId: amostraId,
        payload: { motivo: motivo.trim(), solicitacao: solicitacao.identificador },
      });

      // Sem `processarEvento` e sem suspensao de prazo, de proposito.
      return { solicitacaoId: solicitacao.id, identificador: solicitacao.identificador };
    });
  }

  /**
   * Ficha da amostra, ou `null` se a macroscopia ainda nao foi iniciada.
   *
   * Precisa ser um GET separado do `iniciar`: abrir a tela nao pode publicar
   * `macroscopia.iniciada` nem mover o fluxo. Quem inicia e o profissional,
   * quando pega a peca - nao o navegador ao carregar a pagina.
   */
  async buscarPorAmostra(amostraId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [ficha] = await tx
        .select()
        .from(macroscopia)
        .where(
          and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.amostraId, amostraId)),
        )
        .limit(1);

      if (!ficha) return null;

      const [lesoes, margens, cassetes] = await Promise.all([
        tx
          .select()
          .from(lesaoMacroscopica)
          .where(eq(lesaoMacroscopica.macroscopiaId, ficha.id))
          .orderBy(asc(lesaoMacroscopica.rotulo)),
        tx
          .select()
          .from(margemMacroscopica)
          .where(eq(margemMacroscopica.macroscopiaId, ficha.id))
          .orderBy(asc(margemMacroscopica.nome)),
        tx
          .select()
          .from(cassete)
          .where(eq(cassete.macroscopiaId, ficha.id))
          .orderBy(asc(cassete.ordem)),
      ]);

      return {
        id: ficha.id,
        casoId: ficha.casoId,
        amostraId: ficha.amostraId,
        descricaoTexto: ficha.descricaoTexto,
        comprimentoCm: ficha.comprimentoCm,
        larguraCm: ficha.larguraCm,
        alturaCm: ficha.alturaCm,
        pesoG: ficha.pesoG,
        medidasEmConjunto: ficha.medidasEmConjunto,
        fixacao: ficha.fixacao,
        materialTotalmenteIncluido: ficha.materialTotalmenteIncluido,
        resumoFinal: ficha.resumoFinal,
        resumoSalvoEm: ficha.resumoSalvoEm,
        iniciadaEm: ficha.iniciadaEm,
        concluidaEm: ficha.concluidaEm,
        lesoes: lesoes.map((l) => ({
          id: l.id,
          rotulo: l.rotulo,
          tipo: l.tipo,
          localizacao: l.localizacao,
          lateralidade: l.lateralidade,
          maiorEixoCm: l.maiorEixoCm,
          menorEixoCm: l.menorEixoCm,
          terceiroEixoCm: l.terceiroEixoCm,
          caracteristicas: l.caracteristicas,
          descricaoTexto: l.descricaoTexto,
        })),
        margens: margens.map((m) => ({
          nome: m.nome,
          lesaoRotulo: lesoes.find((l) => l.id === m.lesaoId)?.rotulo ?? null,
          metodoAmostragem: m.metodoAmostragem,
          distanciaCm: m.distanciaCm,
          cor: m.cor,
          naoAvaliavel: m.naoAvaliavel,
        })),
        cassetes: cassetes.map((c) => ({
          id: c.id,
          identificador: c.identificador,
          tecidoOrigem: c.tecidoOrigem,
          descricao: c.descricao,
          exigeDescalcificacao: c.exigeDescalcificacao,
          fragmentos: c.fragmentos,
          cor: c.cor,
          compartilhado: c.compartilhado,
          lesaoRotulo: lesoes.find((l) => l.id === c.lesaoId)?.rotulo ?? null,
        })),
      };
    });
  }

  /**
   * O quadro final da macroscopia, revisado e salvo.
   *
   * Quinta revisao: "ao finalizar a macroscopia, aparece quadro com todas as
   * informacoes da macro, Texto, cores, no de cassetes, no de fragmentos,
   * margens... Todas as informacoes sao editaveis nesse quadro. O sistema
   * salva a data, horario e usuario que fez aquela macroscopia. Essas
   * informacoes ficam salvas na aba de rastreio."
   *
   * Por que uma rota propria, e nao mais um campo do `salvar`: este texto e o
   * que a pessoa CONFERIU, e o registro de quem conferiu e quando so vale se
   * for gravado no mesmo ato. Passar junto com o rascunho tornaria "salvo por"
   * um carimbo de qualquer digitada.
   *
   * Aceita depois da conclusao de proposito: a revisao do texto acontece
   * exatamente no fim, e o que a conclusao congela e a amostragem - os
   * cassetes, que ja viraram objeto fisico -, nao a redacao.
   */
  async salvarResumo(macroscopiaId: string, texto: string): Promise<{ salvoEm: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const registro = await this.buscarMacroscopia(tx, macroscopiaId);
      const salvoEm = new Date();

      await tx
        .update(macroscopia)
        .set({
          resumoFinal: texto.trim() || null,
          resumoSalvoEm: salvoEm,
          resumoSalvoPorId: ctx.usuarioId,
          atualizadoEm: salvoEm,
        })
        .where(eq(macroscopia.id, macroscopiaId));

      /**
       * Na aba de rastreio, como o documento pede: o evento carrega quem
       * salvou e quando, e a linha do tempo do caso ja e essa aba.
       */
      await this.eventos.publicar(tx, {
        tipo: 'macroscopia.resumo_salvo',
        casoId: registro.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        objetoTipo: 'amostra',
        objetoId: registro.amostraId,
        payload: { por: ctx.nomeCompleto, caracteres: texto.trim().length },
      });

      await this.auditoria.registrarAlteracao(
        tx,
        'macroscopia',
        macroscopiaId,
        { resumoFinal: registro.resumoFinal },
        { resumoFinal: texto.trim() || null },
      );

      return { salvoEm: salvoEm.toISOString() };
    });
  }

  /**
   * Cassetes do caso.
   *
   * O tecnico precisa desta lista para montar o lote de envio ao laboratorio de
   * apoio (M09), e o laboratorio precisa dela para conferir o recebimento.
   */
  async listarCassetes(casoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) =>
      tx
        .select({
          id: cassete.id,
          identificador: cassete.identificador,
          amostraId: cassete.amostraId,
          tecidoOrigem: cassete.tecidoOrigem,
          exigeDescalcificacao: cassete.exigeDescalcificacao,
          statusTecnico: cassete.statusTecnico,
          fragmentos: cassete.fragmentos,
        })
        .from(cassete)
        .where(and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.casoId, casoId)))
        .orderBy(asc(cassete.ordem)),
    );
  }

  // --- internos ------------------------------------------------------------

  private async gerarCassetes(
    tx: Transacao,
    registro: { id: string; casoId: string; amostraId: string },
    novos: Array<NonNullable<DadosMacroscopia['cassetes']>[number] & { lesaoId?: string | null }>,
  ): Promise<void> {
    const ctx = exigirContexto();

    const [alvo] = await tx
      .select({ letra: amostra.letra })
      .from(amostra)
      .where(eq(amostra.id, registro.amostraId))
      .limit(1);

    const [dadosCaso] = await tx
      .select({ identificador: caso.identificador })
      .from(caso)
      .where(eq(caso.id, registro.casoId))
      .limit(1);

    const existentes = await tx
      .select({ id: cassete.id })
      .from(cassete)
      .where(and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.macroscopiaId, registro.id)));

    let ordem = existentes.length;

    for (const c of novos) {
      // M08: "cada cassete deve ter tecido de origem identificado". Recusar
      // aqui evita produzir material irrastreavel no processamento.
      if (!c.tecidoOrigem?.trim()) {
        throw new BadRequestException('Cassete sem tecido de origem não pode ser criado.');
      }

      ordem++;
      await tx.insert(cassete).values({
        tenantId: ctx.tenantId,
        casoId: registro.casoId,
        amostraId: registro.amostraId,
        macroscopiaId: registro.id,
        identificador: identificadorCassete(
          dadosCaso!.identificador,
          alvo!.letra,
          ordem,
        ),
        ordem,
        tecidoOrigem: c.tecidoOrigem,
        descricao: c.descricao ?? null,
        exigeDescalcificacao: c.exigeDescalcificacao ?? false,
        fragmentos: c.fragmentos ?? null,
        cor: c.cor ?? null,
        compartilhado: c.compartilhado ?? false,
        lesaoId: c.lesaoId ?? null,
      });
    }
  }

  /**
   * Estado pre-analitico do caso, do jeito que `motivoBancadaBloqueada` espera.
   *
   * O resultado da triagem vem da amostra quando existe: a bancada trabalha uma
   * amostra por vez, e uma amostra bloqueada nao entra mesmo que o caso tenha
   * sido liberado no agregado (M06 secao 41).
   */
  /**
   * Compoe o texto corrido a partir dos bloquinhos marcados (review: "as
   * opcoes ja carregadas como botoes... e a IA faz o texto corrido no final").
   *
   * A base deterministica vem do shared e ja e publicavel; o Copiloto, quando
   * ha provedor com `redigir`, apenas lapida. Qualquer falha da IA devolve a
   * base - a bancada nunca espera (M17 secao 110).
   */
  async comporDescricao(
    macroscopiaId: string,
    selecoes: Record<string, string[]>,
    lesaoRotulo?: string | null,
  ): Promise<{ texto: string; origem: 'ia' | 'padrao' }> {
    // Medidas sozinhas nao sao descricao: exige ao menos um bloquinho marcado.
    if (Object.values(selecoes).every((v) => v.filter((s) => s.trim()).length === 0)) {
      throw new BadRequestException('Marque ao menos um descritor para compor a descrição.');
    }

    const registro = await this.db.executar((tx) => this.buscarMacroscopia(tx, macroscopiaId));

    /**
     * Terceira revisao: a frase de uma lesao leva as medidas DELA (os tres
     * eixos), nao as da peca inteira. Sem rotulo, e a frase da peca.
     */
    let medidas = {
      comprimentoCm: registro.comprimentoCm ? Number(registro.comprimentoCm) : undefined,
      larguraCm: registro.larguraCm ? Number(registro.larguraCm) : undefined,
      alturaCm: registro.alturaCm ? Number(registro.alturaCm) : undefined,
      pesoG: registro.pesoG ? Number(registro.pesoG) : undefined,
      emConjunto: registro.medidasEmConjunto,
    };
    if (lesaoRotulo) {
      const [lesao] = await this.db.executar((tx) =>
        tx
          .select()
          .from(lesaoMacroscopica)
          .where(
            and(eq(lesaoMacroscopica.macroscopiaId, macroscopiaId), eq(lesaoMacroscopica.rotulo, lesaoRotulo)),
          )
          .limit(1),
      );
      if (!lesao) throw new BadRequestException(`Lesão "${lesaoRotulo}" não existe nesta ficha.`);
      medidas = {
        comprimentoCm: lesao.maiorEixoCm ? Number(lesao.maiorEixoCm) : undefined,
        larguraCm: lesao.menorEixoCm ? Number(lesao.menorEixoCm) : undefined,
        alturaCm: lesao.terceiroEixoCm ? Number(lesao.terceiroEixoCm) : undefined,
        pesoG: undefined,
        // "Em conjunto" é da peça, não do nódulo: um nódulo é um só.
        emConjunto: false,
      };
    }

    /**
     * A fixação entra só na frase da PEÇA. Repeti-la em cada lesão encheria o
     * laudo de "fixação adequada" — ela é uma ressalva sobre o material que
     * chegou, e não sobre cada nódulo descrito.
     */
    const base = comporDescricaoMacro(selecoes, medidas, lesaoRotulo ? null : registro.fixacao);
    if (!base) {
      throw new BadRequestException('Marque ao menos um descritor para compor a descrição.');
    }

    const provedor = this.copiloto.criar();
    const lapidado = provedor.redigir
      ? await provedor.redigir(
          'Reescreva a base como uma descrição macroscópica corrida, fluida e concisa, ' +
            'mantendo todos os achados e medidas exatamente como estão.',
          base,
        )
      : null;

    return lapidado ? { texto: lapidado, origem: 'ia' } : { texto: base, origem: 'padrao' };
  }

  private async estadoPreAnalitico(
    tx: Transacao,
    casoId: string,
    resultadoDaAmostra: string | null,
  ) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select({
        recebidoEm: caso.recebidoEm,
        triadoEm: caso.triadoEm,
        resultadoTriagem: caso.resultadoTriagem,
        exigeTriagem: servico.exigeTriagem,
      })
      .from(caso)
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Caso não encontrado.');

    return {
      recebidoEm: registro.recebidoEm,
      triadoEm: registro.triadoEm,
      resultadoTriagem: resultadoDaAmostra ?? registro.resultadoTriagem,
      exigeTriagem: registro.exigeTriagem,
    };
  }

  private async buscarAmostra(tx: Transacao, amostraId: string) {
    const ctx = exigirContexto();
    const [alvo] = await tx
      .select()
      .from(amostra)
      .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.id, amostraId)))
      .limit(1);

    if (!alvo) throw new NotFoundException('Amostra não encontrada.');
    return alvo;
  }

  private async buscarMacroscopia(tx: Transacao, macroscopiaId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(macroscopia)
      .where(and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.id, macroscopiaId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Macroscopia não encontrada.');
    return registro;
  }
}
