/**
 * Componentes base do LAPATO (Blueprint secao 9, ADR 0008).
 *
 * As telas importam daqui, nunca de `@mui/material` diretamente. E o que faz a
 * lib visual ser trocavel: quando o front migrou de Tailwind para MUI, foi esta
 * fronteira que manteve a mudanca barata.
 *
 * Dois tipos de componente convivem aqui:
 *
 * - os que so aplicam identidade visual (`MolduraEntrada`, `CampoSenha`);
 * - os que carregam **regra de dominio** e por isso nao poderiam ser um
 *   componente do MUI configurado na tela - `IndicadorPrazo` e o exemplo: o M07
 *   exige que o estado nao dependa apenas de cor, e essa exigencia nao pode
 *   depender de alguem lembrar dela a cada uso.
 */

export { ProvedorLapato, useTema } from './Provedor.js';
export { temaClaro, temaEscuro } from './tema.js';
export { MolduraEntrada, type DestaqueEntrada } from './MolduraEntrada.js';
export { CampoSenha } from './CampoSenha.js';
export { IndicadorPrazo } from './IndicadorPrazo.js';
