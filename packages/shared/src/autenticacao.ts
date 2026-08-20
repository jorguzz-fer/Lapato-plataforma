import { PERMISSOES, type Permissao } from './permissoes.js';

/**
 * Estagios de uma sessao (M02, Blueprint secao 6).
 *
 * Autenticar nao e um interruptor: entre "digitou a senha certa" e "pode operar
 * o sistema" existem etapas obrigatorias. Modelar isso como estagio - e nao como
 * uma sequencia de `if` espalhados pelas telas - garante que **negar e o
 * padrao**: uma rota so aceita os estagios que declarar explicitamente.
 *
 * Precedencia, do mais restritivo ao menos:
 *
 * 1. `anonimo`                    - sem cookie, expirado ou revogado.
 * 2. `mfa_pendente`               - senha aceita, segundo fator ainda nao.
 * 3. `troca_senha_obrigatoria`    - senha definida por terceiro (provisionamento).
 * 4. `mfa_cadastro_obrigatorio`   - papel sensivel sem TOTP cadastrado.
 * 5. `ativa`                      - pode operar.
 *
 * A ordem entre 3 e 4 e deliberada: a senha inicial passou por terminal, log de
 * shell e, muitas vezes, mensagem de texto. E o elo mais fraco e sai primeiro.
 */
export const ESTAGIOS_SESSAO = [
  'anonimo',
  'mfa_pendente',
  'troca_senha_obrigatoria',
  'mfa_cadastro_obrigatorio',
  'ativa',
] as const;

export type EstagioSessao = (typeof ESTAGIOS_SESSAO)[number];

/**
 * Blueprint secao 6: "MFA TOTP obrigatorio para admin e para quem assina laudo."
 *
 * Traduzido em permissoes, e nao em perfis, porque o M02 secao 10 diz que
 * "perfis nao devem ser absolutos" - a instituicao pode conceder assinatura a um
 * perfil que criou. A exigencia acompanha a capacidade, nao o rotulo.
 *
 * - `laudo:assinar`      - a assinatura e o ato juridico do sistema.
 * - `permissao:gerenciar`- quem concede permissao pode conceder a si mesmo.
 */
export const PERMISSOES_QUE_EXIGEM_MFA: Permissao[] = [
  PERMISSOES.LAUDO_ASSINAR,
  PERMISSOES.PERMISSAO_GERENCIAR,
];

export function exigeMfa(permissoes: Iterable<string>): boolean {
  const conjunto = permissoes instanceof Set ? permissoes : new Set(permissoes);
  return PERMISSOES_QUE_EXIGEM_MFA.some((p) => conjunto.has(p));
}

/**
 * Tamanho minimo da senha escolhida pelo proprio usuario.
 *
 * 12 caracteres sem regra de composicao, seguindo a orientacao atual do NIST
 * (SP 800-63B): exigir simbolo e maiuscula produz `Senha@2026`, previsivel e
 * curta. Comprimento e o que sustenta o Argon2id.
 *
 * O provisionamento usa um minimo maior (16) porque aquela senha e digitada uma
 * vez e trafega por terminal - contexto diferente, exigencia diferente.
 */
export const SENHA_TAMANHO_MINIMO = 12;

/** Digitos de um codigo TOTP. */
export const MFA_TAMANHO_CODIGO = 6;
