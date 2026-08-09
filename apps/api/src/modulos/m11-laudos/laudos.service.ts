import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  assinaturaProfissional,
  caso,
  diagnostico,
  laudo,
  laudoVersao,
  margemMicroscopica,
  revisaoLaudo,
  notificacaoPendente,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  PERMISSOES,
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
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly guardian: GuardianService,
    private readonly sugestoes: SugestoesService,
    private readonly fluxo: FluxoService,
  ) {}

  /** Abre (ou recupera) o laudo do caso e sua versao corrente. */
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
      await this.sugestoes.registrarAchadosGuardian(
        tx,
        achados,
        versao.casoId,
        'assinatura_laudo',
      );
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

      await tx
        .update(laudoVersao)
        .set({
          assinadaEm: new Date(),
          assinadaPorId: ctx.usuarioId,
          assinaturaIdentificacao: assinatura?.identificacaoProfissional ?? null,
          assinaturaMecanismo: mecanismo,
          codigoValidacao,
        })
        .where(eq(laudoVersao.id, versaoId));

      await tx
        .update(laudo)
        .set({ status: 'assinado' })
        .where(eq(laudo.id, versao.laudoId));

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
      const [registro] = await tx
        .select()
        .from(laudo)
        .where(eq(laudo.id, versao.laudoId))
        .limit(1);

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

    const permissao =
      tipo === 'adendo' ? PERMISSOES.LAUDO_ADENDO : PERMISSOES.LAUDO_CORRIGIR;
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

  // --- internos ------------------------------------------------------------

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
