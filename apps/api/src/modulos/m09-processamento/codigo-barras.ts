/**
 * Codificador Code 128 (subconjunto B), sem dependencia externa.
 *
 * Existe porque a etiqueta de lamina precisa de codigo de barras "visando
 * facilitar a checagem pelo sistema" (M09), e as bibliotecas de barcode
 * arrastam renderizadores inteiros de canvas/SVG - aqui so precisamos das
 * LARGURAS das barras, que o pdfkit desenha como retangulos.
 *
 * Code 128 B cobre ASCII 32-127, o que inclui todos os identificadores do
 * LAPATO (`CV-000342/26-A01-C2`). Cada simbolo vira 6 larguras alternando
 * barra/espaco; o codigo completo e START-B + dados + checksum + STOP + barra
 * final de 2 modulos.
 */

/** Padroes oficiais: 107 simbolos, 6 larguras cada (barra, espaco, ...). */
const PADROES = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
  '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
  '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
  '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
  '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 233111'
).split(' ');

const START_B = 104;
const STOP = 106;

/**
 * Devolve a sequencia de larguras em modulos, comecando por uma BARRA.
 * Larguras alternam barra/espaco; a barra final de encerramento ja vem
 * incluida (o padrao do STOP tem 7 larguras com ela).
 */
export function code128Larguras(texto: string): number[] {
  const valores = [START_B];
  for (const caractere of texto) {
    const codigo = caractere.charCodeAt(0);
    if (codigo < 32 || codigo > 126) {
      throw new Error(`Caractere fora do Code 128 B: "${caractere}" em "${texto}".`);
    }
    valores.push(codigo - 32);
  }

  // Checksum: START + soma ponderada dos dados, modulo 103.
  const soma = valores.reduce((acc, valor, i) => acc + valor * Math.max(i, 1), 0);
  valores.push(soma % 103);
  valores.push(STOP);

  const larguras: number[] = [];
  for (const valor of valores) {
    for (const largura of PADROES[valor]!) larguras.push(Number(largura));
  }
  // Barra final de encerramento (2 modulos), obrigatoria no Code 128.
  larguras.push(2);
  return larguras;
}
