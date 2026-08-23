import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  amostra,
  avaliacaoCitologica,
  caso,
  laudo,
  laudoVersao,
  servico,
  type Transacao,
} from '@lapato/db';
import {
  ADEQUACAO_CITOLOGICA,
  CELULARIDADE,
  CRITERIO_MALIGNIDADE,
  FREQUENCIA_MITOSES,
  FUNDO_PREPARACAO,
  GRAU_CERTEZA,
  GRUPO_AGENTE,
  INTENSIDADE,
  LIMITACAO_CITOLOGICA,
  LOCALIZACAO_AGENTE,
  MATERIAL_EXTRACELULAR,
  MOTIVO_LIMITACAO_CITOLOGICA,
  POPULACAO_CELULAR,
  PRESERVACAO_CELULAR,
  SIGNIFICANCIA_AGENTE,
  TIPO_COLETA_CITOLOGICA,
  TIPO_INFLAMACAO,
  type AdequacaoCitologica,
  type Celularidade,
  type Intensidade,
  type PreservacaoCelular,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosAvaliacaoCitologica {
  tipoColeta?: string | null;
  sitio?: string | null;
  numeroLaminas?: number | null;
  coloracoes?: string[];
  adequacao?: AdequacaoCitologica | null;
  motivosLimitacao?: string[];
  celularidade?: Celularidade | null;
  preservacao?: PreservacaoCelular | null;
  fundo?: string[];
  hemorragia?: Intensidade | null;
  achadosHemorragia?: string[];
  necrose?: Intensidade | null;
  materialExtracelular?: string[];
  populacoes?: Array<Record<string, unknown>>;
  criteriosMalignidade?: Record<string, string>;
  mitoses?: string | null;
  inflamacao?: Record<string, unknown> | null;
  agentes?: Array<Record<string, unknown>>;
  descricaoCitologica?: string | null;
  interpretacao?: string | null;
  grauCerteza?: string | null;
  limitacoes?: string[];
  recomendacoes?: string | null;
}

/**
 * M12 - Citopatologia.
 *
 * O modulo nao tem bancada propria: ele **acrescenta a logica citologica** a
 * estacao de trabalho do M11 (secao 1 do proprio modulo). Por isso aqui nao ha
 * abrir, revisar, assinar nem liberar - tudo isso continua no LaudosService, e
 * duplicar seria criar um segundo caminho de assinatura, exatamente o que a
 * secao 141 proibe.
 *
 * O que o servico faz e o que so o M12 sabe fazer: guardar a avaliacao
 * morfologica por amostra e devolver o vocabulario estruturado da citologia.
 */
@Injectable()
export class CitopatologiaService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Vocabulario do modulo (M12 secao 3).
   *
   * Vem do servidor, e nao de constantes no front, pela mesma razao de sempre:
   * a tela e uma representacao do dominio, nao a fonte dele. Quando a
   * instituicao puder ajustar estas listas, o ponto de mudanca ja esta aqui.
   */
  vocabulario() {
    return {
      tiposColeta: TIPO_COLETA_CITOLOGICA,
      adequacao: ADEQUACAO_CITOLOGICA,
      motivosLimitacao: MOTIVO_LIMITACAO_CITOLOGICA,
      celularidade: CELULARIDADE,
      preservacao: PRESERVACAO_CELULAR,
      fundo: FUNDO_PREPARACAO,
      intensidade: INTENSIDADE,
      materialExtracelular: MATERIAL_EXTRACELULAR,
      populacoes: POPULACAO_CELULAR,
      criteriosMalignidade: CRITERIO_MALIGNIDADE,
      mitoses: FREQUENCIA_MITOSES,
      tiposInflamacao: TIPO_INFLAMACAO,
      gruposAgente: GRUPO_AGENTE,
      localizacoesAgente: LOCALIZACAO_AGENTE,
      significanciasAgente: SIGNIFICANCIA_AGENTE,
      grauCerteza: GRAU_CERTEZA,
      limitacoes: LIMITACAO_CITOLOGICA,
    };
  }

  /**
   * Avaliacoes da versao, junto das amostras do caso.
   *
   * As amostras vem juntas de proposito: a tela precisa mostrar TODAS - as
   * avaliadas e as que ainda faltam. Amostra sem avaliacao e o achado mais util
   * da lista, porque e o que impede a assinatura sair completa (M12 secao 142).
   */
  async listarPorVersao(versaoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      const [amostras, avaliacoes] = await Promise.all([
        tx
          .select({
            id: amostra.id,
            identificador: amostra.identificador,
            letra: amostra.letra,
            descricao: amostra.descricao,
            regiaoAnatomica: amostra.regiaoAnatomica,
            lateralidade: amostra.lateralidade,
            metodoColeta: amostra.metodoColeta,
          })
          .from(amostra)
          .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.casoId, versao.casoId)))
          .orderBy(asc(amostra.ordem)),
        tx
          .select()
          .from(avaliacaoCitologica)
          .where(
            and(
              eq(avaliacaoCitologica.tenantId, ctx.tenantId),
              eq(avaliacaoCitologica.laudoVersaoId, versaoId),
            ),
          ),
      ]);

      return {
        versaoId,
        assinada: versao.assinadaEm !== null,
        amostras,
        avaliacoes: avaliacoes.map((a) => ({
          amostraId: a.amostraId,
          tipoColeta: a.tipoColeta,
          sitio: a.sitio,
          numeroLaminas: a.numeroLaminas,
          coloracoes: a.coloracoes,
          adequacao: a.adequacao,
          motivosLimitacao: a.motivosLimitacao,
          celularidade: a.celularidade,
          preservacao: a.preservacao,
          fundo: a.fundo,
          hemorragia: a.hemorragia,
          achadosHemorragia: a.achadosHemorragia,
          necrose: a.necrose,
          materialExtracelular: a.materialExtracelular,
          populacoes: a.populacoes,
          criteriosMalignidade: a.criteriosMalignidade,
          mitoses: a.mitoses,
          inflamacao: a.inflamacao,
          agentes: a.agentes,
          descricaoCitologica: a.descricaoCitologica,
          interpretacao: a.interpretacao,
          grauCerteza: a.grauCerteza,
          limitacoes: a.limitacoes,
          recomendacoes: a.recomendacoes,
        })),
      };
    });
  }

  /**
   * Grava a avaliacao de UMA amostra (M12 secoes 115 e 142).
   *
   * Uma chamada por amostra, e nao um lote da versao inteira: cada massa
   * aspirada tem interpretacao independente, e salvar em lote faria o erro de
   * uma travar o registro das outras.
   */
  async salvar(
    versaoId: string,
    amostraId: string,
    dados: DadosAvaliacaoCitologica,
  ): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const versao = await this.buscarVersao(tx, versaoId);

      // Mesma regra do M11: versao assinada nao se edita - muda-se por adendo
      // ou correcao, que criam versao nova.
      if (versao.assinadaEm) {
        throw new BadRequestException(
          'Versão já assinada. Crie um adendo ou uma correção para alterar o laudo.',
        );
      }

      const [alvo] = await tx
        .select({ id: amostra.id, casoId: amostra.casoId })
        .from(amostra)
        .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.id, amostraId)))
        .limit(1);

      if (!alvo || alvo.casoId !== versao.casoId) {
        throw new BadRequestException('A amostra não pertence ao caso deste laudo.');
      }

      const valores = {
        tipoColeta: dados.tipoColeta ?? null,
        sitio: dados.sitio ?? null,
        numeroLaminas: dados.numeroLaminas ?? null,
        coloracoes: dados.coloracoes ?? [],
        adequacao: dados.adequacao ?? null,
        motivosLimitacao: dados.motivosLimitacao ?? [],
        celularidade: dados.celularidade ?? null,
        preservacao: dados.preservacao ?? null,
        fundo: dados.fundo ?? [],
        hemorragia: dados.hemorragia ?? null,
        achadosHemorragia: dados.achadosHemorragia ?? [],
        necrose: dados.necrose ?? null,
        materialExtracelular: dados.materialExtracelular ?? [],
        populacoes: dados.populacoes ?? [],
        criteriosMalignidade: dados.criteriosMalignidade ?? {},
        mitoses: dados.mitoses ?? null,
        inflamacao: dados.inflamacao ?? null,
        agentes: dados.agentes ?? [],
        descricaoCitologica: dados.descricaoCitologica ?? null,
        interpretacao: dados.interpretacao ?? null,
        grauCerteza: dados.grauCerteza ?? null,
        limitacoes: dados.limitacoes ?? [],
        recomendacoes: dados.recomendacoes ?? null,
      };

      await tx
        .insert(avaliacaoCitologica)
        .values({
          tenantId: ctx.tenantId,
          laudoVersaoId: versaoId,
          amostraId,
          ...valores,
        })
        .onConflictDoUpdate({
          target: [avaliacaoCitologica.laudoVersaoId, avaliacaoCitologica.amostraId],
          set: { ...valores, atualizadoEm: new Date() },
        });

      await this.auditoria.registrar(tx, {
        entidade: 'avaliacao_citologica',
        entidadeId: amostraId,
        acao: 'salvar',
        casoId: versao.casoId,
        valorNovo: { adequacao: valores.adequacao, grauCerteza: valores.grauCerteza },
      });
    });
  }

  /**
   * Copia as avaliacoes de uma versao para outra (M11: adendo e correcao
   * nascem do conteudo anterior).
   *
   * Sem isto, um adendo de uma linha zeraria toda a morfologia registrada - e a
   * versao nova sairia com o laudo pela metade.
   */
  async copiarParaVersao(tx: Transacao, origemId: string, destinoId: string): Promise<void> {
    const ctx = exigirContexto();

    const origem = await tx
      .select()
      .from(avaliacaoCitologica)
      .where(
        and(
          eq(avaliacaoCitologica.tenantId, ctx.tenantId),
          eq(avaliacaoCitologica.laudoVersaoId, origemId),
        ),
      );

    if (origem.length === 0) return;

    await tx.insert(avaliacaoCitologica).values(
      origem.map(({ id: _id, criadoEm: _criadoEm, atualizadoEm: _atualizadoEm, ...resto }) => ({
        ...resto,
        laudoVersaoId: destinoId,
      })),
    );
  }

  /** True quando o caso e citologico - o que decide a forma da bancada. */
  async ehCitologico(tx: Transacao, casoId: string): Promise<boolean> {
    const ctx = exigirContexto();

    const [registro] = await tx
      .select({ modalidade: servico.modalidade })
      .from(caso)
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    return registro?.modalidade === 'citopatologia';
  }

  // --- internos --------------------------------------------------------------

  private async buscarVersao(tx: Transacao, versaoId: string) {
    const ctx = exigirContexto();

    const [linha] = await tx
      .select({
        id: laudoVersao.id,
        casoId: laudo.casoId,
        assinadaEm: laudoVersao.assinadaEm,
      })
      .from(laudoVersao)
      .innerJoin(laudo, eq(laudo.id, laudoVersao.laudoId))
      .where(and(eq(laudoVersao.tenantId, ctx.tenantId), eq(laudoVersao.id, versaoId)))
      .limit(1);

    if (!linha) throw new NotFoundException('Versão de laudo não encontrada.');
    return linha;
  }
}
