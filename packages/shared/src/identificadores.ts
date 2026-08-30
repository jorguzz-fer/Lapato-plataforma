/**
 * Geracao dos identificadores hierarquicos do LAPATO (M01 + M05 + M08 + M09).
 *
 * M01: o formato e configuravel por instituicao. O exemplo da documentacao usa
 * sigla do cliente + sequencial + ano (`HV342/26`); o M05 usa a variante com
 * separador e zeros a esquerda (`CV-000342/26`).
 *
 * M01: "o codigo gerado nao pode ser modificado, mas pode ser acrescido de
 * sufixos hierarquicos". Dai a cadeia:
 *
 *   Caso        CV-000342/26
 *   Recipiente  CV-000342/26-F01
 *   Amostra     CV-000342/26-A01
 *   Cassete     CV-000342/26-A1
 *   Bloco       CV-000342/26-A1
 *   Lamina      CV-000342/26-A1-HE      (nivel adicional: -A1-N2-HE)
 *
 * M09: "cada lamina deve possuir origem totalmente rastreavel ate o fragmento
 * macroscopico" - por isso o identificador da lamina carrega o do cassete, que
 * carrega o do caso.
 */

/** Mascara de numeracao do caso, configurada por instituicao no M01. */
export interface MascaraCaso {
  /** Texto fixo antes da sigla, se houver. Ex.: '' ou 'LAP'. */
  prefixo: string;
  /** Inclui a sigla do cliente no identificador. */
  usarSiglaCliente: boolean;
  /** Separador entre sigla e sequencial. Ex.: '-' em `CV-000342/26`. */
  separador: string;
  /** Quantidade de digitos do sequencial, preenchido com zeros a esquerda. */
  digitosSequencial: number;
  /** Separador antes do ano. Ex.: '/' em `CV-000342/26`. */
  separadorAno: string;
  /** 2 = '26'; 4 = '2026'. */
  digitosAno: 2 | 4;
}

export const MASCARA_CASO_PADRAO: MascaraCaso = {
  prefixo: '',
  usarSiglaCliente: true,
  separador: '-',
  digitosSequencial: 6,
  separadorAno: '/',
  digitosAno: 2,
};

export interface DadosIdentificadorCaso {
  /** Sigla do cliente (M03: "codigo do cliente"). Ex.: 'CV', 'HV'. */
  siglaCliente: string;
  /** Sequencial da instituicao no ano. M01: nunca reutilizavel. */
  sequencial: number;
  /** Ano de referencia (ano civil de abertura do caso). */
  ano: number;
}

/**
 * Monta o identificador oficial do caso.
 *
 * M01: o sequencial e unico, automatico e **nunca reutilizavel** - preservado
 * mesmo quando o caso e cancelado.
 */
export function formatarIdentificadorCaso(
  dados: DadosIdentificadorCaso,
  mascara: MascaraCaso = MASCARA_CASO_PADRAO,
): string {
  const sequencial = String(dados.sequencial).padStart(mascara.digitosSequencial, '0');
  const ano =
    mascara.digitosAno === 2
      ? String(dados.ano % 100).padStart(2, '0')
      : String(dados.ano).padStart(4, '0');

  const sigla = mascara.usarSiglaCliente ? dados.siglaCliente.toUpperCase() : '';
  const cabeca = `${mascara.prefixo}${sigla}`;
  const corpo = cabeca ? `${cabeca}${mascara.separador}${sequencial}` : sequencial;

  return `${corpo}${mascara.separadorAno}${ano}`;
}

/** `CV-000342/26` + 1 -> `CV-000342/26-F01` (M05). */
export function identificadorRecipiente(idCaso: string, ordem: number): string {
  return `${idCaso}-F${String(ordem).padStart(2, '0')}`;
}

/** `CV-000342/26` + 1 -> `CV-000342/26-A01` (M05). */
export function identificadorAmostra(idCaso: string, ordem: number): string {
  return `${idCaso}-A${String(ordem).padStart(2, '0')}`;
}

/**
 * `CV-000342/26` + 'A' + 1 -> `CV-000342/26-A1` (M08).
 *
 * A letra e a da amostra dentro do caso e o numero e o do cassete dentro dela.
 * O M08 usa tambem sufixos semanticos como `MA1` (margem) e `L` (linfonodo),
 * por isso `letraAmostra` e string livre e nao um indice.
 */
export function identificadorCassete(
  idCaso: string,
  letraAmostra: string,
  ordem: number,
): string {
  return `${idCaso}-${letraAmostra.toUpperCase()}${ordem}`;
}

