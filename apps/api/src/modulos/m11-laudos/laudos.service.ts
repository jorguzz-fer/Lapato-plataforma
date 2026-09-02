import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  amostra,
  avaliacaoCitologica,
  imagem,
  imagemVersao,
  assinaturaProfissional,
  caso,
  cliente,
  diagnostico,
  laudo,
  laudoVersao,
  margemMicroscopica,
  paciente,
  revisaoLaudo,
  notificacaoPendente,
  servico,
  tenant,
  termo,
  usuario,
  veterinario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  PERMISSOES,
  TIPO_COLETA_CITOLOGICA,
  motivoBancadaBloqueada,
  type Lateralidade,
  type ResultadoMargem,
  type TipoVersaoLaudo,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { SugestoesService } from '../../core/ia/sugestoes.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';
import { ENV, type Env } from '../../core/config/env.js';
import { StorageFactory } from '../../core/storage/storage.provider.js';
import { LaudoPdfService, type DadosLaudoPdf } from './laudo-pdf.service.js';
import { CitopatologiaService } from '../m12-citopatologia/citopatologia.service.js';

/** Rotulo legivel do metodo de coleta, para o documento entregue (M12 secao 5). */
const ROTULO_COLETA: Record<string, string> = Object.fromEntries(
  TIPO_COLETA_CITOLOGICA.map((t) => [t.chave, t.rotulo]),
);

export interface DadosLaudo {
  descricaoMicroscopica?: string;
  comentarios?: string;
  conclusao?: string;
  notaInterna?: string;
  diagnosticos?: Array<{
    amostraId?: string;
    hierarquia?: string;
    processo?: string;
    entidade?: string;
    comportamento?: string;
    distribuicao?: string;
    severidade?: string;
    lateralidade?: Lateralidade;
    textoExibido: string;
    classificacaoNome?: string;
    classificacaoVersao?: string;
    grau?: string;
    criteriosGraduacao?: Record<string, unknown>;
    provisorio?: boolean;
  }>;
  margens?: Array<{
    nome: string;
    resultado: ResultadoMargem;
    distanciaMm?: number;
    observacoes?: string;
  }>;
}

/**
 * M11 - Laudos e Microscopia (+ M13 para a estrutura histopatologica).
 *
 * ADR 0005 / M11 secoes 118-119: **o PDF nao e o laudo primario**. O laudo e o
 * conjunto estruturado e versionado de dados; o PDF e a representacao
 * documental derivada.
 *
 * M11: adendo != correcao. Adendo acrescenta, correcao retifica. Ambos criam
 * versao nova e preservam a anterior.
 */
