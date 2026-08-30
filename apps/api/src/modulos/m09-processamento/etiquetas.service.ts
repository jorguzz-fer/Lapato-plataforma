import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { and, asc, eq } from 'drizzle-orm';
import { cassete, loteCassete, loteEnvio, modeloEtiqueta, amostra, caso } from '@lapato/db';
import { DbService } from '../../core/db/db.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';
import { code128Larguras } from './codigo-barras.js';

/**
 * M09 - etiquetas de lamina para o laboratorio de apoio.
 *
 * O fluxo combinado na review: o parceiro entra com o proprio acesso, ve o
 * lote do dia e IMPRIME as nossas etiquetas na impressora dele - "ele imprime
 * as nossas etiquetas, mas na impressora dele, com o nosso perfil de
 * etiqueta". O perfil (dimensoes, campos, codigo de barras) vem do
 * `modelo_etiqueta` do M01; quando o Hugo mandar as dimensoes reais da
 * etiqueta deles, e ajustar o modelo, nao o codigo.
 *
 * Uma PAGINA por etiqueta, no tamanho exato do modelo: e assim que impressora
 * termica de etiquetas espera receber o trabalho. Uma etiqueta por cassete do
 * lote - a lamina herda o identificador do cassete que a originou (M08), entao
 * bipar a lamina resolve o cassete, o caso e o resto da cadeia.
 */
@Injectable()
export class EtiquetasService {
  constructor(private readonly db: DbService) {}

  async etiquetasDoLote(loteId: string): Promise<{ bytes: Buffer; nomeArquivo: string }> {
    const dados = await this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [lote] = await tx
        .select({ id: loteEnvio.id, identificador: loteEnvio.identificador })
        .from(loteEnvio)
        .where(and(eq(loteEnvio.tenantId, ctx.tenantId), eq(loteEnvio.id, loteId)))
        .limit(1);
      if (!lote) throw new NotFoundException('Lote não encontrado.');

      const cassetes = await tx
        .select({
          identificador: cassete.identificador,
          casoIdentificador: caso.identificador,
        })
        .from(loteCassete)
        .innerJoin(cassete, eq(cassete.id, loteCassete.casseteId))
        .innerJoin(amostra, eq(amostra.id, cassete.amostraId))
        .innerJoin(caso, eq(caso.id, amostra.casoId))
        .where(and(eq(loteCassete.tenantId, ctx.tenantId), eq(loteCassete.loteId, loteId)))
        .orderBy(asc(cassete.identificador));

      const [modelo] = await tx
        .select({
          larguraMm: modeloEtiqueta.larguraMm,
          alturaMm: modeloEtiqueta.alturaMm,
        })
        .from(modeloEtiqueta)
        .where(and(eq(modeloEtiqueta.tenantId, ctx.tenantId), eq(modeloEtiqueta.alvo, 'lamina')))
        .limit(1);

      return { lote, cassetes, modelo };
    });

    if (dados.cassetes.length === 0) {
      throw new NotFoundException('O lote não tem cassetes para etiquetar.');
    }

    // O modelo do M01 manda; sem modelo cadastrado, o padrao de lamina 22x15.
    const larguraMm = dados.modelo?.larguraMm ?? 22;
    const alturaMm = dados.modelo?.alturaMm ?? 15;

    const bytes = await this.renderizar(larguraMm, alturaMm, dados.cassetes);
    return { bytes, nomeArquivo: `etiquetas-${dados.lote.identificador}.pdf` };
  }

  private renderizar(
    larguraMm: number,
    alturaMm: number,
    etiquetas: Array<{ identificador: string; casoIdentificador: string }>,
  ): Promise<Buffer> {
    const MM = 72 / 25.4;
    const largura = larguraMm * MM;
    const altura = alturaMm * MM;
    const margem = 1.2 * MM;

    const doc = new PDFDocument({ size: [largura, altura], margin: 0, autoFirstPage: false });
    const pedacos: Buffer[] = [];
    doc.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    const pronto = new Promise<Buffer>((resolver) => {
      doc.on('end', () => resolver(Buffer.concat(pedacos)));
    });

    for (const etiqueta of etiquetas) {
      doc.addPage({ size: [largura, altura], margin: 0 });

      // Identificador legivel por gente, em cima.
      doc
        .font('Helvetica-Bold')
        .fontSize(Math.min(6.5, (largura - 2 * margem) / (etiqueta.identificador.length * 0.62)))
        .text(etiqueta.identificador, margem, margem, {
          width: largura - 2 * margem,
          align: 'center',
        });

      /**
       * Codigo de barras legivel por maquina, embaixo. As larguras vem em
       * modulos; o modulo e calculado para o codigo caber na etiqueta - se a
       * densidade ficar impraticavel para o leitor, o caminho e aumentar a
       * etiqueta no modelo do M01, nao truncar o identificador.
       */
      const larguras = code128Larguras(etiqueta.identificador);
      const totalModulos = larguras.reduce((acc, l) => acc + l, 0);
      const modulo = (largura - 2 * margem) / totalModulos;
      const alturaBarras = altura - margem * 2 - 9;

      let x = margem;
      let barra = true;
      for (const l of larguras) {
        if (barra) doc.rect(x, margem + 8, l * modulo, alturaBarras).fill('#000000');
        x += l * modulo;
        barra = !barra;
      }
    }

    doc.end();
    return pronto;
  }
}
