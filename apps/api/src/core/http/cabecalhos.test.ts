import { describe, expect, test } from 'vitest';
import { nomeParaCabecalho } from './cabecalhos.js';

describe('nome de arquivo no Content-Disposition', () => {
  test('nome comum passa intacto', () => {
    expect(nomeParaCabecalho('macroscopia-01.jpg')).toBe('macroscopia-01.jpg');
  });

  test('aspa nao fecha o valor do cabecalho antes da hora', () => {
    // Sem tratamento isto viraria: filename="x"; filename="outro.html" - e o
    // navegador salvaria com o segundo nome.
    expect(nomeParaCabecalho('x"; filename="outro.html')).toBe('x_; filename=_outro.html');
  });

  test('caracteres de controle sao neutralizados', () => {
    expect(nomeParaCabecalho('a\r\nb c')).toBe('a__b c');
  });

  test('nome vazio depois da limpeza vira um nome utilizavel', () => {
    expect(nomeParaCabecalho('   ')).toBe('arquivo');
  });
});
