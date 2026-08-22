import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';

/**
 * Gera o PDF do laudo (M11 secoes 65-72, 87-88).
 *
 * ADR 0005: o PDF e REPRESENTACAO, nunca a fonte. Este servico so formata o
 * que ja esta gravado - nao decide nada, nao valida nada, nao numera nada. Por
 * isso ele recebe um objeto ja pronto, e nao ids: quem monta os dados e
 * `LaudosService`, que sabe o que a RLS autoriza ler.
 *
 * Duas chamadas, dois contextos:
 * - rascunho (pre-visualizacao, M11 secao 71): mesma funcao, com `assinatura:
 *   null` e `codigoValidacao: null` - o PDF sai com a marca RASCUNHO e sem QR,
 *   porque nao ha nada a validar ainda.
 * - assinado: o resultado destes bytes e hasheado e congelado. A MESMA versao
 *   nunca gera dois PDFs diferentes depois de assinada (ADR 0005) - por isso a
 *   nota de "documento substituido" (M11 secao 89) NAO entra aqui: ela e
 *   verdade sobre o AGORA, nao sobre o que foi assinado, e fica na tela.
 */

export interface DadosLaudoPdf {
  instituicao: { nome: string };
  caso: { identificador: string };
  paciente: { nome: string; especie: string | null; sexo: string | null; idade: string | null };
  cliente: { nome: string };
  veterinario: { nome: string; crmv: string | null } | null;
  servico: { nome: string };
  versao: {
    numero: number;
    tipo: 'original' | 'adendo' | 'correcao';
    motivo: string | null;
    descricaoMicroscopica: string | null;
    comentarios: string | null;
    conclusao: string | null;
  };
  diagnosticos: Array<{ amostraIdentificador: string | null; textoExibido: string }>;
  margens: Array<{ nome: string; resultado: string; distanciaMm: string | null }>;
  /** `null` fora do fluxo de assinatura: e o que marca RASCUNHO. */
  assinatura: { identificacao: string; assinadaEm: Date } | null;
  /** URL completa que o QR aponta; `null` quando ainda nao ha o que validar. */
  urlValidacao: string | null;
}

const MARGEM_LABEL: Record<string, string> = {
  livre: 'Livre',
  comprometida: 'Comprometida',
  proxima: 'Próxima',
  nao_avaliavel: 'Não avaliável',
  indeterminada: 'Indeterminada',
};