/**
 * `CV-000342/26-A1` + 'HE' -> `CV-000342/26-A1-HE` (M09).
 * Com nivel adicional: `CV-000342/26-A1-N2-HE`.
 */
export function identificadorLamina(
  idCassete: string,
  coloracao: string,
  nivel?: number,
): string {
  const sufixoNivel = nivel && nivel > 1 ? `-N${nivel}` : '';
  return `${idCassete}${sufixoNivel}-${coloracao.toUpperCase()}`;
}

/** Identificador proprio da solicitacao: `SOL-2026-005421` (M10). */
export function identificadorSolicitacao(ano: number, sequencial: number): string {
  return `SOL-${ano}-${String(sequencial).padStart(6, '0')}`;
}

/**
 * Identificador da Ordem de Servico: `OS-2026-000123` (M20).
 *
 * Serie propria e anual, separada da numeracao do caso: a OS e o documento da
 * COBRANCA, e o financeiro precisa de uma sequencia continua propria - buracos
 * na serie de casos (cancelamentos, necropsia sem cobranca) nao podem aparecer
 * como buracos na serie fiscal.
 */
export function identificadorOrdemServico(ano: number, sequencial: number): string {
  return `OS-${ano}-${String(sequencial).padStart(6, '0')}`;
}

/** Identificador da fatura: `FAT-2026-000045` (M20). Mesma logica fiscal da OS. */
export function identificadorFatura(ano: number, sequencial: number): string {
  return `FAT-${ano}-${String(sequencial).padStart(6, '0')}`;
}

/** Identificador proprio da imagem: `IMG-2026-0004582` (M16). */
export function identificadorImagem(ano: number, sequencial: number): string {
  return `IMG-${ano}-${String(sequencial).padStart(7, '0')}`;
}

/**
 * Identificador do cadaver: `CAD-2026-00259` (M15 secao 4).
 *
 * Serie propria, e nao o numero do caso, porque o corpo e rastreado mesmo antes
 * de existir caso - a entrada provisoria da secao 5 depende disso. Ele e o que
 * vai na etiqueta e no QR Code.
 */
export function identificadorCadaver(ano: number, sequencial: number): string {
  return `CAD-${ano}-${String(sequencial).padStart(5, '0')}`;
}

/** Identificador da remessa, que agrupa varios casos: `REM-2026-00481` (M05). */
export function identificadorRemessa(ano: number, sequencial: number): string {
  return `REM-${ano}-${String(sequencial).padStart(5, '0')}`;
}

/**
 * Identificador de custodia do Objeto Biologico: `BIO-2026-000123` (M18 secao 15).
 *
 * Serie propria, e nao o numero do caso, porque um mesmo caso gera dezenas de
 * objetos - blocos, laminas, fragmentos congelados - e cada um precisa de uma
 * identidade que caiba numa etiqueta e num QR Code de gaveta (secao 16). O
 * vinculo com o caso continua nas colunas de genealogia, nao no codigo.
 */
export function identificadorObjetoBiologico(ano: number, sequencial: number): string {
  return `BIO-${ano}-${String(sequencial).padStart(6, '0')}`;
}

/** Emprestimo de material do acervo: `EMP-2026-00042` (M18 secao 37). */
export function identificadorEmprestimo(ano: number, sequencial: number): string {
  return `EMP-${ano}-${String(sequencial).padStart(5, '0')}`;
}

/** Inventario fisico da Bioteca: `INV-2026-00007` (M18 secao 54). */
export function identificadorInventario(ano: number, sequencial: number): string {
  return `INV-${ano}-${String(sequencial).padStart(5, '0')}`;
}

/** Lote de destinacao final: `BIO-DESC-2026-00004` (M18 secao 51). */
export function identificadorLoteDescarte(ano: number, sequencial: number): string {
  return `BIO-DESC-${ano}-${String(sequencial).padStart(5, '0')}`;
}

/**
 * Solicitacao logistica: `LOG-2026-000842` (M19 secao 12).
 *
 * Serie propria, e nao o numero do caso: a coleta quase sempre acontece ANTES
 * de o caso existir - o caso nasce no recebimento (M05). Amarrar a numeracao
 * logistica ao caso tornaria impossivel identificar a operacao no momento em
 * que ela mais precisa de identidade, que e quando o encarregado esta no
 * balcao do cliente.
 */
export function identificadorColeta(ano: number, sequencial: number): string {
  return `LOG-${ano}-${String(sequencial).padStart(6, '0')}`;
}
