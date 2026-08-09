import type { NivelIa } from './enums.js';
import type { Modulo } from './modulos.js';

/**
 * Contrato do LAPATO Guardian (M17).
 *
 * M17 secao 7: o Guardian responde "existe algo potencialmente errado,
 * incoerente, incompleto ou perigoso neste momento?".
 *
 * Ele e **deterministico** e nao depende de LLM: tudo que a documentacao pede
 * (identidade divergente, lateralidade cadastro x laudo, margem estruturada x
 * texto, campo obrigatorio vazio, coerencia numerica) e regra sobre dado
 * estruturado. Ver docs/adr/0007.
 */

/** Codigo estavel do achado, usado em teste, log e telemetria. */
export type CodigoAchado = string;

export interface AchadoGuardian {
  codigo: CodigoAchado;
  nivel: NivelIa;
  /** Mensagem exibida ao usuario. */
  mensagem: string;
  /** Modulo cuja regra produziu o achado. */
  modulo: Modulo;
  /** Campo ou objeto ao qual o achado se refere, quando aplicavel. */
  campo?: string;
  /**
   * M17 secao 15: transparencia. Quais dados sustentam o achado, para o usuario
   * poder conferir em vez de confiar cegamente.
   */
  evidencias?: Record<string, unknown>;
}

/**
 * M17 secao 11 + M02: um achado `critico` **bloqueia** a acao. Os demais niveis
 * informam, mas deixam o profissional decidir - "a IA sugere; o profissional
 * decide".
 */
export function bloqueia(achados: AchadoGuardian[]): boolean {
  return achados.some((a) => a.nivel === 'critico');
}

export function achadosCriticos(achados: AchadoGuardian[]): AchadoGuardian[] {
  return achados.filter((a) => a.nivel === 'critico');
}

/** Ordena do mais grave para o menos grave, para exibicao no painel. */
const PESO_NIVEL: Record<NivelIa, number> = {
  critico: 0,
  atencao: 1,
  sugestao: 2,
  informacao: 3,
};

export function ordenarPorGravidade(achados: AchadoGuardian[]): AchadoGuardian[] {
  return [...achados].sort((a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel]);
}

/**
 * Erro lancado quando uma acao e barrada pelo Guardian.
 * A API traduz para RFC 7807 com os achados no corpo, para o front poder
 * exibi-los no painel em vez de mostrar um erro generico.
 */
export class BloqueioGuardianError extends Error {
  constructor(
    readonly achados: AchadoGuardian[],
    readonly acao: string,
  ) {
    const criticos = achadosCriticos(achados);
    super(
      `Ação "${acao}" bloqueada pelo LAPATO Guardian: ` +
        criticos.map((a) => a.mensagem).join(' | '),
    );
    this.name = 'BloqueioGuardianError';
  }
}
