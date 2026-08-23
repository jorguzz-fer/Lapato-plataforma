import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  caso,
  imagem,
  imagemVersao,
  usuario,
  type Transacao,
} from '@lapato/db';
import { MODULOS, type OrigemImagem, type TipoImagem } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { StorageFactory } from '../../core/storage/storage.provider.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/** O que o multer entrega, sem depender do tipo global do Express. */
export interface ArquivoRecebido {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface DadosNovaImagem {
  tipo: TipoImagem;
  origem?: OrigemImagem;
  moduloContexto: string;
  objetoTipo?: string;
  objetoId?: string;
  legenda?: string;
  descricao?: string;
  capturadaEm?: string;
  metadados?: Record<string, unknown>;
}

/** Formatos aceitos. PDF e documento, e o M16 secao 85 o manda para outro lugar. */
const MIMES_ACEITOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** 25 MB: fotografia de macroscopia em alta resolucao cabe; video nao. */
export const TAMANHO_MAXIMO = 25 * 1024 * 1024;

/**
 * M16 - Imagens e Gestao do Acervo Digital.
 *
 * O modulo e o **proprietario do arquivo**; os demais modulos sao donos do
 * CONTEXTO em que a imagem foi produzida (secao 4). Dai nao existir galeria da
 * macroscopia, outra da necropsia e outra da citologia: e um acervo so, e o que
 * muda sao os metadados e o vinculo (secao 6).
 *
 * Regras que estruturam o servico:
 *
 * - **Toda imagem tem origem, contexto e vinculo** (secao 1 e 134). Uma foto
 *   nao existe como "IMG_8472.jpg": ela e o caso, a etapa, a amostra, quem
 *   produziu e quando.
 * - **O original nunca e sobrescrito** (secoes 22-24). Recorte, rotacao e
 *   anotacao criam versao derivada; aqui gravamos o original e, quando existe,
 *   a miniatura de navegacao.
 * - **Exclusao e restrita** (secao 69): imagem errada e INATIVADA com motivo,
 *   preservando o historico.
 * - **Selecionar para o laudo nao modifica o arquivo** (secao 134) - e uma
 *   marcacao com ordem, e a numeracao do documento sai dessa ordem (secao 38).
 */
@Injectable()
export class ImagensService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
    private readonly eventos: EventosService,
    private readonly storage: StorageFactory,
    private readonly numeracao: NumeracaoService,
  ) {}

  /**
   * Recebe o arquivo e o registra no acervo.
   *
   * A miniatura vem pronta de quem envia (o navegador a produz na captura) em
   * vez de ser gerada aqui: redimensionar no servidor exigiria uma dependencia
   * nativa de imagem na imagem Docker da API, e o ganho seria nenhum - o
   * original ja esta na mao de quem envia, no momento em que ele o escolhe. Sem
   * miniatura, a galeria simplesmente cai no original (secao 73).
   */
  async enviar(
    casoId: string,
    arquivo: ArquivoRecebido,
    dados: DadosNovaImagem,
    miniatura?: ArquivoRecebido,
  ): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    if (!MIMES_ACEITOS.has(arquivo.mimetype)) {
      throw new BadRequestException(
        `Formato não aceito (${arquivo.mimetype}). Envie JPEG, PNG, WebP ou HEIC.`,
      );
    }
    if (arquivo.buffer.length > TAMANHO_MAXIMO) {
      throw new BadRequestException('Arquivo acima de 25 MB.');
    }

    const provedor = this.storage.criar();

    return this.db.executar(async (tx) => {
      const [registro] = await tx
        .select({ id: caso.id })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1);
      if (!registro) throw new NotFoundException('Caso não encontrado.');

      const identificador = await this.numeracao.proximaImagem(tx, new Date().getFullYear());

      const [nova] = await tx
        .insert(imagem)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          casoId,
          tipo: dados.tipo,
          // Produzida no laboratorio e o padrao; imagem de terceiro chega por
          // outra porta e precisa dizer de onde veio (secao 83).
          origem: dados.origem ?? 'produzida_lapato',
          moduloContexto: dados.moduloContexto,
          objetoTipo: dados.objetoTipo ?? null,
          objetoId: dados.objetoId ?? null,
          legenda: dados.legenda?.trim() || null,
          descricao: dados.descricao?.trim() || null,
          // Secao 13: capturada != enviada. Quando quem envia sabe a data da
          // captura, ela e guardada separada - importa em caso pericial.
          capturadaEm: dados.capturadaEm ? new Date(dados.capturadaEm) : null,
          autorId: ctx.usuarioId,
          metadados: dados.metadados ?? {},
        })
        .returning({ id: imagem.id });

      const extensao = EXTENSAO[arquivo.mimetype] ?? 'bin';
      const chave = `imagens/${ctx.tenantId}/${nova!.id}/original.${extensao}`;
      const { hash } = await provedor.salvar(chave, arquivo.buffer, arquivo.mimetype);

      await tx.insert(imagemVersao).values({
        tenantId: ctx.tenantId,
        imagemId: nova!.id,
        nivel: 'original',
        chaveStorage: chave,
        // Secao 76: identificador criptografico do original, para detectar
        // corrupcao ou troca do arquivo.
        hash,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.buffer.length,
        criadaPorId: ctx.usuarioId,
      });

      if (miniatura && MIMES_ACEITOS.has(miniatura.mimetype)) {
        const chaveMini = `imagens/${ctx.tenantId}/${nova!.id}/miniatura.${EXTENSAO[miniatura.mimetype] ?? 'jpg'}`;
        await provedor.salvar(chaveMini, miniatura.buffer, miniatura.mimetype);
        await tx
          .update(imagem)
          .set({ miniaturaChave: chaveMini })
          .where(eq(imagem.id, nova!.id));
      }

      /**
       * A imagem entra na linha do tempo do caso (DIRETRIZES secao 13), mas nao
       * move o fluxo: fotografar nao e etapa. O M07 ignora o evento por nao
       * haver etapa que o declare como entrada.
       */
      await this.eventos.publicar(tx, {
        tipo: 'imagem.anexada',
        casoId,
        moduloOrigem: MODULOS.M16_IMAGENS,
        objetoTipo: 'imagem',
        objetoId: nova!.id,
        payload: { identificador, tipo: dados.tipo, modulo: dados.moduloContexto },
      });

      await this.auditoria.registrar(tx, {
        entidade: 'imagem',
        entidadeId: nova!.id,
        acao: 'enviar',
        casoId,
        valorNovo: { identificador, tipo: dados.tipo, origem: dados.origem ?? 'produzida_lapato' },
      });

      return { id: nova!.id, identificador };
    });
  }

  /**
   * Galeria do caso (secao 57).
   *
   * Inativadas ficam de fora por padrao - elas existem para preservar
   * historico, nao para atrapalhar a leitura (secao 69).
   */
  async listarPorCaso(casoId: string, incluirInativadas = false) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const autor = usuario;

      return tx
        .select({
          id: imagem.id,
          identificador: imagem.identificador,
          tipo: imagem.tipo,
          origem: imagem.origem,
          moduloContexto: imagem.moduloContexto,
          objetoTipo: imagem.objetoTipo,
          objetoId: imagem.objetoId,
          legenda: imagem.legenda,
          descricao: imagem.descricao,
          metadados: imagem.metadados,
          capturadaEm: imagem.capturadaEm,
          enviadaEm: imagem.enviadaEm,
          autor: autor.nomeCompleto,
          incluidaNoLaudo: imagem.incluidaNoLaudo,
          ordemNoLaudo: imagem.ordemNoLaudo,
          autorizadaEnsino: imagem.autorizadaEnsino,
          inativadaEm: imagem.inativadaEm,
          motivoInativacao: imagem.motivoInativacao,
          temMiniatura: sql<boolean>`${imagem.miniaturaChave} is not null`,
        })
        .from(imagem)
        .leftJoin(autor, eq(autor.id, imagem.autorId))
        .where(
          and(
            eq(imagem.tenantId, ctx.tenantId),
            eq(imagem.casoId, casoId),
            incluirInativadas ? undefined : isNull(imagem.inativadaEm),
          ),
        )
        .orderBy(asc(imagem.enviadaEm));
    });
  }

  /** Bytes do arquivo, ja com a autorizacao resolvida pelo guard da rota. */
  async baixar(
    imagemId: string,
    qual: 'original' | 'miniatura',
  ): Promise<{ bytes: Buffer; mimeType: string; nomeArquivo: string }> {
    const ctx = exigirContexto();
    const provedor = this.storage.criar();

    return this.db.executar(async (tx) => {
      const [linha] = await tx
        .select({
          identificador: imagem.identificador,
          miniaturaChave: imagem.miniaturaChave,
          chave: imagemVersao.chaveStorage,
          mimeType: imagemVersao.mimeType,
        })
        .from(imagem)
        .innerJoin(
          imagemVersao,
          and(
            eq(imagemVersao.imagemId, imagem.id),
            eq(imagemVersao.nivel, 'original'),
          ),
        )
        .where(and(eq(imagem.tenantId, ctx.tenantId), eq(imagem.id, imagemId)))
        .limit(1);

      if (!linha) throw new NotFoundException('Imagem não encontrada.');

      // Sem miniatura, serve o original: a galeria continua funcionando, so
      // carrega mais bytes.
      const chave =
        qual === 'miniatura' && linha.miniaturaChave ? linha.miniaturaChave : linha.chave;

      return {
        bytes: await provedor.baixar(chave),
        mimeType: linha.mimeType,
        nomeArquivo: `${linha.identificador}.${EXTENSAO[linha.mimeType] ?? 'jpg'}`,
      };
    });
  }

  /** Legenda, descricao, metadados e autorizacoes de uso secundario. */
  async editar(
    imagemId: string,
    dados: {
      legenda?: string;
      descricao?: string;
      metadados?: Record<string, unknown>;
      autorizadaEnsino?: boolean;
      autorizadaPesquisa?: boolean;
      autorizadaTreinamentoIa?: boolean;
    },
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, imagemId);

      await tx
        .update(imagem)
        .set({
          ...(dados.legenda !== undefined ? { legenda: dados.legenda.trim() || null } : {}),
          ...(dados.descricao !== undefined
            ? { descricao: dados.descricao.trim() || null }
            : {}),
          ...(dados.metadados !== undefined
            ? { metadados: { ...atual.metadados, ...dados.metadados } }
            : {}),
          /**
           * Secoes 44-47: armazenar imagem clinica NAO implica autorizacao de
           * ensino, pesquisa ou treinamento de modelo. Cada uma e um ato
           * explicito, e por isso fica na auditoria.
           */
          ...(dados.autorizadaEnsino !== undefined
            ? { autorizadaEnsino: dados.autorizadaEnsino }
            : {}),
          ...(dados.autorizadaPesquisa !== undefined
            ? { autorizadaPesquisa: dados.autorizadaPesquisa }
            : {}),
          ...(dados.autorizadaTreinamentoIa !== undefined
            ? { autorizadaTreinamentoIa: dados.autorizadaTreinamentoIa }
            : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(imagem.id, imagemId));

      await this.auditoria.registrar(tx, {
        entidade: 'imagem',
        entidadeId: imagemId,
        acao: 'editar',
        casoId: atual.casoId ?? undefined,
        valorAnterior: { legenda: atual.legenda },
        valorNovo: dados,
      });
    });
  }

  /**
   * Secao 69: imagem errada e inativada, nao apagada.
   *
   * O motivo e obrigatorio porque "capturada por engano" (secao 70) e
   * "vinculada ao caso errado" (secao 106) pedem tratamentos diferentes depois,
   * e sem o motivo nao ha como distinguir.
   */
  async inativar(imagemId: string, motivo: string): Promise<void> {
    if (!motivo?.trim()) {
      throw new BadRequestException('Inativar uma imagem exige o motivo.');
    }

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, imagemId);
      if (atual.inativadaEm) throw new BadRequestException('Esta imagem já está inativada.');

      await tx
        .update(imagem)
        .set({
          inativadaEm: new Date(),
          motivoInativacao: motivo.trim(),
          // Sai do laudo junto: documento nao carrega imagem retirada do acervo.
          incluidaNoLaudo: false,
          ordemNoLaudo: null,
          atualizadoEm: new Date(),
        })
        .where(eq(imagem.id, imagemId));

      await this.auditoria.registrar(tx, {
        entidade: 'imagem',
        entidadeId: imagemId,
        acao: 'inativar',
        casoId: atual.casoId ?? undefined,
        justificativa: motivo.trim(),
      });
    });
  }

  /**
   * Selecao para o laudo (secoes 36-39).
   *
   * A ordem e a posicao na lista de selecionadas; a numeracao do documento
   * ("Imagem 01") deriva dela e muda sozinha quando a ordem muda. Selecionar
   * nao toca no arquivo.
   */
  async selecionarParaLaudo(imagemId: string, incluir: boolean): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, imagemId);
      if (atual.inativadaEm) {
        throw new BadRequestException('Imagem inativada não entra no laudo.');
      }

      if (!incluir) {
        await tx
          .update(imagem)
          .set({ incluidaNoLaudo: false, ordemNoLaudo: null, atualizadoEm: new Date() })
          .where(eq(imagem.id, imagemId));
        return;
      }

      const [ultima] = await tx
        .select({ ordem: imagem.ordemNoLaudo })
        .from(imagem)
        .where(
          and(
            eq(imagem.tenantId, ctx.tenantId),
            eq(imagem.casoId, atual.casoId!),
            eq(imagem.incluidaNoLaudo, true),
          ),
        )
        .orderBy(desc(imagem.ordemNoLaudo))
        .limit(1);

      await tx
        .update(imagem)
        .set({
          incluidaNoLaudo: true,
          ordemNoLaudo: (ultima?.ordem ?? 0) + 1,
          atualizadoEm: new Date(),
        })
        .where(eq(imagem.id, imagemId));

      await this.auditoria.registrar(tx, {
        entidade: 'imagem',
        entidadeId: imagemId,
        acao: 'selecionar_laudo',
        casoId: atual.casoId ?? undefined,
      });
    });
  }

  /** Reordena as selecionadas; a numeracao do documento acompanha (secao 39). */
  async reordenarNoLaudo(casoId: string, ordem: string[]): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      if (ordem.length === 0) return;

      const existentes = await tx
        .select({ id: imagem.id })
        .from(imagem)
        .where(
          and(
            eq(imagem.tenantId, ctx.tenantId),
            eq(imagem.casoId, casoId),
            inArray(imagem.id, ordem),
          ),
        );

      if (existentes.length !== ordem.length) {
        throw new BadRequestException('A lista contém imagem que não é deste caso.');
      }

      for (const [i, id] of ordem.entries()) {
        await tx
          .update(imagem)
          .set({ ordemNoLaudo: i + 1, incluidaNoLaudo: true, atualizadoEm: new Date() })
          .where(eq(imagem.id, id));
      }
    });
  }

  // --- internos --------------------------------------------------------------

  private async buscar(tx: Transacao, imagemId: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(imagem)
      .where(and(eq(imagem.tenantId, ctx.tenantId), eq(imagem.id, imagemId)))
      .limit(1);
    if (!linha) throw new NotFoundException('Imagem não encontrada.');
    return linha;
  }
}
