import { describe, expect, it } from 'vitest';
import { comporDescricaoMacro } from './macroscopia-descritores.js';

describe('composição determinística dos bloquinhos', () => {
  it('monta a frase na ordem canônica, com conectores', () => {
    const texto = comporDescricaoMacro({
      cor: ['avermelhada'],
      consistencia: ['firme'],
      delimitacao: ['bem delimitada'],
      corte: ['sólido e homogêneo'],
    });
    expect(texto).toBe(
      'Fragmento de tecido de coloração avermelhada, de consistência firme, ' +
        'bem delimitada, ao corte, com aspecto sólido e homogêneo.',
    );
  });

  it('lista múltiplas marcações com vírgula e "e"', () => {
    const texto = comporDescricaoMacro({ cor: ['esbranquiçada', 'amarelada', 'vinhosa'] });
    expect(texto).toContain('esbranquiçada, amarelada e vinhosa');
  });

  it('anexa medidas e peso quando existem', () => {
    const texto = comporDescricaoMacro(
      { consistencia: ['macia'] },
      { comprimentoCm: 3, larguraCm: 2, alturaCm: 1, pesoG: 15 },
    );
    expect(texto).toContain('Mede 3,0 × 2,0 × 1,0 cm');
    expect(texto).toContain('pesa 15 g');
  });

  it('sem nenhuma marcação, devolve vazio - quem chama decide recusar', () => {
    expect(comporDescricaoMacro({})).toBe('');
    // Só medidas, sem descritor, ainda produz a frase de medidas.
    expect(comporDescricaoMacro({}, { pesoG: 10 })).toBe('pesa 10 g.');
  });
});
