import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  cienciaDocumento,
  comentarioRevisao,
  documentoBiblioteca,
  feedbackDocumento,
  usuario,
  versaoDocumento,
  type Transacao,
} from '@lapato/db';
import {
  MIMES_ANEXO_BIBLIOTECA,
  MODULOS,
  PERMISSOES,
  SIGLA_CATEGORIA_DOCUMENTO,
  SIGLA_TIPO_DOCUMENTO,
  TAMANHO_MAXIMO_ANEXO_BIBLIOTECA,
  codigoDocumento,
  proximaVersao,
  type CategoriaDocumento,
  type ContextoBiblioteca,
  type DesfechoRevisao,
  type PublicoDocumento,
  type StatusDocumento,
  type TipoDocumento,
  type TipoFeedbackDocumento,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { StorageFactory } from '../../core/storage/storage.provider.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';
import type { ArquivoRecebido } from '../m16-imagens/imagens.service.js';

export interface DadosDocumento {
  titulo: string;
  tipo: TipoDocumento;
  categoria: CategoriaDocumento;
  subcategoria?: string | null;
  colecoes?: string[];
  palavrasChave?: string[];
  resumo?: string | null;
  responsavelId?: string | null;
  publico?: PublicoDocumento;
  contextos?: ContextoBiblioteca[];
  exigeAprovacao?: boolean;
  exigeCiencia?: boolean;
  critico?: boolean;
  permiteDownload?: boolean;
  revisaoPeriodicaMeses?: number | null;
  /** Secao 11: codigo informado pela instituicao; vazio gera pelo padrao. */
  codigo?: string | null;
}

export interface DadosVersao {
  conteudo?: string | null;
  linkExterno?: string | null;
  motivoRevisao?: string | null;
  /** Secao 17/18: alteracao relevante avanca o numero maior. */
  relevante?: boolean;
}

/**
 * M21 - Biblioteca.
 *
 * O que estrutura o servico e a secao 129:
 *
 * - todo documento tem identificacao, responsavel e status (1);
 * - publicado tem versao, e alteracao relevante gera versao nova (2, 3);
 * - versao anterior nao e apagada (4); so a vigente e orientacao padrao (5);
 * - documento controlado pode exigir revisao e aprovacao (6);
 * - conteudo externo e explicitamente autorizado para o Portal (7);
 * - ciencia registra usuario e VERSAO (9).
 */
@Injectable()
export class BibliotecaService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly storage: StorageFactory,
    private readonly numeracao: NumeracaoService,
    private readonly guardian: GuardianService,
  ) {}

  /** Secao 100, para o painel. */
  async varreduraGuardian() {
    return this.db.executar((tx) => this.guardian.verificarBiblioteca(tx));
  }

  // --- documento -----------------------------------------------------------------

  /** Secao 13: cria o documento e a versao 1.0 em rascunho. */
  async criar(dados: DadosDocumento, versao: DadosVersao = {}) {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const codigo = dados.codigo?.trim() || (await this.gerarCodigo(tx, dados.tipo, dados.categoria));

      // Secao 10: o codigo e unico. Conferir antes da a mensagem certa em vez
      // de um 500 vindo da constraint - que continua la, para a corrida.
      const [existente] = await tx
        .select({ id: documentoBiblioteca.id })
        .from(documentoBiblioteca)
        .where(and(eq(documentoBiblioteca.tenantId, ctx.tenantId), eq(documentoBiblioteca.codigo, codigo)))
        .limit(1);
      if (existente) throw new BadRequestException(`Já existe um documento com o código ${codigo}.`);

      const [doc] = await tx
        .insert(documentoBiblioteca)
        .values({
          tenantId: ctx.tenantId,
          codigo,
          titulo: dados.titulo.trim(),
          tipo: dados.tipo,
          categoria: dados.categoria,
          subcategoria: dados.subcategoria?.trim() || null,
          colecoes: dados.colecoes ?? [],
          palavrasChave: dados.palavrasChave ?? [],
          resumo: dados.resumo?.trim() || null,
          responsavelId: dados.responsavelId ?? ctx.usuarioId,
          publico: dados.publico ?? 'colaboradores',
          contextos: dados.contextos ?? [],
          exigeAprovacao: dados.exigeAprovacao ?? false,
          exigeCiencia: dados.exigeCiencia ?? false,
          critico: dados.critico ?? false,
          permiteDownload: dados.permiteDownload ?? true,
          revisaoPeriodicaMeses: dados.revisaoPeriodicaMeses ?? null,
          criadoPorId: ctx.usuarioId,
        })
        .returning({ id: documentoBiblioteca.id, codigo: documentoBiblioteca.codigo });

      const [v] = await tx
        .insert(versaoDocumento)
        .values({
          tenantId: ctx.tenantId,
          documentoId: doc!.id,
          numero: '1.0',
          conteudo: versao.conteudo ?? null,
          linkExterno: versao.linkExterno ?? null,
          motivoRevisao: versao.motivoRevisao ?? 'Versão inicial.',
          autorId: ctx.usuarioId,
        })
        .returning({ id: versaoDocumento.id });

      await this.auditoria.registrar(tx, {
        entidade: 'documento_biblioteca',
        entidadeId: doc!.id,
        acao: 'criar',
        valorNovo: { codigo: doc!.codigo, titulo: dados.titulo, tipo: dados.tipo },
      });
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.documento_criado',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'documento_biblioteca',
        objetoId: doc!.id,
        visibilidade: 'interno',
        payload: { codigo: doc!.codigo, titulo: dados.titulo },
      });

      return { id: doc!.id, codigo: doc!.codigo, versaoId: v!.id };
    });
  }

  /** Metadados. O codigo nao muda (secao 11); o conteudo muda por versao. */
  async editar(documentoId: string, dados: Partial<Omit<DadosDocumento, 'codigo'>>) {
    await this.db.executar(async (tx) => {
      const doc = await this.buscarDocumento(tx, documentoId);
      this.exigirEditor(doc);
      const antes = { ...doc };
      const depois = {
        titulo: dados.titulo?.trim() ?? doc.titulo,
        tipo: dados.tipo ?? doc.tipo,
        categoria: dados.categoria ?? doc.categoria,
        subcategoria: dados.subcategoria === undefined ? doc.subcategoria : dados.subcategoria?.trim() || null,
        colecoes: dados.colecoes ?? doc.colecoes,
        palavrasChave: dados.palavrasChave ?? doc.palavrasChave,
        resumo: dados.resumo === undefined ? doc.resumo : dados.resumo?.trim() || null,
        responsavelId: dados.responsavelId === undefined ? doc.responsavelId : dados.responsavelId,
        publico: dados.publico ?? doc.publico,
        contextos: dados.contextos ?? doc.contextos,
        exigeAprovacao: dados.exigeAprovacao ?? doc.exigeAprovacao,
        exigeCiencia: dados.exigeCiencia ?? doc.exigeCiencia,
        critico: dados.critico ?? doc.critico,
        permiteDownload: dados.permiteDownload ?? doc.permiteDownload,
        revisaoPeriodicaMeses:
          dados.revisaoPeriodicaMeses === undefined ? doc.revisaoPeriodicaMeses : dados.revisaoPeriodicaMeses,
        atualizadoEm: new Date(),
      };
      await tx.update(documentoBiblioteca).set(depois).where(eq(documentoBiblioteca.id, documentoId));
      await this.auditoria.registrarAlteracao(tx, 'documento_biblioteca', documentoId, antes, depois);
    });
  }

  // --- versoes (secoes 17 a 29) ----------------------------------------------

  /**
   * Abre uma versao nova. So uma em elaboracao por vez: duas versoes em
   * rascunho do mesmo documento seriam duas verdades candidatas.
   */
  async novaVersao(documentoId: string, dados: DadosVersao) {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const doc = await this.buscarDocumento(tx, documentoId);
      this.exigirEditor(doc);
      if (doc.status === 'arquivado') throw new BadRequestException('Documento arquivado não recebe versão nova.');

      const [aberta] = await tx
        .select({ id: versaoDocumento.id, numero: versaoDocumento.numero })
        .from(versaoDocumento)
        .where(
          and(
            eq(versaoDocumento.documentoId, documentoId),
            inArray(versaoDocumento.status, ['rascunho', 'em_revisao', 'aguardando_aprovacao', 'aprovada']),
          ),
        )
        .limit(1);
      if (aberta) {
        throw new BadRequestException(
          `A versão ${aberta.numero} ainda está em elaboração. Publique ou descarte antes de abrir outra.`,
        );
      }

      const [ultima] = await tx
        .select({ numero: versaoDocumento.numero })
        .from(versaoDocumento)
        .where(eq(versaoDocumento.documentoId, documentoId))
        .orderBy(desc(versaoDocumento.criadoEm))
        .limit(1);

      const numero = proximaVersao(ultima?.numero ?? null, dados.relevante ?? false);
      const [v] = await tx
        .insert(versaoDocumento)
        .values({
          tenantId: ctx.tenantId,
          documentoId,
          numero,
          conteudo: dados.conteudo ?? null,
          linkExterno: dados.linkExterno ?? null,
          motivoRevisao: dados.motivoRevisao ?? null,
          autorId: ctx.usuarioId,
        })
        .returning({ id: versaoDocumento.id });
      return { id: v!.id, numero };
    });
  }

  /** Edita o conteudo de uma versao ainda nao vigente. */
  async editarVersao(versaoId: string, dados: DadosVersao) {
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      this.exigirEditor(doc);
      if (versao.status === 'vigente' || versao.status === 'obsoleta') {
        throw new BadRequestException('Versão publicada não muda: abra uma nova (M21 §17).');
      }
      await tx
        .update(versaoDocumento)
        .set({
          conteudo: dados.conteudo === undefined ? versao.conteudo : dados.conteudo,
          linkExterno: dados.linkExterno === undefined ? versao.linkExterno : dados.linkExterno,
          motivoRevisao: dados.motivoRevisao === undefined ? versao.motivoRevisao : dados.motivoRevisao,
          // Mexer no conteudo depois de revisado volta ao inicio do ciclo.
          status: versao.status === 'rascunho' ? 'rascunho' : 'rascunho',
          atualizadoEm: new Date(),
        })
        .where(eq(versaoDocumento.id, versaoId));
    });
  }

  /** Secao 15: anexo. O arquivo vai para o storage e a versao guarda hash e nome. */
  async anexar(versaoId: string, arquivo: ArquivoRecebido) {
    const ctx = exigirContexto();
    const extensao = MIMES_ANEXO_BIBLIOTECA[arquivo.mimetype];
    if (!extensao) {
      throw new BadRequestException(`Formato não aceito (${arquivo.mimetype}). PDF, DOCX, PPTX, XLSX, imagem ou MP4.`);
    }
    if (arquivo.buffer.length > TAMANHO_MAXIMO_ANEXO_BIBLIOTECA) {
      throw new BadRequestException('Arquivo acima de 50 MB.');
    }
    const provedor = this.storage.criar();
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      this.exigirEditor(doc);
      if (versao.status === 'vigente' || versao.status === 'obsoleta') {
        throw new BadRequestException('Versão publicada não troca de arquivo: abra uma nova.');
      }
      const chave = `biblioteca/${ctx.tenantId}/${versaoId}/${Date.now()}.${extensao}`;
      const { hash } = await provedor.salvar(chave, arquivo.buffer, arquivo.mimetype);
      await tx
        .update(versaoDocumento)
        .set({
          arquivoChave: chave,
          arquivoNome: arquivo.originalname,
          arquivoMime: arquivo.mimetype,
          arquivoTamanho: arquivo.buffer.length,
          arquivoHash: hash,
          atualizadoEm: new Date(),
        })
        .where(eq(versaoDocumento.id, versaoId));
    });
  }

  /** Bytes do anexo, respeitando publico e `permiteDownload` (secao 91). */
  async baixarAnexo(versaoId: string) {
    const provedor = this.storage.criar();
    const { versao, doc } = await this.db.executar(async (tx) => {
      const r = await this.buscarVersao(tx, versaoId);
      this.exigirLeitor(r.doc);
      if (!r.doc.permiteDownload && !this.administra()) {
        throw new ForbiddenException('Este documento é só para visualização (M21 §91).');
      }
      return r;
    });
    if (!versao.arquivoChave) throw new NotFoundException('Esta versão não tem arquivo anexado.');
    const bytes = await provedor.baixar(versao.arquivoChave);
    return { bytes, mimeType: versao.arquivoMime ?? 'application/octet-stream', nome: versao.arquivoNome ?? `${doc.codigo}.bin` };
  }

  /** Secao 24: enviar para revisao. Sem revisor obrigatorio: quem tem `revisar` ve a fila. */
  async enviarParaRevisao(versaoId: string) {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      this.exigirEditor(doc);
      if (versao.status !== 'rascunho') throw new BadRequestException('Só rascunho vai para revisão.');
      if (!versao.conteudo && !versao.arquivoChave && !versao.linkExterno) {
        throw new BadRequestException('A versão está vazia: escreva, anexe ou aponte um link.');
      }
      const agora = new Date();
      await tx
        .update(versaoDocumento)
        .set({ status: 'em_revisao', enviadaRevisaoEm: agora, atualizadoEm: agora })
        .where(eq(versaoDocumento.id, versaoId));
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.enviado_revisao',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'versao_documento',
        objetoId: versaoId,
        visibilidade: 'interno',
        payload: { codigo: doc.codigo, numero: versao.numero, autorId: ctx.usuarioId },
      });
    });
  }

  /**
   * Secao 26: o revisor comenta, pede ajuste (a versao volta ao autor) ou
   * conclui (segue para aprovacao, ou fica pronta para publicar se o documento
   * nao exige aprovacao formal).
   */
  async revisar(versaoId: string, desfecho: DesfechoRevisao, texto: string) {
    const ctx = exigirContexto();
    if (!ctx.permissoes.has(PERMISSOES.BIBLIOTECA_REVISAR)) {
      throw new ForbiddenException('Revisar exige a permissão de revisor.');
    }
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      if (versao.status !== 'em_revisao') throw new BadRequestException('A versão não está em revisão.');
      if (versao.autorId === ctx.usuarioId && desfecho === 'revisao_concluida' && doc.exigeAprovacao) {
        throw new BadRequestException('Quem escreveu não conclui a própria revisão num documento controlado.');
      }

      await tx.insert(comentarioRevisao).values({
        tenantId: ctx.tenantId,
        versaoId,
        autorId: ctx.usuarioId,
        desfecho,
        texto: texto.trim(),
      });

      const agora = new Date();
      if (desfecho === 'ajuste_solicitado') {
        await tx
          .update(versaoDocumento)
          .set({ status: 'rascunho', atualizadoEm: agora })
          .where(eq(versaoDocumento.id, versaoId));
      } else if (desfecho === 'revisao_concluida') {
        await tx
          .update(versaoDocumento)
          .set({
            status: doc.exigeAprovacao ? 'aguardando_aprovacao' : 'aprovada',
            revisaoConcluidaEm: agora,
            revisadaPorId: ctx.usuarioId,
            atualizadoEm: agora,
          })
          .where(eq(versaoDocumento.id, versaoId));
        await this.eventos.publicar(tx, {
          tipo: 'biblioteca.revisao_concluida',
          moduloOrigem: MODULOS.M21_BIBLIOTECA,
          objetoTipo: 'versao_documento',
          objetoId: versaoId,
          visibilidade: 'interno',
          payload: { codigo: doc.codigo, numero: versao.numero, exigeAprovacao: doc.exigeAprovacao },
        });
      }
    });
  }

  /** Secoes 27-28: aprovacao formal, registrando quem, quando e qual versao. */
  async aprovar(versaoId: string) {
    const ctx = exigirContexto();
    this.exigirAdministrador();
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      if (versao.status !== 'aguardando_aprovacao') throw new BadRequestException('A versão não aguarda aprovação.');
      const agora = new Date();
      await tx
        .update(versaoDocumento)
        .set({ status: 'aprovada', aprovadaPorId: ctx.usuarioId, aprovadaEm: agora, atualizadoEm: agora })
        .where(eq(versaoDocumento.id, versaoId));
      await this.auditoria.registrar(tx, {
        entidade: 'versao_documento',
        entidadeId: versaoId,
        acao: 'aprovar',
        valorNovo: { codigo: doc.codigo, numero: versao.numero },
      });
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.aprovado',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'versao_documento',
        objetoId: versaoId,
        visibilidade: 'interno',
        payload: { codigo: doc.codigo, numero: versao.numero },
      });
    });
  }

  /**
   * Publicar (secoes 19, 20, 31, 33, 71).
   *
   * A vigente anterior vira obsoleta - nao e apagada. A proxima revisao e
   * calculada a partir de hoje. Se o documento exige ciencia, a nova versao
   * comeca com zero confirmacoes: e a regra da secao 71.
   *
   * Sem aprovacao exigida, publica de rascunho, em revisao ou aprovada; com
   * aprovacao exigida, so de aprovada.
   */
  async publicar(versaoId: string) {
    const ctx = exigirContexto();
    this.exigirAdministrador();
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      if (versao.status === 'vigente') throw new BadRequestException('Esta versão já é a vigente.');
      if (versao.status === 'obsoleta') throw new BadRequestException('Versão obsoleta não volta a vigorar: abra uma nova.');
      if (doc.exigeAprovacao && versao.status !== 'aprovada') {
        throw new BadRequestException('Documento controlado só publica versão aprovada (M21 §27).');
      }
      if (!versao.conteudo && !versao.arquivoChave && !versao.linkExterno) {
        throw new BadRequestException('A versão está vazia.');
      }

      const agora = new Date();
      await tx
        .update(versaoDocumento)
        .set({ status: 'obsoleta', obsoletaEm: agora, atualizadoEm: agora })
        .where(
          and(
            eq(versaoDocumento.documentoId, doc.id),
            eq(versaoDocumento.status, 'vigente'),
            ne(versaoDocumento.id, versaoId),
          ),
        );
      await tx
        .update(versaoDocumento)
        .set({ status: 'vigente', publicadaPorId: ctx.usuarioId, publicadaEm: agora, atualizadoEm: agora })
        .where(eq(versaoDocumento.id, versaoId));

      const proxima = doc.revisaoPeriodicaMeses
        ? new Date(agora.getFullYear(), agora.getMonth() + doc.revisaoPeriodicaMeses, agora.getDate())
        : null;
      await tx
        .update(documentoBiblioteca)
        .set({
          status: 'publicado',
          versaoVigenteId: versaoId,
          proximaRevisaoEm: proxima ? proxima.toISOString().slice(0, 10) : null,
          obsoletoEm: null,
          motivoSaida: null,
          atualizadoEm: agora,
        })
        .where(eq(documentoBiblioteca.id, doc.id));

      await this.auditoria.registrar(tx, {
        entidade: 'documento_biblioteca',
        entidadeId: doc.id,
        acao: 'publicar',
        valorAnterior: { versaoVigenteId: doc.versaoVigenteId },
        valorNovo: { versaoVigenteId: versaoId, numero: versao.numero },
      });
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.publicado',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'documento_biblioteca',
        objetoId: doc.id,
        visibilidade: doc.publico === 'clientes' ? 'externo' : 'interno',
        payload: { codigo: doc.codigo, titulo: doc.titulo, numero: versao.numero, exigeCiencia: doc.exigeCiencia },
      });
    });
  }

  /** Secoes 33-35: obsoleto ou arquivado, nunca apagado. */
  async retirarDeUso(documentoId: string, destino: 'obsoleto' | 'arquivado', motivo: string) {
    const ctx = exigirContexto();
    this.exigirAdministrador();
    await this.db.executar(async (tx) => {
      const doc = await this.buscarDocumento(tx, documentoId);
      const agora = new Date();
      await tx
        .update(versaoDocumento)
        .set({ status: 'obsoleta', obsoletaEm: agora, atualizadoEm: agora })
        .where(and(eq(versaoDocumento.documentoId, documentoId), eq(versaoDocumento.status, 'vigente')));
      await tx
        .update(documentoBiblioteca)
        .set({
          status: destino,
          versaoVigenteId: null,
          obsoletoEm: destino === 'obsoleto' ? agora : doc.obsoletoEm,
          arquivadoEm: destino === 'arquivado' ? agora : null,
          motivoSaida: motivo,
          atualizadoEm: agora,
        })
        .where(eq(documentoBiblioteca.id, documentoId));
      await this.auditoria.registrar(tx, {
        entidade: 'documento_biblioteca',
        entidadeId: documentoId,
        acao: destino,
        valorAnterior: { status: doc.status },
        valorNovo: { status: destino },
        justificativa: motivo,
      });
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.obsoleto',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'documento_biblioteca',
        objetoId: documentoId,
        visibilidade: 'interno',
        payload: { codigo: doc.codigo, destino, motivo, por: ctx.usuarioId },
      });
    });
  }

  // --- ciencia (secoes 69 a 72) ------------------------------------------------

  async confirmarCiencia(versaoId: string) {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const { versao, doc } = await this.buscarVersao(tx, versaoId);
      this.exigirLeitor(doc);
      if (versao.status !== 'vigente') throw new BadRequestException('Ciência se confirma na versão vigente.');
      await tx
        .insert(cienciaDocumento)
        .values({ tenantId: ctx.tenantId, versaoId, usuarioId: ctx.usuarioId })
        .onConflictDoNothing();
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.ciencia_confirmada',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'versao_documento',
        objetoId: versaoId,
        visibilidade: 'interno',
        payload: { codigo: doc.codigo, numero: versao.numero, usuarioId: ctx.usuarioId },
      });
    });
  }

  /** Secao 72: quem leu, quem nao leu, qual versao. A populacao e a equipe interna ativa. */
  async painelCiencia(documentoId: string) {
    const ctx = exigirContexto();
    this.exigirAdministrador();
    return this.db.executar(async (tx) => {
      const doc = await this.buscarDocumento(tx, documentoId);
      if (!doc.versaoVigenteId) return { documentoId, numero: null, leram: [], naoLeram: [] };
      const [versao] = await tx
        .select({ numero: versaoDocumento.numero })
        .from(versaoDocumento)
        .where(eq(versaoDocumento.id, doc.versaoVigenteId))
        .limit(1);

      const equipe = await tx
        .select({ id: usuario.id, nome: usuario.nomeCompleto })
        .from(usuario)
        .where(and(eq(usuario.tenantId, ctx.tenantId), eq(usuario.status, 'ativo'), isNull(usuario.clienteId)))
        .orderBy(asc(usuario.nomeCompleto));
      const ciencias = await tx
        .select({ usuarioId: cienciaDocumento.usuarioId, confirmadaEm: cienciaDocumento.confirmadaEm })
        .from(cienciaDocumento)
        .where(and(eq(cienciaDocumento.tenantId, ctx.tenantId), eq(cienciaDocumento.versaoId, doc.versaoVigenteId)));
      const quando = new Map(ciencias.map((c) => [c.usuarioId, c.confirmadaEm]));

      return {
        documentoId,
        numero: versao?.numero ?? null,
        leram: equipe.filter((u) => quando.has(u.id)).map((u) => ({ ...u, confirmadaEm: quando.get(u.id) })),
        naoLeram: equipe.filter((u) => !quando.has(u.id)),
      };
    });
  }

  // --- feedback (secoes 105 a 108) ---------------------------------------------

  async registrarFeedback(documentoId: string | null, tipo: TipoFeedbackDocumento, texto?: string | null) {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      if (documentoId) this.exigirLeitor(await this.buscarDocumento(tx, documentoId));
      const [f] = await tx
        .insert(feedbackDocumento)
        .values({ tenantId: ctx.tenantId, documentoId, usuarioId: ctx.usuarioId, tipo, texto: texto?.trim() || null })
        .returning({ id: feedbackDocumento.id });
      await this.eventos.publicar(tx, {
        tipo: 'biblioteca.feedback_recebido',
        moduloOrigem: MODULOS.M21_BIBLIOTECA,
        objetoTipo: 'feedback_documento',
        objetoId: f!.id,
        visibilidade: 'interno',
        payload: { documentoId, tipo },
      });
    });
  }

  async tratarFeedback(feedbackId: string) {
    const ctx = exigirContexto();
    this.exigirAdministrador();
    await this.db.executar(async (tx) => {
      const r = await tx
        .update(feedbackDocumento)
        .set({ tratadoEm: new Date(), tratadoPorId: ctx.usuarioId })
        .where(and(eq(feedbackDocumento.tenantId, ctx.tenantId), eq(feedbackDocumento.id, feedbackId)))
        .returning({ id: feedbackDocumento.id });
      if (r.length === 0) throw new NotFoundException('Feedback não encontrado.');
    });
  }

  // --- consulta (secoes 36 a 45, 51, 60, 102) --------------------------------

  /**
   * Busca (secoes 36-38). Por padrao devolve o que e vigente; `status` abre o
   * resto para quem edita. O termo e procurado no titulo, codigo, palavras-
   * chave, resumo e no CONTEUDO da versao vigente (secao 37).
   */
  async buscar(filtros: {
    q?: string;
    categoria?: CategoriaDocumento;
    tipo?: TipoDocumento;
    status?: StatusDocumento | 'todos';
    contexto?: ContextoBiblioteca;
    colecao?: string;
    apenasCriticos?: boolean;
  }) {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const q = filtros.q?.trim();
      const condicoes = [
        eq(documentoBiblioteca.tenantId, ctx.tenantId),
        this.filtroDePublico(),
        filtros.categoria ? eq(documentoBiblioteca.categoria, filtros.categoria) : undefined,
        filtros.tipo ? eq(documentoBiblioteca.tipo, filtros.tipo) : undefined,
        filtros.contexto ? sql`${filtros.contexto} = any(${documentoBiblioteca.contextos})` : undefined,
        filtros.colecao ? sql`${filtros.colecao} = any(${documentoBiblioteca.colecoes})` : undefined,
        filtros.apenasCriticos ? eq(documentoBiblioteca.critico, true) : undefined,
        filtros.status === 'todos'
          ? undefined
          : eq(documentoBiblioteca.status, filtros.status ?? 'publicado'),
        q
          ? or(
              ilike(documentoBiblioteca.titulo, `%${q}%`),
              ilike(documentoBiblioteca.codigo, `%${q}%`),
              ilike(documentoBiblioteca.resumo, `%${q}%`),
              sql`exists (select 1 from unnest(${documentoBiblioteca.palavrasChave}) p where p ilike ${'%' + q + '%'})`,
              sql`exists (select 1 from ${versaoDocumento} v where v.id = ${documentoBiblioteca.versaoVigenteId} and v.conteudo ilike ${'%' + q + '%'})`,
            )
          : undefined,
      ];

      const linhas = await tx
        .select({
          id: documentoBiblioteca.id,
          codigo: documentoBiblioteca.codigo,
          titulo: documentoBiblioteca.titulo,
          tipo: documentoBiblioteca.tipo,
          categoria: documentoBiblioteca.categoria,
          subcategoria: documentoBiblioteca.subcategoria,
          colecoes: documentoBiblioteca.colecoes,
          palavrasChave: documentoBiblioteca.palavrasChave,
          resumo: documentoBiblioteca.resumo,
          publico: documentoBiblioteca.publico,
          contextos: documentoBiblioteca.contextos,
          status: documentoBiblioteca.status,
          critico: documentoBiblioteca.critico,
          exigeCiencia: documentoBiblioteca.exigeCiencia,
          exigeAprovacao: documentoBiblioteca.exigeAprovacao,
          proximaRevisaoEm: documentoBiblioteca.proximaRevisaoEm,
          acessos: documentoBiblioteca.acessos,
          responsavel: usuario.nomeCompleto,
          versaoVigenteId: documentoBiblioteca.versaoVigenteId,
          numeroVigente: sql<string | null>`(select v.numero from ${versaoDocumento} v where v.id = ${documentoBiblioteca.versaoVigenteId})`,
          publicadaEm: sql<string | null>`(select v.publicada_em from ${versaoDocumento} v where v.id = ${documentoBiblioteca.versaoVigenteId})`,
          /** Coluna externa por extenso — mesma armadilha do M18. */
          versaoEmElaboracao: sql<string | null>`(
            select v.status::text from ${versaoDocumento} v
            where v.documento_id = documento_biblioteca.id and v.tenant_id = documento_biblioteca.tenant_id
              and v.status in ('rascunho','em_revisao','aguardando_aprovacao','aprovada')
            limit 1
          )`,
          cienciaConfirmada: sql<boolean>`exists (
            select 1 from ${cienciaDocumento} c
            where c.versao_id = documento_biblioteca.versao_vigente_id and c.usuario_id = ${ctx.usuarioId}
          )`,
          atualizadoEm: documentoBiblioteca.atualizadoEm,
        })
        .from(documentoBiblioteca)
        .leftJoin(usuario, eq(usuario.id, documentoBiblioteca.responsavelId))
        .where(and(...condicoes))
        .orderBy(desc(documentoBiblioteca.critico), asc(documentoBiblioteca.categoria), asc(documentoBiblioteca.titulo))
        .limit(300);

      /** Secao 104: pesquisa sem resultado e sinal de protocolo que falta. */
      if (q && linhas.length === 0) {
        await this.eventos.publicar(tx, {
          tipo: 'biblioteca.pesquisa_sem_resultado',
          moduloOrigem: MODULOS.M21_BIBLIOTECA,
          visibilidade: 'interno',
          payload: { termo: q, contexto: filtros.contexto ?? null },
        });
      }
      return linhas;
    });
  }

  /** Secoes 51 a 58: o que aparece no botao "Consultar Biblioteca" de uma tela. */
  async porContexto(contexto: ContextoBiblioteca) {
    return this.buscar({ contexto, status: 'publicado' });
  }

  /**
   * Secoes 59-61: o Portal so ve `publico = clientes` e vigente. Nao passa
   * pela permissao interna: o usuario externo tem so `portal:acessar`.
   */
  async orientacoesParaClientes() {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          id: documentoBiblioteca.id,
          codigo: documentoBiblioteca.codigo,
          titulo: documentoBiblioteca.titulo,
          tipo: documentoBiblioteca.tipo,
          categoria: documentoBiblioteca.categoria,
          resumo: documentoBiblioteca.resumo,
          versaoId: versaoDocumento.id,
          numero: versaoDocumento.numero,
          conteudo: versaoDocumento.conteudo,
          linkExterno: versaoDocumento.linkExterno,
          temArquivo: sql<boolean>`${versaoDocumento.arquivoChave} is not null`,
          arquivoNome: versaoDocumento.arquivoNome,
          publicadaEm: versaoDocumento.publicadaEm,
        })
        .from(documentoBiblioteca)
        .innerJoin(versaoDocumento, eq(versaoDocumento.id, documentoBiblioteca.versaoVigenteId))
        .where(
          and(
            eq(documentoBiblioteca.tenantId, ctx.tenantId),
            eq(documentoBiblioteca.status, 'publicado'),
            eq(documentoBiblioteca.publico, 'clientes'),
          ),
        )
        .orderBy(asc(documentoBiblioteca.categoria), asc(documentoBiblioteca.titulo)),
    );
  }

  /** Anexo de um documento publico, servido ao Portal sem a permissao interna. */
  async baixarAnexoPublico(versaoId: string) {
    const ctx = exigirContexto();
    const provedor = this.storage.criar();
    const [linha] = await this.db.executar((tx) =>
      tx
        .select({
          chave: versaoDocumento.arquivoChave,
          mime: versaoDocumento.arquivoMime,
          nome: versaoDocumento.arquivoNome,
        })
        .from(versaoDocumento)
        .innerJoin(documentoBiblioteca, eq(documentoBiblioteca.id, versaoDocumento.documentoId))
        .where(
          and(
            eq(versaoDocumento.tenantId, ctx.tenantId),
            eq(versaoDocumento.id, versaoId),
            eq(versaoDocumento.status, 'vigente'),
            eq(documentoBiblioteca.publico, 'clientes'),
            eq(documentoBiblioteca.permiteDownload, true),
          ),
        )
        .limit(1),
    );
    if (!linha?.chave) throw new NotFoundException('Arquivo não encontrado.');
    return { bytes: await provedor.baixar(linha.chave), mimeType: linha.mime ?? 'application/octet-stream', nome: linha.nome ?? 'documento' };
  }

  /** A ficha (secao 9), com versoes, comentarios e a ciencia de quem esta lendo. */
  async ficha(documentoId: string) {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const doc = await this.buscarDocumento(tx, documentoId);
      this.exigirLeitor(doc);

      // Secao 44: contador de consultas.
      await tx
        .update(documentoBiblioteca)
        .set({ acessos: sql`${documentoBiblioteca.acessos} + 1` })
        .where(eq(documentoBiblioteca.id, documentoId));

      const autor = usuario;
      const versoes = await tx
        .select({
          id: versaoDocumento.id,
          numero: versaoDocumento.numero,
          status: versaoDocumento.status,
          conteudo: versaoDocumento.conteudo,
          linkExterno: versaoDocumento.linkExterno,
          arquivoNome: versaoDocumento.arquivoNome,
          arquivoMime: versaoDocumento.arquivoMime,
          arquivoTamanho: versaoDocumento.arquivoTamanho,
          arquivoHash: versaoDocumento.arquivoHash,
          motivoRevisao: versaoDocumento.motivoRevisao,
          autor: autor.nomeCompleto,
          autorId: versaoDocumento.autorId,
          enviadaRevisaoEm: versaoDocumento.enviadaRevisaoEm,
          revisaoConcluidaEm: versaoDocumento.revisaoConcluidaEm,
          aprovadaEm: versaoDocumento.aprovadaEm,
          publicadaEm: versaoDocumento.publicadaEm,
          obsoletaEm: versaoDocumento.obsoletaEm,
          criadaEm: versaoDocumento.criadoEm,
          ciencias: sql<number>`(select count(*)::int from ${cienciaDocumento} c where c.versao_id = versao_documento.id)`,
        })
        .from(versaoDocumento)
        .leftJoin(autor, eq(autor.id, versaoDocumento.autorId))
        .where(eq(versaoDocumento.documentoId, documentoId))
        .orderBy(desc(versaoDocumento.criadoEm));

      const comentarios = await tx
        .select({
          id: comentarioRevisao.id,
          versaoId: comentarioRevisao.versaoId,
          desfecho: comentarioRevisao.desfecho,
          texto: comentarioRevisao.texto,
          autor: usuario.nomeCompleto,
          criadoEm: comentarioRevisao.criadoEm,
        })
        .from(comentarioRevisao)
        .leftJoin(usuario, eq(usuario.id, comentarioRevisao.autorId))
        .where(inArray(comentarioRevisao.versaoId, versoes.map((v) => v.id).concat(['00000000-0000-0000-0000-000000000000'])))
        .orderBy(asc(comentarioRevisao.criadoEm));

      const [ciencia] = doc.versaoVigenteId
        ? await tx
            .select({ confirmadaEm: cienciaDocumento.confirmadaEm })
            .from(cienciaDocumento)
            .where(and(eq(cienciaDocumento.versaoId, doc.versaoVigenteId), eq(cienciaDocumento.usuarioId, ctx.usuarioId)))
            .limit(1)
        : [];

      const [responsavel] = doc.responsavelId
        ? await tx.select({ nome: usuario.nomeCompleto }).from(usuario).where(eq(usuario.id, doc.responsavelId)).limit(1)
        : [];

      const feedbacks = this.administra() || doc.responsavelId === ctx.usuarioId
        ? await tx
            .select({
              id: feedbackDocumento.id,
              tipo: feedbackDocumento.tipo,
              texto: feedbackDocumento.texto,
              autor: usuario.nomeCompleto,
              criadoEm: feedbackDocumento.criadoEm,
              tratadoEm: feedbackDocumento.tratadoEm,
            })
            .from(feedbackDocumento)
            .leftJoin(usuario, eq(usuario.id, feedbackDocumento.usuarioId))
            .where(eq(feedbackDocumento.documentoId, documentoId))
            .orderBy(desc(feedbackDocumento.criadoEm))
        : [];

      return {
        ...doc,
        responsavel: responsavel?.nome ?? null,
        minhaCiencia: ciencia?.confirmadaEm ?? null,
        versoes,
        comentarios,
        feedbacks,
        podeEditar: this.podeEditar(doc),
        administra: this.administra(),
      };
    });
  }

  /** Secao 102: o painel. */
  async painel() {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const hoje = new Date().toISOString().slice(0, 10);
      const em30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const [d] = await tx
        .select({
          vigentes: sql<number>`count(*) filter (where ${documentoBiblioteca.status} = 'publicado')::int`,
          rascunhos: sql<number>`count(*) filter (where ${documentoBiblioteca.status} = 'rascunho')::int`,
          obsoletos: sql<number>`count(*) filter (where ${documentoBiblioteca.status} in ('obsoleto','arquivado'))::int`,
          proximosDaRevisao: sql<number>`count(*) filter (where ${documentoBiblioteca.status} = 'publicado' and ${documentoBiblioteca.proximaRevisaoEm} between ${hoje} and ${em30})::int`,
          vencidos: sql<number>`count(*) filter (where ${documentoBiblioteca.status} = 'publicado' and ${documentoBiblioteca.proximaRevisaoEm} < ${hoje})::int`,
          criticos: sql<number>`count(*) filter (where ${documentoBiblioteca.critico} and ${documentoBiblioteca.status} = 'publicado')::int`,
        })
        .from(documentoBiblioteca)
        .where(eq(documentoBiblioteca.tenantId, ctx.tenantId));

      const [v] = await tx
        .select({
          emRevisao: sql<number>`count(*) filter (where ${versaoDocumento.status} = 'em_revisao')::int`,
          aguardandoAprovacao: sql<number>`count(*) filter (where ${versaoDocumento.status} = 'aguardando_aprovacao')::int`,
          aprovadasNaoPublicadas: sql<number>`count(*) filter (where ${versaoDocumento.status} = 'aprovada')::int`,
        })
        .from(versaoDocumento)
        .where(eq(versaoDocumento.tenantId, ctx.tenantId));

      const minhasPendencias = await tx
        .select({ id: documentoBiblioteca.id, codigo: documentoBiblioteca.codigo, titulo: documentoBiblioteca.titulo })
        .from(documentoBiblioteca)
        .where(
          and(
            eq(documentoBiblioteca.tenantId, ctx.tenantId),
            eq(documentoBiblioteca.status, 'publicado'),
            eq(documentoBiblioteca.exigeCiencia, true),
            this.filtroDePublico(),
            sql`not exists (select 1 from ${cienciaDocumento} c where c.versao_id = ${documentoBiblioteca.versaoVigenteId} and c.usuario_id = ${ctx.usuarioId})`,
          ),
        )
        .orderBy(asc(documentoBiblioteca.titulo));

      const maisAcessados = await tx
        .select({ id: documentoBiblioteca.id, codigo: documentoBiblioteca.codigo, titulo: documentoBiblioteca.titulo, acessos: documentoBiblioteca.acessos })
        .from(documentoBiblioteca)
        .where(and(eq(documentoBiblioteca.tenantId, ctx.tenantId), eq(documentoBiblioteca.status, 'publicado'), this.filtroDePublico()))
        .orderBy(desc(documentoBiblioteca.acessos))
        .limit(5);

      const feedbacksAbertos = this.administra()
        ? (
            await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(feedbackDocumento)
              .where(and(eq(feedbackDocumento.tenantId, ctx.tenantId), isNull(feedbackDocumento.tratadoEm)))
          )[0]?.n ?? 0
        : 0;

      return { ...d!, ...v!, leiturasPendentes: minhasPendencias, maisAcessados, feedbacksAbertos };
    });
  }

  /** Fila de revisao e aprovacao (secoes 24-28). */
  async filaDeRevisao() {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          versaoId: versaoDocumento.id,
          numero: versaoDocumento.numero,
          status: versaoDocumento.status,
          documentoId: documentoBiblioteca.id,
          codigo: documentoBiblioteca.codigo,
          titulo: documentoBiblioteca.titulo,
          categoria: documentoBiblioteca.categoria,
          exigeAprovacao: documentoBiblioteca.exigeAprovacao,
          autor: usuario.nomeCompleto,
          enviadaRevisaoEm: versaoDocumento.enviadaRevisaoEm,
          motivoRevisao: versaoDocumento.motivoRevisao,
        })
        .from(versaoDocumento)
        .innerJoin(documentoBiblioteca, eq(documentoBiblioteca.id, versaoDocumento.documentoId))
        .leftJoin(usuario, eq(usuario.id, versaoDocumento.autorId))
        .where(
          and(
            eq(versaoDocumento.tenantId, ctx.tenantId),
            inArray(versaoDocumento.status, ['em_revisao', 'aguardando_aprovacao', 'aprovada']),
          ),
        )
        .orderBy(asc(versaoDocumento.enviadaRevisaoEm)),
    );
  }

  // --- internos ---------------------------------------------------------------

  private async gerarCodigo(tx: Transacao, tipo: TipoDocumento, categoria: CategoriaDocumento): Promise<string> {
    const prefixo = `${SIGLA_TIPO_DOCUMENTO[tipo]}-${SIGLA_CATEGORIA_DOCUMENTO[categoria]}`;
    const n = await this.numeracao.proximoDocumentoBiblioteca(tx, prefixo);
    return codigoDocumento(tipo, categoria, n);
  }

  private administra(): boolean {
    return exigirContexto().permissoes.has(PERMISSOES.BIBLIOTECA_APROVAR);
  }

  private exigirAdministrador(): void {
    if (!this.administra()) throw new ForbiddenException('Ação reservada a quem administra a Biblioteca.');
  }

  private podeEditar(doc: { responsavelId: string | null; criadoPorId: string | null }): boolean {
    const ctx = exigirContexto();
    if (this.administra()) return true;
    if (!ctx.permissoes.has(PERMISSOES.BIBLIOTECA_EDITAR)) return false;
    return doc.responsavelId === ctx.usuarioId || doc.criadoPorId === ctx.usuarioId;
  }

  /** Quem edita e o responsavel ou quem criou; quem administra edita tudo. */
  private exigirEditor(doc: { responsavelId: string | null; criadoPorId: string | null }): void {
    if (!this.podeEditar(doc)) {
      throw new ForbiddenException('Só o responsável pelo documento (ou quem administra a Biblioteca) o edita.');
    }
  }

  /** Secoes 88-89: o publico decide quem le. */
  private exigirLeitor(doc: { publico: PublicoDocumento; responsavelId: string | null; criadoPorId: string | null }): void {
    const ctx = exigirContexto();
    if (this.administra()) return;
    if (doc.responsavelId === ctx.usuarioId || doc.criadoPorId === ctx.usuarioId) return;
    if (doc.publico === 'restrito' || doc.publico === 'gestores') {
      throw new ForbiddenException('Este documento tem acesso restrito (M21 §89).');
    }
  }

  private filtroDePublico() {
    const ctx = exigirContexto();
    if (this.administra()) return undefined;
    return or(
      inArray(documentoBiblioteca.publico, ['colaboradores', 'clientes']),
      eq(documentoBiblioteca.responsavelId, ctx.usuarioId),
      eq(documentoBiblioteca.criadoPorId, ctx.usuarioId),
    );
  }

  private async buscarDocumento(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [doc] = await tx
      .select()
      .from(documentoBiblioteca)
      .where(and(eq(documentoBiblioteca.tenantId, ctx.tenantId), eq(documentoBiblioteca.id, id)))
      .limit(1);
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    return doc;
  }

  private async buscarVersao(tx: Transacao, versaoId: string) {
    const ctx = exigirContexto();
    const [versao] = await tx
      .select()
      .from(versaoDocumento)
      .where(and(eq(versaoDocumento.tenantId, ctx.tenantId), eq(versaoDocumento.id, versaoId)))
      .limit(1);
    if (!versao) throw new NotFoundException('Versão não encontrada.');
    const doc = await this.buscarDocumento(tx, versao.documentoId);
    return { versao, doc };
  }
}
