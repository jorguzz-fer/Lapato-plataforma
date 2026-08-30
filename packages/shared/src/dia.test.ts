import { describe, expect, it } from 'vitest';
import {
  diaLocalIso,
  FUSO_PADRAO,
  fusoDaInstituicao,
  fusoSuportado,
  inicioDoDia,
} from './dia.js';

describe('limites do dia no fuso da instituicao', () => {
  it('a meia-noite de Sao Paulo e 03:00 UTC', () => {
    // 2026-08-26 14:00 UTC = 11:00 em Sao Paulo.
    const inicio = inicioDoDia(new Date('2026-08-26T14:00:00Z'));
    expect(inicio.toISOString()).toBe('2026-08-26T03:00:00.000Z');
  });

  /**
   * O caso que motivou o modulo: as 22h de Sao Paulo ja e o dia seguinte em UTC.
   * Contar pelo relogio do servidor jogaria o fim do expediente para amanha.
   */
  it('as 22h locais ainda pertencem ao dia local, nao ao dia UTC seguinte', () => {
    const fimDeExpediente = new Date('2026-08-27T01:00:00Z'); // 26/08 22:00 em SP
    expect(diaLocalIso(fimDeExpediente)).toBe('2026-08-26');
    expect(inicioDoDia(fimDeExpediente).toISOString()).toBe('2026-08-26T03:00:00.000Z');
  });

  it('conta dias para tras pelo calendario local', () => {
    const agora = new Date('2026-08-26T14:00:00Z');
    expect(inicioDoDia(agora, 6).toISOString()).toBe('2026-08-20T03:00:00.000Z');
  });

  it('atravessa a virada do mes sem estourar o dia', () => {
    const agora = new Date('2026-09-02T14:00:00Z');
    expect(inicioDoDia(agora, 3).toISOString()).toBe('2026-08-30T03:00:00.000Z');
  });

  it('respeita outro fuso quando a instituicao configura um', () => {
    const inicio = inicioDoDia(new Date('2026-08-26T14:00:00Z'), 0, 'UTC');
    expect(inicio.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });
});

describe('fuso configurado pela instituicao', () => {
  it('usa o padrao quando nao ha preferencia', () => {
    expect(fusoDaInstituicao(null)).toBe(FUSO_PADRAO);
    expect(fusoDaInstituicao({})).toBe(FUSO_PADRAO);
    expect(fusoDaInstituicao({ fuso: '  ' })).toBe(FUSO_PADRAO);
  });

  it('usa o fuso configurado', () => {
    expect(fusoDaInstituicao({ fuso: 'America/Manaus' })).toBe('America/Manaus');
  });

  /** Configuracao errada degrada para o padrao; painel nao pode cair por isso. */
  it('ignora fuso invalido', () => {
    expect(fusoDaInstituicao({ fuso: 'Nao/Existe' })).toBe(FUSO_PADRAO);
  });
});

describe('runtime sem os dados de fuso', () => {
  /**
   * Node com ICU reduzido so conhece UTC. O recorte do dia sai errado, mas a
   * tela abre - e uma pagina com o dia deslocado e melhor que um 500 sem pista.
   */
  it('degrada para UTC em vez de lancar quando o fuso nao existe no runtime', () => {
    expect(fusoSuportado('Nao/Existe')).toBe(false);
    const inicio = inicioDoDia(new Date('2026-08-26T14:00:00Z'), 0, 'Nao/Existe');
    expect(inicio.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(diaLocalIso(new Date('2026-08-26T14:00:00Z'), 'Nao/Existe')).toBe('2026-08-26');
  });
});

describe('chave do fuso nas preferencias', () => {
  /** O provisionamento grava `fusoHorario`; a configuracao manual, `fuso`. */
  it('aceita as duas chaves que existem no banco', () => {
    expect(fusoDaInstituicao({ fusoHorario: 'America/Manaus' })).toBe('America/Manaus');
    expect(fusoDaInstituicao({ fuso: 'America/Manaus' })).toBe('America/Manaus');
    expect(fusoDaInstituicao({ fusoHorario: 'America/Manaus', fuso: 'UTC' })).toBe(
      'America/Manaus',
    );
  });
});
