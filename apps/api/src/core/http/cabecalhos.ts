/**
 * Nome de arquivo seguro para o cabecalho `Content-Disposition`.
 *
 * O nome vem do arquivo que o usuario enviou e volta num cabecalho HTTP. Uma
 * aspa no meio fecha o valor mais cedo e deixa o resto do nome virar novos
 * parametros do cabecalho - da para trocar o `filename` que o navegador salva.
 * O Node ja recusa CR/LF em cabecalho, entao a quebra de linha nao passa; o que
 * falta e a aspa, a barra invertida e os caracteres de controle.
 */
export function nomeParaCabecalho(nome: string): string {
  // eslint-disable-next-line no-control-regex
  const limpo = nome.replace(/[\u0000-\u001f\u007f"\\]/g, '_').trim();
  return limpo.slice(0, 120) || 'arquivo';
}
