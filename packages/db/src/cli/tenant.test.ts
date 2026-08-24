import { describe, expect, test, vi } from 'vitest';
import { escolherInstituicao, type InstituicaoResumo } from './tenant.js';

/**
 * A escolha da instituicao nos comandos de manutencao.
 *
 * O que se prova aqui e a fronteira: a comodidade de nao precisar do slug vale
 * **so** quando nao ha o que confundir. Com duas instituicoes o comando para,
 * porque escolher errado significa mexer no banco de outro cliente.
 */

const uma: InstituicaoResumo[] = [{ id: 'id-1', slug: 'lapato', nome: 'LAPATO' }];
const duas: InstituicaoResumo[] = [
  ...uma,
  { id: 'id-2', slug: 'outra', nome: 'Outra Clínica' },
];

describe('escolherInstituicao', () => {
  test('sem slug e com uma única instituição, usa ela', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(escolherInstituicao(uma, undefined, 'X_SLUG').id).toBe('id-1');
      // Dizer qual escolheu é parte do contrato: silêncio aqui viraria surpresa.
      expect(aviso.mock.calls.flat().join(' ')).toContain('lapato');
    } finally {
      aviso.mockRestore();
    }
  });

  test('sem slug e com mais de uma, para e nomeia a variável do comando', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => escolherInstituicao(duas, undefined, 'EQUIPE_TENANT_SLUG')).toThrow(
        /EQUIPE_TENANT_SLUG/,
      );
      // E lista as opções: quem está num terminal de container não tem o docs aberto.
      const texto = aviso.mock.calls.flat().join(' ');
      expect(texto).toContain('lapato');
      expect(texto).toContain('outra');
    } finally {
      aviso.mockRestore();
    }
  });

  test('com slug informado, usa ele mesmo havendo várias', () => {
    expect(escolherInstituicao(duas, 'outra', 'X_SLUG').id).toBe('id-2');
  });

  test('slug que não existe falha, em vez de cair na única', () => {
    expect(() => escolherInstituicao(uma, 'inexistente', 'X_SLUG')).toThrow(/inexistente/);
  });

  test('banco sem instituição nenhuma manda provisionar', () => {
    expect(() => escolherInstituicao([], undefined, 'X_SLUG')).toThrow(/provision/i);
  });
});
