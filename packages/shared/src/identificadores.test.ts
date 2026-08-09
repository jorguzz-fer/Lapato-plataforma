import { test, describe, expect } from 'vitest';
import {
  MASCARA_CASO_PADRAO,
  formatarIdentificadorCaso,
  identificadorAmostra,
  identificadorCassete,
  identificadorImagem,
  identificadorLamina,
  identificadorRecipiente,
  identificadorRemessa,
  identificadorSolicitacao,
} from './identificadores.js';

describe('formatarIdentificadorCaso', () => {
  test('produz o formato do M05 (CV-000342/26)', () => {
    const id = formatarIdentificadorCaso({ siglaCliente: 'CV', sequencial: 342, ano: 2026 });
    expect(id).toBe('CV-000342/26');
  });

  test('produz o formato compacto do M01 (HV342/26)', () => {
    const id = formatarIdentificadorCaso(
      { siglaCliente: 'HV', sequencial: 342, ano: 2026 },
      { ...MASCARA_CASO_PADRAO, separador: '', digitosSequencial: 3 },
    );
    expect(id).toBe('HV342/26');
  });

  test('respeita ano com 4 digitos quando configurado', () => {
    const id = formatarIdentificadorCaso(
      { siglaCliente: 'CV', sequencial: 7, ano: 2026 },
      { ...MASCARA_CASO_PADRAO, digitosAno: 4 },
    );
    expect(id).toBe('CV-000007/2026');
  });

  test('omite a sigla do cliente quando a instituicao nao usa', () => {
    const id = formatarIdentificadorCaso(
      { siglaCliente: 'CV', sequencial: 342, ano: 2026 },
      { ...MASCARA_CASO_PADRAO, usarSiglaCliente: false },
    );
    expect(id).toBe('000342/26');
  });

  test('normaliza a sigla para maiuscula', () => {
    const id = formatarIdentificadorCaso({ siglaCliente: 'cv', sequencial: 1, ano: 2026 });
    expect(id).toBe('CV-000001/26');
  });

  test('vira o ano corretamente na virada de decada', () => {
    const id = formatarIdentificadorCaso({ siglaCliente: 'CV', sequencial: 1, ano: 2030 });
    expect(id).toBe('CV-000001/30');
  });
});

describe('cadeia hierarquica de identificadores', () => {
  const caso = 'CV-000342/26';

  test('recipiente e amostra usam dois digitos (M05)', () => {
    expect(identificadorRecipiente(caso, 1)).toBe('CV-000342/26-F01');
    expect(identificadorAmostra(caso, 3)).toBe('CV-000342/26-A03');
  });

  test('cassete segue o padrao do M08', () => {
    expect(identificadorCassete(caso, 'A', 1)).toBe('CV-000342/26-A1');
  });

  test('cassete aceita sufixo semantico de margem do M08', () => {
    expect(identificadorCassete(caso, 'MA', 1)).toBe('CV-000342/26-MA1');
  });

  /**
   * Este e o encadeamento que o M09 chama de "origem totalmente rastreavel ate
   * o fragmento macroscopico": a lamina carrega o cassete, que carrega o caso.
   */
  test('lamina preserva a origem ate o caso', () => {
    const cassete = identificadorCassete(caso, 'A', 1);
    expect(identificadorLamina(cassete, 'HE')).toBe('CV-000342/26-A1-HE');
    expect(identificadorLamina(cassete, 'HE').startsWith(caso)).toBe(true);
  });

  test('nivel adicional aparece antes da coloracao (M09)', () => {
    const cassete = identificadorCassete(caso, 'A', 1);
    expect(identificadorLamina(cassete, 'HE', 2)).toBe('CV-000342/26-A1-N2-HE');
  });

  test('nivel 1 nao polui o identificador', () => {
    const cassete = identificadorCassete(caso, 'A', 1);
    expect(identificadorLamina(cassete, 'PAS', 1)).toBe('CV-000342/26-A1-PAS');
  });
});

describe('identificadores proprios de outros modulos', () => {
  test('solicitacao usa numeracao propria, distinta do caso (M10)', () => {
    expect(identificadorSolicitacao(2026, 5421)).toBe('SOL-2026-005421');
  });

  test('imagem usa numeracao propria (M16)', () => {
    expect(identificadorImagem(2026, 4582)).toBe('IMG-2026-0004582');
  });

  test('remessa usa numeracao propria (M05)', () => {
    expect(identificadorRemessa(2026, 481)).toBe('REM-2026-00481');
  });
});
