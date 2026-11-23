import { randomBytes, createHash } from 'node:crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  cadaver,
  causaMortis,
  caso,
  exameOrgao,
  formularioNecropsia,
  lesaoNecroscopica,
  marcadorCorporal,
  necropsia,
  notificacaoPendente,
  paciente,
  relacaoLesao,
  tenant,
  termo,
  type Transacao,
} from '@lapato/db';
import {
  CLASSIFICACOES_CAUSAIS,
  ESCALA_MAPA_CORPORAL,
  MODULOS,
  PERGUNTAS_FORMULARIO_NECROPSIA,
  type CavidadeNecropsia,
  type ClassificacaoLesao,
  type ConservacaoNecropsia,
  type EstadoExameOrgao,
  type GrauCertezaCausa,
  type MecanismoTerminal,
  type ModalidadeNecropsia,
  type RelacaoLesao,
  type TipoMarcadorCorporal,
  type VistaMapaCorporal,
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
  // --- Quinta revisao: o cadastro do caso de necropsia --------------------
  /** Com devolucao | Sem devolucao - o combinado, antes de o corpo chegar. */
  devolucaoCorpo?: boolean | null;
  /** Valor combinado com o tutor; o tutor NAO edita este campo. */
  valorCombinado?: number | null;
  responsavelDocumento?: string | null;
  responsavelCidade?: string | null;
  responsavelUf?: string | null;
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

export interface DadosMarcador {
  tipo: TipoMarcadorCorporal;
  vista: VistaMapaCorporal;
  /** 0 a 1000, por mil da largura e da altura da vista (secao 62). */
  x: number;
  y: number;
  descricao?: string | null;
  /** Aponta para um Objeto Lesao ja existente... */
  lesaoId?: string | null;
  /** ...ou cria um na mesma transacao e aponta para ele. */
  lesao?: DadosLesao | null;
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
          devolucaoCorpo: dados.devolucaoCorpo ?? null,
          valorCombinado: dados.valorCombinado?.toString() ?? null,
          responsavelDocumento: dados.responsavelDocumento?.trim() || null,
          responsavelCidade: dados.responsavelCidade?.trim() || null,
          responsavelUf: dados.responsavelUf?.trim().toUpperCase() || null,
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

  // --- formulario ao tutor (quinta revisao) --------------------------------

  /**
   * Gera o link do formulario e o enfileira para o tutor.
   *
   * Quinta revisao: "ao clicar em Enviar formulario, o formulario de
   * solicitacao e autorizacao de necropsia e enviado via whatsapp e/ou email
   * para o tutor, finalizar o preenchimento".
   *
   * Mesmo desenho do convite de autocadastro do M03, e pelos mesmos motivos: o
   * token tem 32 bytes, so o HASH e guardado, a validade e curta e o uso e
   * unico. O link vai por WhatsApp - passa por aparelho de terceiro e fica no
   * historico da conversa -, entao guardar o token em claro seria guardar a
   * chave junto da porta.
   *
   * Como o M11 e o M05, o M14 NAO envia: ele enfileira. Quem escolhe canal,
   * monta a mensagem e registra a entrega e o M26.
   */
  async enviarFormulario(
    necropsiaId: string,
    dados: { canal: 'whatsapp' | 'email' | 'ambos'; telefone?: string | null; email?: string | null },
  ): Promise<{ caminho: string; expiraEm: Date }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const alvo = await this.buscar(tx, necropsiaId);

      const [instituicao] = await this.db.raw
        .select({ slug: tenant.slug })
        .from(tenant)
        .where(eq(tenant.id, ctx.tenantId))
        .limit(1);
      if (!instituicao) throw new NotFoundException('Instituição não encontrada.');

      // Um link vivo por necropsia: gerar de novo encerra os anteriores.
      await tx
        .update(formularioNecropsia)
        .set({ expiraEm: new Date(), atualizadoEm: new Date() })
        .where(
          and(
            eq(formularioNecropsia.tenantId, ctx.tenantId),
            eq(formularioNecropsia.necropsiaId, necropsiaId),
            isNull(formularioNecropsia.respondidoEm),
          ),
        );

      const tokenBruto = randomBytes(32).toString('base64url');
      const expiraEm = new Date(Date.now() + 7 * 24 * 3_600_000);

      await tx.insert(formularioNecropsia).values({
        tenantId: ctx.tenantId,
        necropsiaId,
        tokenHash: hashDoToken(tokenBruto),
        expiraEm,
        canalEnvio: dados.canal,
        enviadoEm: new Date(),
        enviadoPorId: ctx.usuarioId,
      });

      const caminho = `/formulario-necropsia/${instituicao.slug}/${tokenBruto}`;

      /**
       * A fila do M26 leva o link. Dois registros quando o canal e "ambos":
       * WhatsApp e e-mail sao entregas distintas e falham por motivos
       * distintos - uma linha so esconderia qual das duas nao chegou.
       */
      for (const canal of dados.canal === 'ambos' ? ['whatsapp', 'email'] : [dados.canal]) {
        await tx.insert(notificacaoPendente).values({
          tenantId: ctx.tenantId,
          casoId: alvo.casoId,
          canal,
          destinatarioTipo: 'tutor',
          destinatarioEndereco:
            canal === 'whatsapp' ? (dados.telefone ?? null) : (dados.email ?? null),
          assunto: 'Formulário de solicitação e autorização de necropsia',
          corpo: `Preencha o formulário em ${caminho}`,
        });
      }

      await this.eventos.publicar(tx, {
        tipo: 'necropsia.formulario_enviado',
        casoId: alvo.casoId,
        moduloOrigem: MODULOS.M14_NECROPSIA,
        objetoTipo: 'necropsia',
        objetoId: necropsiaId,
        payload: { canal: dados.canal, expiraEm: expiraEm.toISOString() },
      });

      return { caminho, expiraEm };
    });
  }

  /**
   * O formulario preenchido pelo proprio tecnico, sem link.
   *
   * Quinta revisao: "ao clicar em Preencher formulario, o formulario e aberto e
   * o proprio tecnico ira preenche-lo" - o tutor que esta na recepcao, ou que
   * ditou por telefone. Fica marcado como `tecnico` porque quem respondeu
   * muda o peso do que esta escrito: relato colhido de terceiro nao e
   * declaracao assinada pelo tutor.
   */
  async preencherFormulario(
    necropsiaId: string,
    respostas: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const alvo = await this.buscar(tx, necropsiaId);

      const [novo] = await tx
        .insert(formularioNecropsia)
        .values({
          tenantId: ctx.tenantId,
          necropsiaId,
          respostas,
          respondidoEm: new Date(),
          respondidoPor: 'tecnico',
        })
        .returning({ id: formularioNecropsia.id });

      await this.aplicarRespostas(tx, necropsiaId, respostas);

      await this.eventos.publicar(tx, {
        tipo: 'necropsia.formulario_respondido',
        casoId: alvo.casoId,
        moduloOrigem: MODULOS.M14_NECROPSIA,
        objetoTipo: 'necropsia',
        objetoId: necropsiaId,
        payload: { por: 'tecnico', campos: Object.keys(respostas) },
      });

      return { id: novo!.id };
    });
  }

  /** O que o tutor ve ao abrir o link. O valor vai junto, mas travado. */
  async lerFormularioPublico(tenantSlug: string, tokenBruto: string) {
    const { tenantId, formulario } = await this.resolverFormulario(tenantSlug, tokenBruto);

    return this.db.executarComTenant(tenantId, async (tx) => {
      const [instituicao] = await this.db.raw
        .select({ nome: tenant.nomeFantasia })
        .from(tenant)
        .where(eq(tenant.id, tenantId))
        .limit(1);

      const [dados] = await tx
        .select({
          modalidade: necropsia.modalidade,
          responsavelSolicitacao: necropsia.responsavelSolicitacao,
          contatoResponsavel: necropsia.contatoResponsavel,
          responsavelDocumento: necropsia.responsavelDocumento,
          responsavelCidade: necropsia.responsavelCidade,
          responsavelUf: necropsia.responsavelUf,
          devolucaoCorpo: necropsia.devolucaoCorpo,
          valorCombinado: necropsia.valorCombinado,
          obitoEm: necropsia.obitoEm,
          circunstanciasMorte: necropsia.circunstanciasMorte,
          perguntasSolicitante: necropsia.perguntasSolicitante,
          paciente: paciente.nome,
          especie: termo.valor,
        })
        .from(necropsia)
        .innerJoin(caso, eq(caso.id, necropsia.casoId))
        .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
        .leftJoin(termo, eq(termo.id, paciente.especieId))
        .where(eq(necropsia.id, formulario.necropsiaId))
        .limit(1);

      if (!dados) throw new NotFoundException('Formulário não encontrado.');

      return {
        instituicao: instituicao?.nome ?? '',
        expiraEm: formulario.expiraEm,
        /**
         * O valor vai para a tela, mas como LEITURA: "todos os dados
         * inseridos, a excecao do valor, podem ser editados pelo tutor". Ele
         * precisa ver o que esta autorizando - esconder o preco de quem assina
         * a autorizacao seria pior do que deixa-lo editar.
         */
        valorCombinado: dados.valorCombinado,
        dados: {
          paciente: dados.paciente,
          especie: dados.especie,
          modalidade: dados.modalidade,
          responsavelSolicitacao: dados.responsavelSolicitacao,
          contatoResponsavel: dados.contatoResponsavel,
          responsavelDocumento: dados.responsavelDocumento,
          responsavelCidade: dados.responsavelCidade,
          responsavelUf: dados.responsavelUf,
          devolucaoCorpo: dados.devolucaoCorpo,
          obitoEm: dados.obitoEm,
          circunstanciasMorte: dados.circunstanciasMorte,
          perguntasSolicitante: dados.perguntasSolicitante,
        },
      };
    });
  }

  /**
   * O tutor envia o formulario. Uso unico: respondido, o link morre.
   *
   * O `valorCombinado` NAO entra, nem que venha no corpo: e a unica trava do
   * formulario, e ela e de negocio - o preco foi acordado com o laboratorio.
   */
  async responderFormularioPublico(
    tenantSlug: string,
    tokenBruto: string,
    respostas: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const { tenantId, formulario } = await this.resolverFormulario(tenantSlug, tokenBruto);

    const { valorCombinado: _ignorado, ...limpas } = respostas as Record<string, unknown> & {
      valorCombinado?: unknown;
    };

    return this.db.executarComTenant(tenantId, async (tx) => {
      await tx
        .update(formularioNecropsia)
        .set({
          respostas: limpas,
          respondidoEm: new Date(),
          respondidoPor: 'tutor',
          atualizadoEm: new Date(),
        })
        .where(eq(formularioNecropsia.id, formulario.id));

      await this.aplicarRespostas(tx, formulario.necropsiaId, limpas);

      /**
       * Nao ha usuario de sessao nesta rota, e e por isso que o evento vai por
       * `publicarSemSessao`: a linha do tempo precisa registrar que o tutor
       * respondeu, e `usuario_id` nulo e exatamente como se diz "nao foi
       * ninguem da casa".
       */
      await this.eventos.publicarSemSessao(tx, tenantId, {
        tipo: 'necropsia.formulario_respondido',
        casoId: formulario.casoId,
        moduloOrigem: MODULOS.M14_NECROPSIA,
        objetoTipo: 'necropsia',
        objetoId: formulario.necropsiaId,
        visibilidade: 'externo',
        payload: { por: 'tutor', campos: Object.keys(limpas) },
      });

      return { ok: true as const };
    });
  }

  /**
   * As respostas que tem casa propria na necropsia saem do jsonb e vao para a
   * coluna: a tela do exame le `obitoEm` e `circunstanciasMorte` como campos, e
   * o Guardian confere o obito. O resto fica no mapa, que e o questionario.
   */
  private async aplicarRespostas(
    tx: Transacao,
    necropsiaId: string,
    respostas: Record<string, unknown>,
  ): Promise<void> {
    const mudancas: Record<string, unknown> = {};

    for (const pergunta of PERGUNTAS_FORMULARIO_NECROPSIA) {
      if (!pergunta.destino) continue;
      const bruto = respostas[pergunta.chave];
      if (typeof bruto !== 'string' || !bruto.trim()) continue;

      if (pergunta.destino === 'obitoEm') {
        // Data invalida nao derruba o resto do formulario: a resposta fica no
        // mapa e a coluna permanece vazia, que e o estado honesto.
        const quando = Date.parse(bruto);
        if (!Number.isNaN(quando)) mudancas.obitoEm = new Date(quando);
        continue;
      }
      mudancas[pergunta.destino] = bruto.trim();
    }

    if (Object.keys(mudancas).length === 0) return;
    await tx
      .update(necropsia)
      .set({ ...mudancas, atualizadoEm: new Date() })
      .where(eq(necropsia.id, necropsiaId));
  }

  private async resolverFormulario(tenantSlug: string, tokenBruto: string) {
    const [instituicao] = await this.db.raw
      .select({ id: tenant.id })
      .from(tenant)
      .where(and(eq(tenant.slug, tenantSlug), isNull(tenant.inativadoEm)))
      .limit(1);
    if (!instituicao || !tokenBruto || tokenBruto.length < 20) {
      throw new NotFoundException('Formulário não encontrado.');
    }

    const formulario = await this.db.executarComTenant(instituicao.id, async (tx) => {
      const [f] = await tx
        .select({
          id: formularioNecropsia.id,
          necropsiaId: formularioNecropsia.necropsiaId,
          expiraEm: formularioNecropsia.expiraEm,
          respondidoEm: formularioNecropsia.respondidoEm,
          casoId: necropsia.casoId,
        })
        .from(formularioNecropsia)
        .innerJoin(necropsia, eq(necropsia.id, formularioNecropsia.necropsiaId))
        .where(
          and(
            eq(formularioNecropsia.tenantId, instituicao.id),
            eq(formularioNecropsia.tokenHash, hashDoToken(tokenBruto)),
          ),
        )
        .limit(1);
      return f ?? null;
    });

    if (!formulario) throw new NotFoundException('Formulário não encontrado.');
    if (formulario.respondidoEm) throw new GoneException('Este formulário já foi enviado.');
    if (!formulario.expiraEm || formulario.expiraEm.getTime() < Date.now()) {
      throw new NotFoundException('Formulário não encontrado.');
    }
    return { tenantId: instituicao.id, formulario };
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
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);
      return this.inserirLesao(tx, necropsiaId, dados);
    });
  }

  /**
   * Mapa corporal (secao 62). O marcador e uma posicao numa silhueta e pode
   * apontar para um Objeto Lesao - existente ou criado aqui mesmo, na mesma
   * transacao, para o gesto "marquei e descrevi" nao virar dois passos.
   */
  async criarMarcador(
    necropsiaId: string,
    dados: DadosMarcador,
  ): Promise<{ id: string; lesaoId: string | null; codigoLesao: string | null }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, necropsiaId);
      this.garantirEmAndamento(atual);
      this.garantirPosicao(dados.x, dados.y);

      let lesaoId = dados.lesaoId ?? null;
      let codigoLesao: string | null = null;
      if (lesaoId) {
        codigoLesao = (await this.exigirLesaoDaNecropsia(tx, necropsiaId, lesaoId)).codigo;
      } else if (dados.lesao) {
        const criada = await this.inserirLesao(tx, necropsiaId, dados.lesao);
        lesaoId = criada.id;
        codigoLesao = criada.codigo;
      }

      const [novo] = await tx
        .insert(marcadorCorporal)
        .values({
          tenantId: ctx.tenantId,
          necropsiaId,
          tipo: dados.tipo,
          vista: dados.vista,
          x: Math.round(dados.x),
          y: Math.round(dados.y),
          descricao: dados.descricao?.trim() || null,
          lesaoId,
          criadoPorId: ctx.usuarioId,
        })
        .returning({ id: marcadorCorporal.id });

      return { id: novo!.id, lesaoId, codigoLesao };
    });
  }

  async editarMarcador(
    marcadorId: string,
    dados: Partial<Omit<DadosMarcador, 'lesao'>>,
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.exigirMarcador(tx, marcadorId);
      this.garantirEmAndamento(await this.buscar(tx, atual.necropsiaId));

      const x = dados.x ?? atual.x;
      const y = dados.y ?? atual.y;
      this.garantirPosicao(x, y);

      // `undefined` mantem; `null` desliga da lesao.
      let lesaoId = atual.lesaoId;
      if (dados.lesaoId !== undefined) {
        if (dados.lesaoId) await this.exigirLesaoDaNecropsia(tx, atual.necropsiaId, dados.lesaoId);
        lesaoId = dados.lesaoId;
      }

      await tx
        .update(marcadorCorporal)
        .set({
          tipo: dados.tipo ?? atual.tipo,
          vista: dados.vista ?? atual.vista,
          x: Math.round(x),
          y: Math.round(y),
          descricao: dados.descricao === undefined ? atual.descricao : dados.descricao?.trim() || null,
          lesaoId,
          atualizadoEm: new Date(),
        })
        .where(eq(marcadorCorporal.id, marcadorId));
    });
  }

  /**
   * O marcador e rascunho da bancada, nao registro clinico: pode ser desfeito
   * enquanto a necropsia esta em andamento. A lesao que ele apontava fica.
   */
  async removerMarcador(marcadorId: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.exigirMarcador(tx, marcadorId);
      this.garantirEmAndamento(await this.buscar(tx, atual.necropsiaId));
      await tx.delete(marcadorCorporal).where(eq(marcadorCorporal.id, marcadorId));
    });
  }

  private async inserirLesao(
    tx: Transacao,
    necropsiaId: string,
    dados: DadosLesao,
  ): Promise<{ id: string; codigo: string }> {
    const ctx = exigirContexto();
    {
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
    }
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

      const marcadores = await tx
        .select()
        .from(marcadorCorporal)
        .where(
          and(
            eq(marcadorCorporal.tenantId, ctx.tenantId),
            eq(marcadorCorporal.necropsiaId, registro.id),
          ),
        )
        .orderBy(asc(marcadorCorporal.criadoEm));

      return {
        necropsia: registro,
        orgaos,
        lesoes,
        relacoes,
        marcadores,
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

  private garantirPosicao(x: number, y: number): void {
    const dentro = (v: number) => Number.isFinite(v) && v >= 0 && v <= ESCALA_MAPA_CORPORAL;
    if (!dentro(x) || !dentro(y)) {
      throw new BadRequestException(
        `A posição do marcador é por mil da vista: x e y entre 0 e ${ESCALA_MAPA_CORPORAL}.`,
      );
    }
  }

  private async exigirMarcador(tx: Transacao, marcadorId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(marcadorCorporal)
      .where(and(eq(marcadorCorporal.tenantId, ctx.tenantId), eq(marcadorCorporal.id, marcadorId)))
      .limit(1);
    if (!registro) throw new NotFoundException('Marcador não encontrado.');
    return registro;
  }

  private async exigirLesaoDaNecropsia(tx: Transacao, necropsiaId: string, lesaoId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select({ id: lesaoNecroscopica.id, codigo: lesaoNecroscopica.codigo })
      .from(lesaoNecroscopica)
      .where(
        and(
          eq(lesaoNecroscopica.tenantId, ctx.tenantId),
          eq(lesaoNecroscopica.necropsiaId, necropsiaId),
          eq(lesaoNecroscopica.id, lesaoId),
        ),
      )
      .limit(1);
    if (!registro) throw new BadRequestException('A lesão não pertence a esta necropsia.');
    return registro;
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

/**
 * O token nunca e guardado em claro: no banco fica so o hash. Vazar a tabela
 * nao vaza nenhum link vivo - e o mesmo criterio do convite de autocadastro do
 * cliente (M03) e da validacao publica de laudo (M11).
 */
function hashDoToken(tokenBruto: string): string {
  return createHash('sha256').update(tokenBruto).digest('hex');
}
