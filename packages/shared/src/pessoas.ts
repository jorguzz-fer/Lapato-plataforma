/**
 * Apresentacao de nomes de pessoas.
 *
 * Vive no `shared` porque e logica pura e porque e aqui que este repositorio
 * guarda o que precisa de teste - o `apps/web` nao tem executor de testes.
 */

/**
 * Iniciais para o avatar da barra superior.
 *
 * Tolera nome ausente, vazio ou so com espacos de proposito. O front e a API
 * sao dois contêineres com deploys independentes: durante uma atualizacao, o
 * front novo conversa por alguns minutos com a API antiga, que ainda nao
 * devolve os campos que ele espera. Um `.trim()` direto sobre esse `undefined`
 * derruba o render inteiro - foi o que aconteceu, e a tela ficou branca sem
 * dizer nada a quem estava tentando trabalhar.
 *
 * "Ana Beatriz Silva" vira "AS", e nao "AB": o sobrenome distingue mais gente
 * numa equipe do que o nome do meio.
 */
export function iniciaisDe(nome: string | null | undefined): string {
  const partes = (nome ?? '')
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 0);

  if (partes.length === 0) return '';

  const primeira = partes[0]![0]!;
  const ultima = partes[partes.length - 1]![0]!;

  return (partes.length === 1 ? primeira : `${primeira}${ultima}`).toUpperCase();
}

/**
 * Primeiro nome, para a saudacao do painel.
 *
 * Mesma tolerancia do `iniciaisDe`, e pela mesma razao: o painel e a primeira
 * tela depois do login, e ela nao pode depender de a API ja ter subido com o
 * campo novo.
 */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}
