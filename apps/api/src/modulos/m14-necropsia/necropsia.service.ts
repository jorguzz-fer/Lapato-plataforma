import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  cadaver,
  causaMortis,
  caso,
  exameOrgao,
  lesaoNecroscopica,
  necropsia,
  relacaoLesao,
  type Transacao,
} from '@lapato/db';
import {
  CLASSIFICACOES_CAUSAIS,
  MODULOS,
  type CavidadeNecropsia,
  type ClassificacaoLesao,
  type ConservacaoNecropsia,
  type EstadoExameOrgao,
  type GrauCertezaCausa,
  type MecanismoTerminal,
  type ModalidadeNecropsia,
  type RelacaoLesao,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosAbertura {
  modalidade?: ModalidadeNecropsia;
  responsavelSolicitacao: string;
  contatoResponsavel?: string | null;
  cadaverId?: string | null;
  conservacao?: ConservacaoNecropsia | null;
  obitoEm?: string | null;
  circunstanciasMorte?: string | null;
  perguntasSolicitante?: string | null;
}

export interface DadosLesao {
  orgao: string;
  descricao: string;
  localizacao?: string | null;
  distribuicao?: string | null;
  dimensao?: string | null;
  diagnosticoMorfologico?: string | null;
  classificacao?: ClassificacaoLesao | null;
  impressaoMacroscopica?: string | null;
  observacoes?: string | null;
}

export interface DadosCausaMortis {
  causaImediata?: string | null;
  condicaoAntecedente?: string | null;
  causaBasica?: string | null;
  condicoesContribuintes?: string | null;
  mecanismoTerminal?: MecanismoTerminal | null;
  grauCerteza: GrauCertezaCausa;
  diagnosticosDiferenciais?: string[];
  conclusao?: string | null;
}

/**
 * M14 - Necropsia.
 *
 * A necropsia nao termina num diagnostico de lesao: termina numa **reconstrucao
 * fisiopatologica da morte**. Por isso o servico e organizado em torno de tres
 * coisas que os outros modulos diagnosticos nao tem - o exame por orgao com
 * completude auditavel, o objeto lesao ligavel a outras lesoes, e a causa
 * mortis com estrutura propria.
 *
 * Duas regras da secao 163 aparecem em quase todo metodo:
 *
 * - **"Nao examinado" e diferente de "sem alteracoes".** O orgao que ninguem
 *   abriu nao pode se confundir com o orgao aberto e normal.
 * - **Mecanismo nao e causa.** Choque hipovolemico e como; ruptura hepatica e
 *   por que. Campos separados, sempre.
 */
@Injectable()
export class NecropsiaService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly guardian: GuardianService,
  ) {}

  /**
   * Abre o exame para um caso (secao 8).
   *
   * `responsavelSolicitacao` e obrigatorio e o veterinario nao e: a secao 4 diz
   * que a necropsia pode ser pedida pelo tutor, pela seguradora ou por
   * autoridade competente, mas "devera existir sempre um RESPONSAVEL PELA
   * SOLICITACAO com identificacao e forma de contato".
   */
  async abrir(casoId: string, dados: DadosAbertura): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.exigirCaso(tx, casoId);

      const [existente] = await tx
        .select({ id: necropsia.id })
        .from(necropsia)
        .where(and(eq(necropsia.tenantId, ctx.tenantId), eq(necropsia.casoId, casoId)))
        .limit(1);

      if (existente) return { id: existente.id };

      if (dados.cadaverId) await this.exigirCadaver(tx, dados.cadaverId);

      const [nova] = await tx
        .insert(necropsia)
        .values({
          tenantId: ctx.tenantId,
          casoId,
          cadaverId: dados.cadaverId ?? null,
          modalidade: dados.modalidade ?? 'diagnostica',
          responsavelSolicitacao: dados.responsavelSolicitacao.trim(),
          contatoResponsavel: dados.contatoResponsavel ?? null,
          conservacao: dados.conservacao ?? null,
          obitoEm: dados.obitoEm ? new Date(dados.obitoEm) : null,
          circunstanciasMorte: dados.circunstanciasMorte ?? null,
          perguntasSolicitante: dados.perguntasSolicitante ?? null,
          iniciadaPorId: ctx.usuarioId,
        })
        .returning({ id: necropsia.id });

      await this.eventos.publicar(tx, {
        tipo: 'necropsia.iniciada',
        casoId,
        moduloOrigem: MODULOS.M14_NECROPSIA,
        objetoTipo: 'necropsia',
        objetoId: nova!.id,
        payload: { modalidade: dados.modalidade ?? 'diagnostica' },
      });

      return { id: nova!.id };
    });
  }

  /** Exame externo (secao 57) e limitacoes (secao 119), em bloco. */
  async salvarExameExterno(
    necropsiaId: string,
    dados: {
      exameExterno?: Record<string, unknown>;
      limitacoes?: string[];
      limitacoesObservacao?: string | null;
      conservacao?: ConservacaoNecropsia | null;
      circunstanciasMorte?: string | null;
      perguntasSolicitante?: string | null;
    },
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);

      await tx
        .update(necropsia)
        .set({
          exameExterno: dados.exameExterno ?? atual.exameExterno,
          limitacoes: dados.limitacoes ?? atual.limitacoes,
          limitacoesObservacao: dados.limitacoesObservacao ?? atual.limitacoesObservacao,
          conservacao: dados.conservacao ?? atual.conservacao,
          circunstanciasMorte: dados.circunstanciasMorte ?? atual.circunstanciasMorte,
          perguntasSolicitante: dados.perguntasSolicitante ?? atual.perguntasSolicitante,
          atualizadoEm: new Date(),
        })
        .where(eq(necropsia.id, necropsiaId));
    });
  }

  /**
   * Registra o exame de um orgao (secoes 63 e 68-72).
   *
   * `estado` e obrigatorio porque e ele que carrega a distincao da secao 163:
   * um orgao ausente da lista e um orgao sobre o qual nada se sabe, e o
   * checklist de completude depende disso.
   */
  async registrarOrgao(
    necropsiaId: string,
    dados: {
      cavidade: CavidadeNecropsia;
      sistema?: string | null;
      orgao: string;
      estado: EstadoExameOrgao;
      descricao?: string | null;
      pesoGramas?: number | null;
    },
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);

      /**
       * Descrever um orgao que se marcou como nao examinado e contradicao, nao
       * detalhe: a secao 118 lista "orgao nao examinado, mas descrito" entre as
       * incoerencias que o Guardian procura. Aqui ela nem chega a ser gravada.
       */
      if (dados.estado === 'nao_examinado' && dados.descricao?.trim()) {
        throw new BadRequestException(
          'Órgão marcado como não examinado não pode ter descrição. ' +
            'Se ele foi examinado, mude o estado; se não foi, remova a descrição.',
        );
      }

      await tx
        .insert(exameOrgao)
        .values({
          tenantId: ctx.tenantId,
          necropsiaId,
          cavidade: dados.cavidade,
          sistema: dados.sistema ?? null,
          orgao: dados.orgao.trim(),
          estado: dados.estado,
          descricao: dados.descricao ?? null,
          pesoGramas: dados.pesoGramas ?? null,
        })
        .onConflictDoUpdate({
          target: [exameOrgao.tenantId, exameOrgao.necropsiaId, exameOrgao.cavidade, exameOrgao.orgao],
          set: {
            sistema: dados.sistema ?? null,
            estado: dados.estado,
            descricao: dados.descricao ?? null,
            pesoGramas: dados.pesoGramas ?? null,
            atualizadoEm: new Date(),
          },
        });
    });
  }

  /** Objeto Lesao (secoes 73-74). O codigo `L01`, `L02`… e sequencial na necropsia. */
  async criarLesao(necropsiaId: string, dados: DadosLesao): Promise<{ id: string; codigo: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);

      const [contagem] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(lesaoNecroscopica)
        .where(
          and(
            eq(lesaoNecroscopica.tenantId, ctx.tenantId),
            eq(lesaoNecroscopica.necropsiaId, necropsiaId),
          ),
        );

      const codigo = `L${String(Number(contagem?.total ?? 0) + 1).padStart(2, '0')}`;

      const [nova] = await tx
        .insert(lesaoNecroscopica)
        .values({
          tenantId: ctx.tenantId,
          necropsiaId,
          codigo,
          orgao: dados.orgao.trim(),
          descricao: dados.descricao.trim(),
          localizacao: dados.localizacao ?? null,
          distribuicao: dados.distribuicao ?? null,
          dimensao: dados.dimensao ?? null,
          diagnosticoMorfologico: dados.diagnosticoMorfologico ?? null,
          classificacao: dados.classificacao ?? null,
          impressaoMacroscopica: dados.impressaoMacroscopica ?? null,
          observacoes: dados.observacoes ?? null,
        })
        .returning({ id: lesaoNecroscopica.id });

      return { id: nova!.id, codigo };
    });
  }

  async editarLesao(lesaoId: string, dados: Partial<DadosLesao>): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [atual] = await tx
        .select()
        .from(lesaoNecroscopica)
        .where(
          and(eq(lesaoNecroscopica.tenantId, ctx.tenantId), eq(lesaoNecroscopica.id, lesaoId)),
        )
        .limit(1);

      if (!atual) throw new NotFoundException('Lesão não encontrada.');
      this.garantirEmAndamento(await this.buscar(tx, atual.necropsiaId));

      await tx
        .update(lesaoNecroscopica)
        .set({
          orgao: dados.orgao ?? atual.orgao,
          descricao: dados.descricao ?? atual.descricao,
          localizacao: dados.localizacao ?? atual.localizacao,
          distribuicao: dados.distribuicao ?? atual.distribuicao,
          dimensao: dados.dimensao ?? atual.dimensao,
          diagnosticoMorfologico: dados.diagnosticoMorfologico ?? atual.diagnosticoMorfologico,
          classificacao: dados.classificacao ?? atual.classificacao,
          impressaoMacroscopica: dados.impressaoMacroscopica ?? atual.impressaoMacroscopica,
          observacoes: dados.observacoes ?? atual.observacoes,
          atualizadoEm: new Date(),
        })
        .where(eq(lesaoNecroscopica.id, lesaoId));
    });
  }

  /**
   * Liga duas lesoes (secao 76) - constroi o mapa fisiopatologico (secao 102).
   *
   * Ruptura esplenica → hemoperitonio → hipovolemia → choque. E o que separa
   * uma lista de achados de um raciocinio sobre a morte.
   */
  async relacionar(
    necropsiaId: string,
    dados: { origemId: string; destinoId: string; tipo?: RelacaoLesao; observacao?: string | null },
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);

      if (dados.origemId === dados.destinoId) {
        throw new BadRequestException('Uma lesão não se relaciona consigo mesma.');
      }

      const lesoes = await tx
        .select({ id: lesaoNecroscopica.id })
        .from(lesaoNecroscopica)
        .where(
          and(
            eq(lesaoNecroscopica.tenantId, ctx.tenantId),
            eq(lesaoNecroscopica.necropsiaId, necropsiaId),
          ),
        );
      const ids = new Set(lesoes.map((l) => l.id));
      if (!ids.has(dados.origemId) || !ids.has(dados.destinoId)) {
        throw new BadRequestException('As duas lesões precisam ser desta necropsia.');
      }

      await tx
        .insert(relacaoLesao)
        .values({
          tenantId: ctx.tenantId,
          necropsiaId,
          origemId: dados.origemId,
          destinoId: dados.destinoId,
          tipo: dados.tipo ?? 'causou',
          observacao: dados.observacao ?? null,
        })
        .onConflictDoUpdate({
          target: [relacaoLesao.tenantId, relacaoLesao.origemId, relacaoLesao.destinoId],
          set: { tipo: dados.tipo ?? 'causou', atualizadoEm: new Date() },
        });
    });
  }

  async removerRelacao(relacaoId: string): Promise<void> {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      await tx
        .delete(relacaoLesao)
        .where(and(eq(relacaoLesao.tenantId, ctx.tenantId), eq(relacaoLesao.id, relacaoId)));
    });
  }

  /**
   * Salva a causa mortis (secoes 107-113).
   *
   * `grauCerteza: 'indeterminada'` e resposta valida, nao pendencia - a secao
   * 111 e explicita: "isso nao devera ser tratado como falha de preenchimento.
   * Em determinadas situacoes, essa sera a conclusao cientificamente adequada".
   */
  async salvarCausaMortis(necropsiaId: string, dados: DadosCausaMortis): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);

      await tx
        .insert(causaMortis)
        .values({
          tenantId: ctx.tenantId,
          necropsiaId,
          causaImediata: dados.causaImediata ?? null,
          condicaoAntecedente: dados.condicaoAntecedente ?? null,
          causaBasica: dados.causaBasica ?? null,
          condicoesContribuintes: dados.condicoesContribuintes ?? null,
          mecanismoTerminal: dados.mecanismoTerminal ?? null,
          grauCerteza: dados.grauCerteza,
          diagnosticosDiferenciais: dados.diagnosticosDiferenciais ?? [],
          conclusao: dados.conclusao ?? null,
        })
        .onConflictDoUpdate({
          target: [causaMortis.tenantId, causaMortis.necropsiaId],
          set: {
            causaImediata: dados.causaImediata ?? null,
            condicaoAntecedente: dados.condicaoAntecedente ?? null,
            causaBasica: dados.causaBasica ?? null,
            condicoesContribuintes: dados.condicoesContribuintes ?? null,
            mecanismoTerminal: dados.mecanismoTerminal ?? null,
            grauCerteza: dados.grauCerteza,
            diagnosticosDiferenciais: dados.diagnosticosDiferenciais ?? [],
            conclusao: dados.conclusao ?? null,
            atualizadoEm: new Date(),
          },
        });
    });
  }

  /**
   * Conclui o exame.
   *
   * Roda a checagem consolidada do Guardian (secoes 116-118). Um achado
   * `critico` barra - a conclusao necroscopica e o que o laudo vai afirmar
   * sobre por que o animal morreu, e extrapolacao ali nao e detalhe de estilo.
   */
  async concluir(necropsiaId: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      if (atual.concluidaEm) throw new BadRequestException('Esta necropsia já foi concluída.');

      const achados = await this.guardian.verificarNecropsia(tx, necropsiaId);
      this.guardian.garantirSemBloqueio(achados, 'concluir a necropsia');

      await tx
        .update(necropsia)
        .set({ concluidaEm: new Date(), atualizadoEm: new Date() })
        .where(eq(necropsia.id, necropsiaId));

      await this.eventos.publicar(tx, {
        tipo: 'necropsia.concluida',
        casoId: atual.casoId,
        moduloOrigem: MODULOS.M14_NECROPSIA,
        objetoTipo: 'necropsia',
        objetoId: necropsiaId,
      });
    });
  }

  /** Reabre para correcao: o exame volta a aceitar edicao. */
  async reabrir(necropsiaId: string, motivo: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      if (!atual.concluidaEm) throw new BadRequestException('Esta necropsia não está concluída.');

      await tx
        .update(necropsia)
        .set({ concluidaEm: null, atualizadoEm: new Date() })
        .where(eq(necropsia.id, necropsiaId));

      await this.eventos.publicar(tx, {
        tipo: 'necropsia.reaberta',
        casoId: atual.casoId,
        moduloOrigem: MODULOS.M14_NECROPSIA,
        objetoTipo: 'necropsia',
        objetoId: necropsiaId,
        payload: { motivo },
      });
    });
  }

  /** Bancada completa: o que a tela precisa para trabalhar. */
  async porCaso(casoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [registro] = await tx
        .select()
        .from(necropsia)
        .where(and(eq(necropsia.tenantId, ctx.tenantId), eq(necropsia.casoId, casoId)))
        .limit(1);

      if (!registro) return null;

      const orgaos = await tx
        .select()
        .from(exameOrgao)
        .where(
          and(eq(exameOrgao.tenantId, ctx.tenantId), eq(exameOrgao.necropsiaId, registro.id)),
        )
        .orderBy(asc(exameOrgao.cavidade), asc(exameOrgao.orgao));

      const lesoes = await tx
        .select()
        .from(lesaoNecroscopica)
        .where(
          and(
            eq(lesaoNecroscopica.tenantId, ctx.tenantId),
            eq(lesaoNecroscopica.necropsiaId, registro.id),
          ),
        )
        .orderBy(asc(lesaoNecroscopica.codigo));

      const relacoes = await tx
        .select()
        .from(relacaoLesao)
        .where(
          and(eq(relacaoLesao.tenantId, ctx.tenantId), eq(relacaoLesao.necropsiaId, registro.id)),
        );

      const [causa] = await tx
        .select()
        .from(causaMortis)
        .where(
          and(eq(causaMortis.tenantId, ctx.tenantId), eq(causaMortis.necropsiaId, registro.id)),
        )
        .limit(1);

      return {
        necropsia: registro,
        orgaos,
        lesoes,
        relacoes,
        causaMortis: causa ?? null,
        /**
         * Secao 72: checklist de completude anatomica. Contar so os examinados
         * seria enganoso - o que importa e quantos ficaram de fora.
         */
        completude: {
          examinados: orgaos.filter((o) => o.estado !== 'nao_examinado').length,
          naoExaminados: orgaos.filter((o) => o.estado === 'nao_examinado').length,
          comAlteracao: orgaos.filter((o) => o.estado === 'alterado').length,
        },
        /** Secao 97: quantos achados participam da cadeia causal. */
        lesoesCausais: lesoes.filter(
          (l) => l.classificacao && CLASSIFICACOES_CAUSAIS.includes(l.classificacao),
        ).length,
      };
    });
  }

  /** Conferencia do Guardian sem concluir - o painel mostra antes do clique. */
  async conferir(necropsiaId: string) {
    return this.db.executar((tx) => this.guardian.verificarNecropsia(tx, necropsiaId));
  }

  // --- internos ------------------------------------------------------------

  private garantirEmAndamento(registro: { concluidaEm: Date | null }): void {
    if (registro.concluidaEm) {
      throw new BadRequestException(
        'Necropsia concluída não aceita edição. Reabra o exame para corrigir.',
      );
    }
  }

  private async buscar(tx: Transacao, necropsiaId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(necropsia)
      .where(and(eq(necropsia.tenantId, ctx.tenantId), eq(necropsia.id, necropsiaId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Necropsia não encontrada.');
    return registro;
  }

  private async exigirCaso(tx: Transacao, casoId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select({ id: caso.id })
      .from(caso)
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);
    if (!registro) throw new NotFoundException('Caso não encontrado.');
    return registro;
  }

  private async exigirCadaver(tx: Transacao, cadaverId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select({ id: cadaver.id })
      .from(cadaver)
      .where(and(eq(cadaver.tenantId, ctx.tenantId), eq(cadaver.id, cadaverId)))
      .limit(1);
    if (!registro) throw new NotFoundException('Cadáver não encontrado.');
    return registro;
  }
}