@Injectable()
export class LaudosService {
  private readonly logger = new Logger(LaudosService.name);

  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly guardian: GuardianService,
    private readonly sugestoes: SugestoesService,
    private readonly fluxo: FluxoService,
    private readonly storage: StorageFactory,
    private readonly pdf: LaudoPdfService,
    private readonly citopatologia: CitopatologiaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Abre (ou recupera) o laudo do caso e sua versao corrente. */
  /**
   * Laudo do caso, ou `null` quando ainda nao foi aberto.
   *
   * GET separado do `abrir` pela mesma razao da macroscopia: `abrir` publica
   * `microscopia.iniciada` e move o fluxo, e carregar a tela nao pode fazer
   * isso. Quem inicia a microscopia e o patologista, nao o navegador.
   */
  async buscarPorCaso(casoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [registro] = await tx
        .select()
        .from(laudo)
        .where(and(eq(laudo.tenantId, ctx.tenantId), eq(laudo.casoId, casoId)))
        .limit(1);

      if (!registro) return null;

      const corrente = await this.versaoCorrente(tx, registro.id);

      const [diagnosticos, margens, revisoes, versoes] = await Promise.all([
        tx
          .select()
          .from(diagnostico)
          .where(eq(diagnostico.laudoVersaoId, corrente.id))
          .orderBy(asc(diagnostico.ordem)),
        tx
          .select()
          .from(margemMicroscopica)
          .where(eq(margemMicroscopica.laudoVersaoId, corrente.id))
          .orderBy(asc(margemMicroscopica.nome)),
        tx
          .select()
          .from(revisaoLaudo)
          .where(eq(revisaoLaudo.laudoVersaoId, corrente.id))
          .orderBy(desc(revisaoLaudo.criadoEm)),
        tx
          .select({
            versao: laudoVersao.versao,
            tipo: laudoVersao.tipo,
            motivo: laudoVersao.motivo,
            assinadaEm: laudoVersao.assinadaEm,
            substituida: laudoVersao.substituida,
          })
          .from(laudoVersao)
          .where(eq(laudoVersao.laudoId, registro.id))
          .orderBy(asc(laudoVersao.versao)),
      ]);

      return {
        laudoId: registro.id,
        status: registro.status,
        patologistaId: registro.patologistaId,
        liberadoEm: registro.liberadoEm,
        versaoCorrente: {
          id: corrente.id,
          versao: corrente.versao,
          tipo: corrente.tipo,
          motivo: corrente.motivo,
          descricaoMicroscopica: corrente.descricaoMicroscopica,
          comentarios: corrente.comentarios,
          conclusao: corrente.conclusao,
          /**
           * M11: a nota interna tem permissao propria. Quem nao a tem recebe
           * `null` - o campo nao viaja para depois ser escondido na tela.
           */
          notaInterna: ctx.permissoes.has(PERMISSOES.LAUDO_VER_NOTA_INTERNA)
            ? corrente.notaInterna
            : null,
          assinadaEm: corrente.assinadaEm,
          assinaturaIdentificacao: corrente.assinaturaIdentificacao,
          codigoValidacao: corrente.codigoValidacao,
        },
        diagnosticos: diagnosticos.map((d) => ({
          amostraId: d.amostraId,
          hierarquia: d.hierarquia,
          processo: d.processo,
          entidade: d.entidade,
          comportamento: d.comportamento,
          distribuicao: d.distribuicao,
          severidade: d.severidade,
          lateralidade: d.lateralidade,
          textoExibido: d.textoExibido,
          classificacaoNome: d.classificacaoNome,
          classificacaoVersao: d.classificacaoVersao,
          grau: d.grau,
          criteriosGraduacao: d.criteriosGraduacao,
          provisorio: d.provisorio,
        })),
        margens: margens.map((m) => ({
          nome: m.nome,
          resultado: m.resultado,
          distanciaMm: m.distanciaMm,
          observacoes: m.observacoes,
        })),
        revisoes: revisoes.map((r) => ({
          resultado: r.resultado,
          comentarios: r.comentarios,
          discordancia: r.discordancia,
          concluidaEm: r.concluidaEm,
        })),
        versoes,
      };
    });
  }

  async abrir(casoId: string): Promise<{ laudoId: string; versaoId: string; versao: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [existente] = await tx
        .select()
        .from(laudo)
        .where(and(eq(laudo.tenantId, ctx.tenantId), eq(laudo.casoId, casoId)))
        .limit(1);

      if (existente) {
        const versao = await this.versaoCorrente(tx, existente.id);
        return { laudoId: existente.id, versaoId: versao.id, versao: versao.versao };
      }

      /**
       * M05 -> M06 -> M11: nao se abre laudo de material que o laboratorio
       * nunca registrou ter recebido.
       *
       * A checagem so vale para o laudo que **nasce** aqui. Um laudo ja aberto
       * volta pelo caminho de cima sem passar por ela: a precondicao e para
       * comecar, e reaplica-la depois travaria o patologista se alguem mexesse
       * na triagem com o laudo em andamento.
       */
      const impedimento = motivoBancadaBloqueada(
        await this.estadoPreAnalitico(tx, casoId),
        'microscopia',
      );
      if (impedimento) throw new BadRequestException(impedimento);

      const [novo] = await tx
        .insert(laudo)
        .values({
          tenantId: ctx.tenantId,
          casoId,
          patologistaId: ctx.usuarioId,
          status: 'rascunho',
        })
        .returning();

      const [versao] = await tx
        .insert(laudoVersao)
        .values({
          tenantId: ctx.tenantId,
          laudoId: novo!.id,
          versao: 1,
          tipo: 'original',
          criadaPorId: ctx.usuarioId,
        })
        .returning();

      await this.eventos.publicar(tx, {
        tipo: 'microscopia.iniciada',
        casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
      });

      return { laudoId: novo!.id, versaoId: versao!.id, versao: 1 };
    });
  }

  /** Salva o conteudo estruturado da versao corrente. */
  async salvar(versaoId: string, dados: DadosLaudo): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      // M11: depois de assinado, o conteudo nao e livremente editavel. Mudanca
      // exige adendo ou correcao, que criam nova versao.
      if (versao.assinadaEm) {
        throw new BadRequestException(
          'Versão já assinada. Crie um adendo ou uma correção para alterar o laudo.',
        );
      }

      await tx
        .update(laudoVersao)
        .set({
          descricaoMicroscopica: dados.descricaoMicroscopica ?? versao.descricaoMicroscopica,
          comentarios: dados.comentarios ?? versao.comentarios,
          conclusao: dados.conclusao ?? versao.conclusao,
          notaInterna: dados.notaInterna ?? versao.notaInterna,
          conteudo: {
            ...versao.conteudo,
            descricaoMicroscopica: dados.descricaoMicroscopica ?? versao.descricaoMicroscopica,
            comentarios: dados.comentarios ?? versao.comentarios,
            conclusao: dados.conclusao ?? versao.conclusao,
          },
          atualizadoEm: new Date(),
        })
        .where(eq(laudoVersao.id, versaoId));

      if (dados.diagnosticos) {
        // Substitui o conjunto da versao. O historico nao se perde: versoes
        // anteriores continuam intactas (ADR 0005).
        await tx.delete(diagnostico).where(eq(diagnostico.laudoVersaoId, versaoId));

        /**
         * Lista vazia e estado legitimo, nao erro: o rascunho comeca sem
         * diagnostico, e no laudo citologico a morfologia e escrita antes de
         * existir conclusao. Sem esta guarda, o `insert` sem valores estourava
         * 500 - o que acontecia em toda gravacao de rascunho ainda sem
         * diagnostico, inclusive na histopatologia.
         */
        if (dados.diagnosticos.length > 0)
          await tx.insert(diagnostico).values(
            dados.diagnosticos.map((d, i) => ({
              tenantId: ctx.tenantId,
              laudoVersaoId: versaoId,
              amostraId: d.amostraId ?? null,
              ordem: i,
              hierarquia: d.hierarquia ?? 'principal',
              processo: d.processo ?? null,
              entidade: d.entidade ?? null,
              comportamento: d.comportamento ?? null,
              distribuicao: d.distribuicao ?? null,
              severidade: d.severidade ?? null,
              lateralidade: d.lateralidade ?? 'nao_aplicavel',
              textoExibido: d.textoExibido,
              classificacaoNome: d.classificacaoNome ?? null,
              // M11 secao 42: a versao da classificacao fica congelada no caso.
              classificacaoVersao: d.classificacaoVersao ?? null,
              grau: d.grau ?? null,
              // M13 secao 120: guardar apenas o escore final e proibido.
              criteriosGraduacao: d.criteriosGraduacao ?? null,
              provisorio: d.provisorio ?? false,
            })),
          );
      }

      if (dados.margens) {
        await tx.delete(margemMicroscopica).where(eq(margemMicroscopica.laudoVersaoId, versaoId));
        if (dados.margens.length > 0)
          await tx.insert(margemMicroscopica).values(
            dados.margens.map((m) => ({
              tenantId: ctx.tenantId,
              laudoVersaoId: versaoId,
              nome: m.nome,
              resultado: m.resultado,
              distanciaMm: m.distanciaMm?.toString() ?? null,
              observacoes: m.observacoes ?? null,
            })),
          );
      }

      await this.eventos.publicar(tx, {
        tipo: 'laudo.rascunho_salvo',
        casoId: versao.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: versaoId,
      });
    });
  }

  /** Envia para revisao (M11: varios modelos institucionais de revisao). */
  async enviarParaRevisao(versaoId: string, revisorId?: string): Promise<void> {
    await this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      /**
       * A completude e conferida AQUI, e nao so na assinatura.
       *
       * Antes disto um laudo sem diagnostico atravessava a revisao inteira e so
       * era barrado na assinatura - onde o formulario ja virou leitura. O
       * usuario lia "adicione um diagnostico" numa tela que nao deixava mais
       * adicionar. Barrar na saida da bancada devolve o problema a quem ainda
       * pode resolve-lo, e poupa o revisor de aprovar um texto incompleto.
       *
       * A assinatura profissional nao entra: quem elabora nem sempre e quem
       * assina, e cobrar aqui barraria o residente que so redige.
       */
      const achados = await this.guardian.verificarConteudoLaudo(
        tx,
        versaoId,
        versao.casoId,
      );
      this.guardian.garantirSemBloqueio(achados, 'enviar o laudo para revisão');

      await tx
        .update(laudo)
        .set({ status: 'aguardando_revisao', revisorId: revisorId ?? null })
        .where(eq(laudo.id, versao.laudoId));

      await this.eventos.publicar(tx, {
        tipo: 'laudo.enviado_revisao',
        casoId: versao.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: versaoId,
      });

      await this.fluxo.processarEvento(tx, versao.casoId, 'laudo.enviado_revisao');
    });
  }

  async concluirRevisao(
    versaoId: string,
    resultado: 'aprovada' | 'ajustes_solicitados',
    comentarios?: string,
    discordancia = false,
  ): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      await tx.insert(revisaoLaudo).values({
        tenantId: ctx.tenantId,
        laudoVersaoId: versaoId,
        revisorId: ctx.usuarioId,
        resultado,
        comentarios: comentarios ?? null,
        // M13: discordancia alimenta os indicadores de qualidade do M22.
        discordancia,
        concluidaEm: new Date(),
      });

      await tx
        .update(laudo)
        .set({
          status: resultado === 'aprovada' ? 'aguardando_assinatura' : 'retornado_para_correcao',
        })
        .where(eq(laudo.id, versao.laudoId));

      await this.eventos.publicar(tx, {
        tipo: 'laudo.revisao_concluida',
        casoId: versao.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: versaoId,
        payload: { resultado, discordancia },
      });

      if (resultado === 'aprovada') {
        await this.fluxo.processarEvento(tx, versao.casoId, 'laudo.revisao_concluida');
      }
    });
  }

  /**
   * Devolve a versao aprovada para edicao (M11).
   *
   * Existe porque `aguardando_assinatura` era um beco: o formulario vira
   * leitura para nao editar por baixo do revisor, e nao havia caminho de volta
   * - so o revisor podia devolver, com "solicitar ajustes", e nessa altura ele
   * ja tinha aprovado.
   *
   * Reabrir **invalida a aprovacao**: o laudo volta a rascunho e precisa passar
   * pela revisao de novo. Aprovar e um parecer sobre um texto especifico; se o
   * texto muda, o parecer nao acompanha.
   *
   * Exige motivo pela mesma razao que devolver para correcao exige: o ato
   * desfaz o trabalho de outra pessoa, e o registro precisa dizer por que.
   */
  async reabrirParaEdicao(versaoId: string, motivo: string): Promise<void> {
    await this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      if (versao.assinadaEm) {
        throw new BadRequestException(
          'Versão já assinada. Crie um adendo ou uma correção para alterar o laudo.',
        );
      }

      const [registro] = await tx
        .select({ status: laudo.status })
        .from(laudo)
        .where(eq(laudo.id, versao.laudoId))
        .limit(1);

      if (registro?.status !== 'aguardando_assinatura') {
        throw new BadRequestException(
          'Só um laudo aguardando assinatura pode ser retomado para edição.',
        );
      }

      await tx
        .update(laudo)
        .set({ status: 'rascunho', revisorId: null })
        .where(eq(laudo.id, versao.laudoId));

      await this.auditoria.registrar(tx, {
        entidade: 'laudo_versao',
        entidadeId: versaoId,
        acao: 'reabrir_para_edicao',
        valorAnterior: { status: 'aguardando_assinatura' },
        valorNovo: { status: 'rascunho' },
        justificativa: motivo,
      });

      await this.eventos.publicar(tx, {
        tipo: 'laudo.reaberto_para_edicao',
        casoId: versao.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: versaoId,
        payload: { motivo },
      });
    });
  }

  /**
   * Assinatura (M11 secao 82).
   *
   * Registra patologista, identificacao profissional, data, hora, **versao do
   * documento** e mecanismo de autenticacao.
   *
   * Antes de assinar, roda a checagem consolidada do Guardian. Um achado
   * `critico` - lateralidade divergente, ausencia de diagnostico, assinatura
   * expirada - barra a acao (M17).
   */
  async assinar(
    versaoId: string,
    mecanismo: 'senha' | 'mfa_totp' | 'certificado_digital' = 'senha',
  ): Promise<{ codigoValidacao: string }> {
    const ctx = exigirContexto();

    // M02: administrador nao adquire autoridade tecnica por ser administrador.
    if (!ctx.permissoes.has(PERMISSOES.LAUDO_ASSINAR)) {
      throw new ForbiddenException('Este perfil não pode assinar laudos.');
    }
    if (ctx.exigeSupervisao) {
      throw new ForbiddenException(
        'Perfil em supervisão não assina laudo. É necessária revisão e assinatura do responsável.',
      );
    }

    return this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      if (versao.assinadaEm) throw new BadRequestException('Versão já assinada.');

      const achados = await this.guardian.verificarAssinaturaLaudo(
        tx,
        versaoId,
        versao.casoId,
        ctx.usuarioId,
      );
      await this.sugestoes.registrarAchadosGuardian(tx, achados, versao.casoId, 'assinatura_laudo');
      this.guardian.garantirSemBloqueio(achados, 'assinar laudo');

      const [assinatura] = await tx
        .select()
        .from(assinaturaProfissional)
        .where(
          and(
            eq(assinaturaProfissional.tenantId, ctx.tenantId),
            eq(assinaturaProfissional.usuarioId, ctx.usuarioId),
            eq(assinaturaProfissional.ativa, true),
          ),
        )
        .limit(1);

      // M11: codigo do QR Code de validacao de autenticidade do documento.
      const codigoValidacao = randomBytes(9).toString('base64url').toUpperCase();
      const assinadaEm = new Date();
      const identificacao = assinatura?.identificacaoProfissional ?? null;

      /**
       * O PDF nasce AQUI, dentro da mesma operacao que assina - nunca antes.
       * ADR 0005: "uma versao assinada nunca e regerada com conteudo
       * diferente". Gerar cedo demais correria o risco de gravar bytes que nao
       * refletem a versao que de fato foi assinada, se o Guardian bloqueasse
       * depois da geracao.
       *
       * Se a instituicao ainda nao tiver identificacao profissional cadastrada
       * (`assinatura` nulo), o PDF sai sem o nome do profissional no rodape em
       * vez de falhar a assinatura por um cadastro incompleto - a assinatura em
       * si (quem, quando, versao) ja esta registrada no banco de qualquer jeito.
       */
      const dadosPdf = await this.montarDadosPdf(tx, versaoId, {
        identificacao: identificacao ?? 'Assinatura sem identificação profissional cadastrada',
        assinadaEm,
        codigoValidacao,
      });
      const pdfBytes = await this.pdf.gerar(dadosPdf);
      const chave = `laudos/${ctx.tenantId}/${versaoId}.pdf`;
      const { hash } = await this.storage.criar().salvar(chave, pdfBytes, 'application/pdf');

      await tx
        .update(laudoVersao)
        .set({
          assinadaEm,
          assinadaPorId: ctx.usuarioId,
          assinaturaIdentificacao: identificacao,
          assinaturaMecanismo: mecanismo,
          codigoValidacao,
          pdfChave: chave,
          pdfHash: hash,
        })
        .where(eq(laudoVersao.id, versaoId));

      await tx.update(laudo).set({ status: 'assinado' }).where(eq(laudo.id, versao.laudoId));

      await this.eventos.publicar(tx, {
        tipo: 'laudo.assinado',
        casoId: versao.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: versaoId,
        payload: { versao: versao.versao, mecanismo },
      });

      await this.auditoria.registrar(tx, {
        entidade: 'laudo_versao',
        entidadeId: versaoId,
        acao: 'assinar',
        casoId: versao.casoId,
        valorNovo: { versao: versao.versao, mecanismo },
      });

      return { codigoValidacao };
    });
  }

  /**
   * Liberacao.
   *
   * DIRETRIZES secao 17: o patologista executa apenas "Liberar laudo". Atualizar
   * o fluxo, publicar no Portal, notificar e registrar auditoria sao
   * consequencias automatizadas - e e isso que este metodo dispara.
   */
  async liberar(versaoId: string): Promise<void> {
    const ctx = exigirContexto();

    if (!ctx.permissoes.has(PERMISSOES.LAUDO_LIBERAR)) {
      throw new ForbiddenException('Este perfil não pode liberar laudos.');
    }

    await this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      if (!versao.assinadaEm) {
        throw new BadRequestException('Não é possível liberar um laudo sem assinatura.');
      }

      const agora = new Date();
      const [registro] = await tx.select().from(laudo).where(eq(laudo.id, versao.laudoId)).limit(1);

      await tx
        .update(laudo)
        .set({
          status: 'liberado',
          liberadoEm: agora,
          // M07: reabrir um caso preserva a data da PRIMEIRA liberacao.
          primeiraLiberacaoEm: registro?.primeiraLiberacaoEm ?? agora,
        })
        .where(eq(laudo.id, versao.laudoId));

      await this.eventos.publicar(tx, {
        tipo: 'laudo.liberado',
        casoId: versao.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: versaoId,
        // Visivel ao cliente: e o evento que o Portal exibe.
        visibilidade: 'externo',
        payload: { versao: versao.versao },
      });

      await this.fluxo.processarEvento(tx, versao.casoId, 'laudo.liberado');

      /**
       * DIRETRIZES secao 8.12: o modulo de Laudos NAO envia e-mail nem WhatsApp.
       * Ele apenas enfileira; o M26 identifica destinatarios, escolhe canal,
       * monta a mensagem e registra a entrega.
       */
      await tx.insert(notificacaoPendente).values({
        tenantId: ctx.tenantId,
        casoId: versao.casoId,
        canal: 'email',
        destinatarioTipo: 'veterinario_solicitante',
        assunto: 'Laudo liberado',
        corpo: `O laudo do caso ${versao.casoIdentificador} foi liberado.`,
      });

      await this.auditoria.registrar(tx, {
        entidade: 'laudo',
        entidadeId: versao.laudoId,
        acao: 'liberar',
        casoId: versao.casoId,
        valorNovo: { versao: versao.versao },
      });
    });
  }

  /**
   * Cria adendo ou correcao (M11).
   *
   * A versao anterior e marcada como substituida, nunca apagada - o Portal
   * sinaliza "documento substituido por versao posterior".
   */
  async novaVersao(
    laudoId: string,
    tipo: Exclude<TipoVersaoLaudo, 'original'>,
    motivo: string,
  ): Promise<{ versaoId: string; versao: number }> {
    const ctx = exigirContexto();

    if (!motivo?.trim()) {
      throw new BadRequestException('Adendo e correção exigem motivo.');
    }

    const permissao = tipo === 'adendo' ? PERMISSOES.LAUDO_ADENDO : PERMISSOES.LAUDO_CORRIGIR;
    if (!ctx.permissoes.has(permissao)) {
      throw new ForbiddenException(`Este perfil não pode criar ${tipo} de laudo.`);
    }

    return this.db.executar(async (tx) => {
      const anterior = await this.versaoCorrente(tx, laudoId);

      await tx
        .update(laudoVersao)
        .set({ substituida: true })
        .where(eq(laudoVersao.id, anterior.id));

      const proxima = anterior.versao + 1;

      const [nova] = await tx
        .insert(laudoVersao)
        .values({
          tenantId: ctx.tenantId,
          laudoId,
          versao: proxima,
          tipo,
          motivo,
          // Adendo parte do conteudo anterior; correcao tambem, para o
          // profissional retificar em vez de redigitar tudo.
          conteudo: anterior.conteudo,
          descricaoMicroscopica: anterior.descricaoMicroscopica,
          comentarios: anterior.comentarios,
          conclusao: anterior.conclusao,
          criadaPorId: ctx.usuarioId,
        })
        .returning();

      /**
       * A versao nova herda tambem o que e ESTRUTURADO. So o texto vinha junto,
       * e o resultado era um adendo que nascia sem diagnostico nenhum - o
       * Guardian barrava a assinatura ("o laudo nao possui diagnostico"), e a
       * saida era redigitar o que ja estava assinado na versao anterior. M11 e
       * claro: adendo acrescenta e correcao retifica; nenhum dos dois recomeca.
       *
       * As versoes anteriores continuam intactas: isto e copia, nao mudanca de
       * dono (ADR 0005).
       */
      const diagnosticosAnteriores = await tx
        .select()
        .from(diagnostico)
        .where(eq(diagnostico.laudoVersaoId, anterior.id))
        .orderBy(asc(diagnostico.ordem));

      if (diagnosticosAnteriores.length > 0) {
        await tx.insert(diagnostico).values(
          diagnosticosAnteriores.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, ...resto }) => ({
            ...resto,
            laudoVersaoId: nova!.id,
          })),
        );
      }

      const margensAnteriores = await tx
        .select()
        .from(margemMicroscopica)
        .where(eq(margemMicroscopica.laudoVersaoId, anterior.id));

      if (margensAnteriores.length > 0) {
        await tx.insert(margemMicroscopica).values(
          margensAnteriores.map(({ id: _id, criadoEm: _c, atualizadoEm: _a, ...resto }) => ({
            ...resto,
            laudoVersaoId: nova!.id,
          })),
        );
      }

      // M12 e dono da propria estrutura - o M11 pede a copia, nao escreve nela.
      await this.citopatologia.copiarParaVersao(tx, anterior.id, nova!.id);

      await tx
        .update(laudo)
        .set({ status: 'rascunho', versaoAtual: proxima })
        .where(eq(laudo.id, laudoId));

      const [dadosCaso] = await tx
        .select({ casoId: laudo.casoId })
        .from(laudo)
        .where(eq(laudo.id, laudoId))
        .limit(1);

      await this.eventos.publicar(tx, {
        tipo: tipo === 'adendo' ? 'laudo.adendo_criado' : 'laudo.corrigido',
        casoId: dadosCaso!.casoId,
        moduloOrigem: MODULOS.M11_LAUDOS,
        objetoTipo: 'laudo_versao',
        objetoId: nova!.id,
        visibilidade: 'externo',
        payload: { versao: proxima, motivo },
      });

      return { versaoId: nova!.id, versao: proxima };
    });
  }

  /**
   * Pre-visualizacao (M11 secao 71): "deve mostrar exatamente o documento que
   * sera disponibilizado". Mesmo gerador da assinatura, mas os bytes NAO sao
   * guardados - rascunho pode ser salvo dezenas de vezes, e nada aqui e
   * versionado ate a assinatura existir de verdade.
   */
  async preVisualizarPdf(versaoId: string): Promise<Buffer> {
    return this.db.executar(async (tx) => {
      const dados = await this.montarDadosPdf(tx, versaoId, null);
      return this.pdf.gerar(dados);
    });
  }

  /**
   * Bytes do PDF assinado - os MESMOS bytes gravados na assinatura, nunca
   * regerados (ADR 0005). So existe depois de assinada: antes disso o unico
   * documento possivel e a pre-visualizacao.
   */
  async baixarPdf(versaoId: string): Promise<{ bytes: Buffer; nomeArquivo: string }> {
    return this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      if (!versao.pdfChave) {
        throw new BadRequestException('Este laudo ainda não foi assinado. Use a pré-visualização.');
      }

      const bytes = await this.storage.criar().baixar(versao.pdfChave);
      return { bytes, nomeArquivo: `${versao.casoIdentificador}-v${versao.versao}.pdf` };
    });
  }

  /**
   * Validacao publica do QR Code (M11 secao 88).
   *
   * Sem sessao - por isso o slug da instituicao vem na propria URL, do mesmo
   * jeito que o login resolve o tenant antes de a sessao existir (ADR 0002).
   * A resposta e deliberadamente pobre: nada de dados clinicos, diagnostico ou
   * paciente. So o que autentica o documento perante terceiros.
   */
  async validarPublico(tenantSlug: string, codigo: string) {
    const [instituicao] = await this.db.raw
      .select({ id: tenant.id, nome: tenant.nomeFantasia })
      .from(tenant)
      .where(and(eq(tenant.slug, tenantSlug), isNull(tenant.inativadoEm)))
      .limit(1);

    if (!instituicao) throw new NotFoundException('Documento não encontrado.');

    return this.db.executarComTenant(instituicao.id, async (tx) => {
      const [linha] = await tx
        .select({
          versao: laudoVersao.versao,
          tipo: laudoVersao.tipo,
          assinadaEm: laudoVersao.assinadaEm,
          assinaturaIdentificacao: laudoVersao.assinaturaIdentificacao,
          substituida: laudoVersao.substituida,
          casoIdentificador: caso.identificador,
        })
        .from(laudoVersao)
        .innerJoin(laudo, eq(laudo.id, laudoVersao.laudoId))
        .innerJoin(caso, eq(caso.id, laudo.casoId))
        .where(
          and(eq(laudoVersao.tenantId, instituicao.id), eq(laudoVersao.codigoValidacao, codigo)),
        )
        .limit(1);

      if (!linha || !linha.assinadaEm) throw new NotFoundException('Documento não encontrado.');

      return {
        instituicao: instituicao.nome,
        caso: linha.casoIdentificador,
        versao: linha.versao,
        tipo: linha.tipo,
        assinadoPor: linha.assinaturaIdentificacao,
        assinadoEm: linha.assinadaEm,
        // M11 secao 89: versao substituida continua autentica - so nao e mais
        // a vigente. A distincao importa para quem recebeu o PDF antigo.
        vigente: !linha.substituida,
      };
    });
  }

  // --- internos ------------------------------------------------------------

  /** Monta os dados formatados que `LaudoPdfService` usa - nunca decide nada. */
  private async montarDadosPdf(
    tx: Transacao,
    versaoId: string,
    assinaturaInfo: { identificacao: string; assinadaEm: Date; codigoValidacao: string } | null,
  ): Promise<DadosLaudoPdf> {
    const ctx = exigirContexto();
    const especieTermo = termo;

    const [linha] = await tx
      .select({
        versao: laudoVersao,
        casoIdentificador: caso.identificador,
        pacienteNome: paciente.nome,
        pacienteSexo: paciente.sexo,
        pacienteIdadeInformada: paciente.idadeInformada,
        pacienteDataNascimento: paciente.dataNascimento,
        pacienteEspecie: especieTermo.valor,
        clienteNome: cliente.nomeFantasia,
        veterinarioNome: veterinario.nome,
        veterinarioCrmv: veterinario.crmv,
        servicoNome: servico.nome,
        instituicaoNome: tenant.nomeFantasia,
        instituicaoSlug: tenant.slug,
      })
      .from(laudoVersao)
      .innerJoin(laudo, eq(laudo.id, laudoVersao.laudoId))
      .innerJoin(caso, eq(caso.id, laudo.casoId))
      .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
      .innerJoin(cliente, eq(cliente.id, caso.clienteId))
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .innerJoin(tenant, eq(tenant.id, laudoVersao.tenantId))
      .leftJoin(veterinario, eq(veterinario.id, caso.veterinarioId))
      .leftJoin(especieTermo, eq(especieTermo.id, paciente.especieId))
      .where(and(eq(laudoVersao.tenantId, ctx.tenantId), eq(laudoVersao.id, versaoId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Versão de laudo não encontrada.');

    const [diagnosticos, margens] = await Promise.all([
      tx
        .select({
          textoExibido: diagnostico.textoExibido,
          amostraIdentificador: amostra.identificador,
        })
        .from(diagnostico)
        .leftJoin(amostra, eq(amostra.id, diagnostico.amostraId))
        .where(eq(diagnostico.laudoVersaoId, versaoId))
        .orderBy(asc(diagnostico.ordem)),
      tx
        .select({
          nome: margemMicroscopica.nome,
          resultado: margemMicroscopica.resultado,
          distanciaMm: margemMicroscopica.distanciaMm,
        })
        .from(margemMicroscopica)
        .where(eq(margemMicroscopica.laudoVersaoId, versaoId))
        .orderBy(asc(margemMicroscopica.nome)),
    ]);

    /**
     * M12 secao 96: no laudo citologico, a avaliacao por amostra E o corpo do
     * documento. Sai vazia na histopatologia - a consulta e a mesma, o que muda
     * e haver ou nao o que buscar.
     *
     * O grau de certeza NAO entra: a secao 66 e explicita ao classifica-lo como
     * componente interno, que ajuda auditoria e IA e nao precisa aparecer no
     * laudo entregue.
     */
    const citologia = await tx
      .select({
        amostraIdentificador: amostra.identificador,
        tipoColeta: avaliacaoCitologica.tipoColeta,
        sitio: avaliacaoCitologica.sitio,
        adequacao: avaliacaoCitologica.adequacao,
        motivosLimitacao: avaliacaoCitologica.motivosLimitacao,
        descricao: avaliacaoCitologica.descricaoCitologica,
        interpretacao: avaliacaoCitologica.interpretacao,
        limitacoes: avaliacaoCitologica.limitacoes,
        recomendacoes: avaliacaoCitologica.recomendacoes,
      })
      .from(avaliacaoCitologica)
      .innerJoin(amostra, eq(amostra.id, avaliacaoCitologica.amostraId))
      .where(eq(avaliacaoCitologica.laudoVersaoId, versaoId))
      .orderBy(asc(amostra.ordem));

    /**
     * M16 secoes 36-40: as selecionadas do caso, na ordem escolhida. O M11
     * pede os bytes ao M16 em vez de ler o storage por conta propria - o
     * arquivo tem um dono so (DIRETRIZES secao 8).
     */
    const imagens = await this.imagensDoLaudo(tx, linha.versao.laudoId);

    return {
      instituicao: { nome: linha.instituicaoNome },
      caso: { identificador: linha.casoIdentificador },
      paciente: {
        nome: linha.pacienteNome,
        especie: linha.pacienteEspecie,
        sexo: linha.pacienteSexo,
        idade:
          linha.pacienteIdadeInformada ??
          this.idadeAPartirDoNascimento(linha.pacienteDataNascimento),
      },
      cliente: { nome: linha.clienteNome },
      veterinario: linha.veterinarioNome
        ? { nome: linha.veterinarioNome, crmv: linha.veterinarioCrmv }
        : null,
      servico: { nome: linha.servicoNome },
      versao: {
        numero: linha.versao.versao,
        tipo: linha.versao.tipo,
        motivo: linha.versao.motivo,
        descricaoMicroscopica: linha.versao.descricaoMicroscopica,
        comentarios: linha.versao.comentarios,
        conclusao: linha.versao.conclusao,
      },
      diagnosticos,
      margens,
      imagens,
      citologia: citologia.map((c) => ({
        amostraIdentificador: c.amostraIdentificador,
        material:
          [ROTULO_COLETA[c.tipoColeta ?? ''] ?? c.tipoColeta, c.sitio]
            .filter(Boolean)
            .join(' — ') || null,
        adequacao: c.adequacao,
        motivosLimitacao: c.motivosLimitacao,
        descricao: c.descricao,
        interpretacao: c.interpretacao,
        limitacoes: c.limitacoes,
        recomendacoes: c.recomendacoes,
      })),
      assinatura: assinaturaInfo
        ? { identificacao: assinaturaInfo.identificacao, assinadaEm: assinaturaInfo.assinadaEm }
        : null,
      urlValidacao: assinaturaInfo
        ? `${this.env.WEB_PUBLIC_URL}/validar/${linha.instituicaoSlug}/${assinaturaInfo.codigoValidacao}`
        : null,
    };
  }

  /**
   * Bytes e legendas das imagens selecionadas para o laudo.
   *
   * Falha de leitura de UMA imagem nao derruba o documento: o storage pode
   * estar momentaneamente indisponivel, e barrar a assinatura por causa de uma
   * ilustracao seria trocar um problema pequeno por um grande. A imagem
   * simplesmente nao entra, e o restante do laudo sai.
   */
  private async imagensDoLaudo(
    tx: Transacao,
    laudoId: string,
  ): Promise<Array<{ bytes: Buffer; legenda: string | null; identificador: string }>> {
    const ctx = exigirContexto();

    const [dono] = await tx
      .select({ casoId: laudo.casoId })
      .from(laudo)
      .where(and(eq(laudo.tenantId, ctx.tenantId), eq(laudo.id, laudoId)))
      .limit(1);
    if (!dono) return [];

    const selecionadas = await tx
      .select({
        identificador: imagem.identificador,
        legenda: imagem.legenda,
        chave: imagemVersao.chaveStorage,
      })
      .from(imagem)
      .innerJoin(
        imagemVersao,
        and(eq(imagemVersao.imagemId, imagem.id), eq(imagemVersao.nivel, 'original')),
      )
      .where(
        and(
          eq(imagem.tenantId, ctx.tenantId),
          eq(imagem.casoId, dono.casoId),
          eq(imagem.incluidaNoLaudo, true),
          isNull(imagem.inativadaEm),
        ),
      )
      .orderBy(asc(imagem.ordemNoLaudo));

    if (selecionadas.length === 0) return [];

    const provedor = this.storage.criar();
    const resultado: Array<{ bytes: Buffer; legenda: string | null; identificador: string }> =
      [];

    for (const item of selecionadas) {
      try {
        resultado.push({
          bytes: await provedor.baixar(item.chave),
          legenda: item.legenda,
          identificador: item.identificador,
        });
      } catch {
        this.logger.warn(`Imagem ${item.identificador} não pôde ser lida do storage.`);
      }
    }

    return resultado;
  }

  /** Idade aproximada em anos/meses, quando ha data de nascimento exata. */
  private idadeAPartirDoNascimento(dataNascimento: string | null): string | null {
    if (!dataNascimento) return null;
    const nascimento = new Date(dataNascimento);
    const meses = (Date.now() - nascimento.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
    if (meses < 12) return `${Math.floor(meses)} meses`;
    return `${Math.floor(meses / 12)} anos`;
  }

  /** Estado pre-analitico do caso, do jeito que `motivoBancadaBloqueada` espera. */
  private async estadoPreAnalitico(tx: Transacao, casoId: string) {
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
    return registro;
  }

  /**
   * Arquivo de laudos (segunda review, Hugo): "busca dos laudos pelo
   * paciente, pelo cliente, pelo nome do responsavel, por uma palavra-chave -
   * carcinoma -, pela lamina, pela OS". Uma caixa so; o termo e procurado em
   * tudo isso, na versao corrente de cada laudo. Quem pode ver laudo ve o
   * arquivo inteiro - Hugo liberou: "nao tem problema ele acessar laudos de
   * outros patologistas".
   */
  async buscar(termo: string) {
    const ctx = exigirContexto();
    const q = termo.trim();
    if (q.length < 2) return [];
    const padrao = `%${q}%`;

    return this.db.executar(async (tx) => {
      const patologista = usuario;
      const linhas = await tx
        .select({
          casoId: caso.id,
          identificador: caso.identificador,
          paciente: paciente.nome,
          cliente: cliente.nomeFantasia,
          veterinario: veterinario.nome,
          patologista: patologista.nomeCompleto,
          status: laudo.status,
          liberadoEm: laudo.liberadoEm,
          versao: laudoVersao.versao,
          conclusao: laudoVersao.conclusao,
          entradaEm: caso.entradaEm,
        })
        .from(laudo)
        .innerJoin(
          laudoVersao,
          and(eq(laudoVersao.laudoId, laudo.id), eq(laudoVersao.versao, laudo.versaoAtual)),
        )
        .innerJoin(caso, eq(caso.id, laudo.casoId))
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .innerJoin(cliente, eq(cliente.id, caso.clienteId))
        .leftJoin(veterinario, eq(veterinario.id, caso.veterinarioId))
        .leftJoin(patologista, eq(patologista.id, laudo.patologistaId))
        .where(
          and(
            eq(laudo.tenantId, ctx.tenantId),
            or(
              ilike(caso.identificador, padrao),
              ilike(paciente.nome, padrao),
              ilike(cliente.nomeFantasia, padrao),
              ilike(veterinario.nome, padrao),
              ilike(patologista.nomeCompleto, padrao),
              ilike(laudoVersao.conclusao, padrao),
              ilike(laudoVersao.descricaoMicroscopica, padrao),
              ilike(laudoVersao.comentarios, padrao),
              // Lamina e OS: referencias externas literais na subconsulta
              // (armadilha documentada no M19/M20).
              sql`exists (select 1 from lamina l where l.caso_id = caso.id and l.identificador ilike ${padrao})`,
              sql`exists (select 1 from ordem_servico o where o.caso_id = caso.id and o.identificador ilike ${padrao})`,
            ),
          ),
        )
        .orderBy(sql`${laudo.liberadoEm} desc nulls last`, desc(caso.entradaEm))
        .limit(50);

      return linhas.map((l) => ({
        ...l,
        // Um trecho da conclusao ao redor do termo, para bater o olho.
        trecho: trechoAoRedor(l.conclusao, q),
      }));
    });
  }

  private async versaoCorrente(tx: Transacao, laudoId: string) {
    const ctx = exigirContexto();
    const [versao] = await tx
      .select()
      .from(laudoVersao)
      .where(and(eq(laudoVersao.tenantId, ctx.tenantId), eq(laudoVersao.laudoId, laudoId)))
      .orderBy(desc(laudoVersao.versao))
      .limit(1);

    if (!versao) throw new NotFoundException('Laudo sem versões.');
    return versao;
  }

  private async buscarVersao(tx: Transacao, versaoId: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select({
        versao: laudoVersao,
        casoId: laudo.casoId,
        casoIdentificador: caso.identificador,
      })
      .from(laudoVersao)
      .innerJoin(laudo, eq(laudo.id, laudoVersao.laudoId))
      .innerJoin(caso, eq(caso.id, laudo.casoId))
      .where(and(eq(laudoVersao.tenantId, ctx.tenantId), eq(laudoVersao.id, versaoId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Versão de laudo não encontrada.');

    return {
      ...linha.versao,
      casoId: linha.casoId,
      casoIdentificador: linha.casoIdentificador,
    };
  }
}

function trechoAoRedor(texto: string | null, termo: string): string | null {
  if (!texto) return null;
  const i = texto.toLowerCase().indexOf(termo.toLowerCase());
  if (i < 0) return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto;
  const ini = Math.max(0, i - 60);
  const fim = Math.min(texto.length, i + termo.length + 100);
  return `${ini > 0 ? '…' : ''}${texto.slice(ini, fim)}${fim < texto.length ? '…' : ''}`;
}
