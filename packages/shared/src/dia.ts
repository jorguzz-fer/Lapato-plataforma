/**
 * Limites do dia no fuso da instituicao.
 *
 * Existe por um motivo pratico: os containers rodam em UTC e o laboratorio nao.
 * Um caso liberado as 22h de Sao Paulo acontece as 01h do dia seguinte em UTC -
 * contar "liberados hoje" pelo relogio do servidor jogaria o fim do expediente
 * para o dia seguinte, e o painel abriria a manha mostrando trabalho que ja
 * tinha sido creditado. Todo recorte de dia do painel passa por aqui.
 *
 * M01 secao 30 trata fuso como configuracao da instituicao (`tenant.preferencias`);
 * o padrao abaixo so vale quando ela nao configurou nada.
 */
export const FUSO_PADRAO = 'America/Sao_Paulo';

interface CamposLocais {
  ano: number;
  mes: number;
  dia: number;
}

/**
 * Deslocamento do fuso, em milissegundos, no instante dado.
 *
 * Calculado a partir do proprio `Intl` em vez de uma tabela fixa: assim um fuso
 * com horario de verao continua correto quando ele entra ou sai de vigencia.
 */
function deslocamentoMs(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const campo = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? '0');

  const comoSeFosseUtc = Date.UTC(
    campo('year'),
    campo('month') - 1,
    campo('day'),
    // `hour12: false` emite 24 para a meia-noite em algumas engines.
    campo('hour') % 24,
    campo('minute'),
    campo('second'),
  );

  // Os milissegundos nao aparecem no `Intl`; truncar dos dois lados mantem a
  // subtracao exata em vez de deixar um residuo de ate 999 ms.
  return comoSeFosseUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

function camposLocais(instante: Date, fuso: string): CamposLocais {
  const deslocado = new Date(instante.getTime() + deslocamentoMs(instante, fuso));
  return {
    ano: deslocado.getUTCFullYear(),
    mes: deslocado.getUTCMonth() + 1,
    dia: deslocado.getUTCDate(),
  };
}

/**
 * Meia-noite local de `diasAtras` dias antes de `instante`, como instante UTC.
 *
 * `diasAtras = 0` e o comeco de hoje; `1`, o de ontem.
 */
export function inicioDoDia(instante: Date, diasAtras = 0, fuso = FUSO_PADRAO): Date {
  const { ano, mes, dia } = camposLocais(instante, fuso);
  const meiaNoiteComoUtc = Date.UTC(ano, mes - 1, dia - diasAtras);

  const aproximado = new Date(meiaNoiteComoUtc - deslocamentoMs(instante, fuso));
  /**
   * Segunda passagem: o deslocamento e medido em `instante`, e num fuso com
   * horario de verao o dia procurado pode estar do outro lado da virada. Medir
   * de novo NO candidato corrige a hora de diferenca; se nao houver virada, a
   * segunda conta devolve o mesmo valor e nada muda.
   */
  return new Date(meiaNoiteComoUtc - deslocamentoMs(aproximado, fuso));
}

/** Data local no formato `AAAA-MM-DD`, para rotular series por dia. */
export function diaLocalIso(instante: Date, fuso = FUSO_PADRAO): string {
  const { ano, mes, dia } = camposLocais(instante, fuso);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Le o fuso configurado pela instituicao, caindo no padrao quando ausente. */
export function fusoDaInstituicao(preferencias: Record<string, unknown> | null | undefined): string {
  const fuso = preferencias?.['fuso'];
  if (typeof fuso !== 'string' || fuso.trim() === '') return FUSO_PADRAO;
  try {
    // Um fuso invalido vindo da configuracao nao pode derrubar o painel.
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}