@Injectable()
export class LaudoPdfService {
  async gerar(dados: DadosLaudoPdf): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: {
        Title: `Laudo ${dados.caso.identificador} - v${dados.versao.numero}`,
        Author: dados.instituicao.nome,
      },
    });

    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    const finalizado = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(partes)));
    });

    this.cabecalho(doc, dados);
    this.dadosDoCaso(doc, dados);
    this.secaoTexto(doc, 'Descrição microscópica', dados.versao.descricaoMicroscopica);
    this.diagnosticos(doc, dados.diagnosticos);
    this.margens(doc, dados.margens);
    this.secaoTexto(doc, 'Comentários', dados.versao.comentarios);
    this.secaoTexto(doc, 'Conclusão', dados.versao.conclusao);
    await this.rodape(doc, dados);

    doc.end();
    return finalizado;
  }

  private cabecalho(doc: PDFKit.PDFDocument, dados: DadosLaudoPdf): void {
    doc.fontSize(9).fillColor('#666').text(dados.instituicao.nome.toUpperCase());
    doc.moveDown(0.3);
    doc.fontSize(16).fillColor('#000').font('Helvetica-Bold').text('Laudo Anatomopatológico');
    doc.font('Helvetica');

    const rotulo =
      dados.versao.tipo === 'adendo'
        ? `Adendo · versão ${dados.versao.numero}`
        : dados.versao.tipo === 'correcao'
          ? `Correção · versão ${dados.versao.numero}`
          : `Versão ${dados.versao.numero}`;
    doc.fontSize(10).fillColor('#444').text(rotulo);

    if (!dados.assinatura) {
      // M11 secao 72: enquanto nao assinado, o documento se declara RASCUNHO -
      // a pre-visualizacao nao pode ser confundida com o laudo final.
      doc
        .fontSize(9)
        .fillColor('#a1382a')
        .font('Helvetica-Bold')
        .text('RASCUNHO — NÃO ASSINADO, SUJEITO A ALTERAÇÃO', { align: 'right' })
        .font('Helvetica')
        .fillColor('#000');
    }

    doc.moveDown(0.8);
    this.linha(doc);
    doc.moveDown(0.6);
  }

  private dadosDoCaso(doc: PDFKit.PDFDocument, dados: DadosLaudoPdf): void {
    const campo = (rotulo: string, valor: string) => {
      doc.fontSize(8).fillColor('#666').text(rotulo.toUpperCase(), { continued: false });
      doc.fontSize(10.5).fillColor('#000').text(valor);
      doc.moveDown(0.4);
    };

    campo('Registro', dados.caso.identificador);
    campo(
      'Paciente',
      [dados.paciente.nome, dados.paciente.especie, dados.paciente.sexo, dados.paciente.idade]
        .filter(Boolean)
        .join(' · '),
    );
    campo('Cliente', dados.cliente.nome);
    if (dados.veterinario) {
      campo(
        'Veterinário solicitante',
        dados.veterinario.crmv
          ? `${dados.veterinario.nome} — CRMV ${dados.veterinario.crmv}`
          : dados.veterinario.nome,
      );
    }
    campo('Serviço', dados.servico.nome);
    if (dados.versao.motivo) {
      // Adendo e correcao exigem motivo (M11); ele precisa aparecer no
      // documento entregue, nao so no historico interno de versoes.
      campo('Motivo desta versão', dados.versao.motivo);
    }

    doc.moveDown(0.4);
    this.linha(doc);
    doc.moveDown(0.6);
  }

  private secaoTexto(doc: PDFKit.PDFDocument, titulo: string, texto: string | null): void {
    if (!texto?.trim()) return;
    doc.fontSize(11).font('Helvetica-Bold').text(titulo);
    doc.font('Helvetica').fontSize(10.5).moveDown(0.2).text(texto, { align: 'justify' });
    doc.moveDown(0.7);
  }

  private diagnosticos(doc: PDFKit.PDFDocument, itens: DadosLaudoPdf['diagnosticos']): void {
    if (itens.length === 0) return;
    doc.fontSize(11).font('Helvetica-Bold').text('Diagnóstico');
    doc.font('Helvetica').fontSize(10.5).moveDown(0.2);
    for (const d of itens) {
      const prefixo = d.amostraIdentificador ? `${d.amostraIdentificador} — ` : '';
      doc.text(`${prefixo}${d.textoExibido}`, { align: 'justify' });
      doc.moveDown(0.15);
    }
    doc.moveDown(0.5);
  }

  private margens(doc: PDFKit.PDFDocument, itens: DadosLaudoPdf['margens']): void {
    if (itens.length === 0) return;
    doc.fontSize(11).font('Helvetica-Bold').text('Margens');
    doc.font('Helvetica').fontSize(10.5).moveDown(0.2);
    for (const m of itens) {
      const distancia = m.distanciaMm ? ` — ${m.distanciaMm} mm` : '';
      doc.text(`${m.nome}: ${MARGEM_LABEL[m.resultado] ?? m.resultado}${distancia}`);
      doc.moveDown(0.1);
    }
    doc.moveDown(0.5);
  }

  private async rodape(doc: PDFKit.PDFDocument, dados: DadosLaudoPdf): Promise<void> {
    doc.moveDown(0.6);
    this.linha(doc);
    doc.moveDown(0.5);

    if (!dados.assinatura) {
      doc
        .fontSize(9)
        .fillColor('#666')
        .text('Documento sem valor legal enquanto não assinado.');
      return;
    }

    // M11 secao 82: assinatura registra identificacao profissional e o
    // momento - os dois congelados no banco no instante da assinatura.
    doc
      .fontSize(9.5)
      .fillColor('#000')
      .text(
        `Assinado eletronicamente por ${dados.assinatura.identificacao} em ` +
          `${dados.assinatura.assinadaEm.toLocaleString('pt-BR')}.`,
      );

    if (dados.urlValidacao) {
      const y = doc.y + 8;
      const qr = await QRCode.toBuffer(dados.urlValidacao, { margin: 0, width: 200 });
      doc.image(qr, doc.page.margins.left, y, { width: 64 });
      doc
        .fontSize(8)
        .fillColor('#666')
        .text('Verifique a autenticidade deste documento em:', doc.page.margins.left + 74, y + 4, {
          width: 300,
        })
        .fontSize(8.5)
        .fillColor('#000')
        .text(dados.urlValidacao, doc.page.margins.left + 74, doc.y, { width: 300 });
    }
  }

  private linha(doc: PDFKit.PDFDocument): void {
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#ddd')
      .stroke();
  }
}
