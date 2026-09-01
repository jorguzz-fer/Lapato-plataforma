import { describe, expect, it } from 'vitest';
import {
  comporDescricaoMacro,
  GRUPOS_DESCRITORES_MACRO,
  TEXTO_TODO_MATERIAL,
} from './macroscopia-descritores.js';

describe('composição determinística dos bloquinhos', () => {
  it('monta a frase na ordem canônica, com conectores', () => {
    const texto = comporDescricaoMacro({
      cor: ['avermelhada'],
      consistencia: ['firme'],
      delimitacao: ['bem delimitado'],
      corte: ['sólido', 'homogêneo'],
    });
    expect(texto).toBe(
      'Fragmento de tecido de coloração avermelhada, de consistência firme, ' +
        'bem delimitado, ao corte, com aspecto sólido e homogêneo.',
    );
  });

  it('a característica vira o sujeito da frase, no lugar de "de tecido"', () => {
    expect(comporDescricaoMacro({ caracteristica: ['cutâneo'], cor: ['acastanhada'] })).toBe(
      'Fragmento cutâneo de coloração acastanhada.',
    );
    // Sem nenhuma oração, o sujeito sozinho já é uma frase válida.
    expect(comporDescricaoMacro({ caracteristica: ['de nodulectomia'] })).toBe(
      'Fragmento de nodulectomia.',
    );
  });

  it('a representação fecha o texto, depois das medidas', () => {
    const texto = comporDescricaoMacro(
      { consistencia: ['firme'], representacao: [TEXTO_TODO_MATERIAL, 'margens'] },
      { comprimentoCm: 2 },
    );
    expect(texto).toBe(
      'Fragmento de tecido de consistência firme. Mede 2,0 cm. ' +
        'Representação: todo o material incluído e margens.',
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

  it('aceita descritor fora da curadoria - o "outro…" da bancada', () => {
    expect(comporDescricaoMacro({ cor: ['esverdeada'] })).toBe(
      'Fragmento de tecido de coloração esverdeada.',
    );
  });

  it('sem nenhuma marcação, devolve vazio - quem chama decide recusar', () => {
    expect(comporDescricaoMacro({})).toBe('');
    // Só medidas, sem descritor, ainda produz a frase de medidas.
    expect(comporDescricaoMacro({}, { pesoG: 10 })).toBe('pesa 10 g.');
  });
});

describe('vocabulário', () => {
  it('todo rótulo tem texto, e o texto do grupo não se repete', () => {
    for (const grupo of GRUPOS_DESCRITORES_MACRO) {
      const textos = grupo.opcoes.map((o) => o.texto);
      expect(textos.every((t) => t.trim() !== '')).toBe(true);
      expect(grupo.opcoes.every((o) => o.rotulo.trim() !== '')).toBe(true);
      expect(new Set(textos).size, `textos repetidos em ${grupo.chave}`).toBe(textos.length);
    }
  });

  it('há exatamente um núcleo e um fecho - a frase tem um sujeito só', () => {
    expect(GRUPOS_DESCRITORES_MACRO.filter((g) => g.papel === 'nucleo')).toHaveLength(1);
    expect(GRUPOS_DESCRITORES_MACRO.filter((g) => g.papel === 'fecho')).toHaveLength(1);
  });

  it('"todo o material" existe na representação: é o par do campo da ficha', () => {
    const representacao = GRUPOS_DESCRITORES_MACRO.find((g) => g.chave === 'representacao');
    expect(representacao?.opcoes.map((o) => o.texto)).toContain(TEXTO_TODO_MATERIAL);
  });
});
