import type { AchadoGuardian, EstagioSessao } from '@lapato/shared';

/**
 * Cliente HTTP do front.
 *
 * Blueprint secao 6: a sessao viaja em cookie httpOnly, entao o token nunca
 * fica acessivel ao JavaScript - nao ha `Authorization` para montar aqui, so
 * `credentials: 'include'`.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Erro no formato RFC 7807 devolvido pela API. */
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly titulo: string,
    readonly detalhe: string,
    /** Presente quando a acao foi barrada pelo Guardian (M17). */
    readonly achados?: AchadoGuardian[],
    /** Presente quando a sessao parou num estagio do funil de entrada. */
    readonly estagio?: EstagioSessao,
  ) {
    super(detalhe || titulo);
    this.name = 'ErroApi';
  }

  get bloqueadoPeloGuardian(): boolean {
    return this.status === 409 && Array.isArray(this.achados);
  }
}

/**
 * Aviso de que a sessao regrediu de estagio no meio do uso.
 *
 * Acontece quando a exigencia muda com a sessao aberta - por exemplo, um
 * administrador concede permissao de assinar laudo a alguem que ainda nao tem
 * segundo fator. Sem isto, a proxima acao viraria um 403 seco na tela.
 */
let observadorDeEstagio: ((estagio: EstagioSessao) => void) | null = null;

export function observarEstagio(fn: (estagio: EstagioSessao) => void): void {
  observadorDeEstagio = fn;
}

async function requisitar<T>(
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<T> {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    credentials: 'include',
    headers: corpo === undefined ? {} : { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    if (resposta.status === 403 && dados?.estagio) {
      observadorDeEstagio?.(dados.estagio as EstagioSessao);
    }

    throw new ErroApi(
      resposta.status,
      dados?.title ?? 'Erro',
      dados?.detail ?? 'Não foi possível concluir a operação.',
      dados?.achados,
      dados?.estagio,
    );
  }

  return dados as T;
}

export const api = {
  get: <T>(caminho: string) => requisitar<T>('GET', caminho),
  post: <T>(caminho: string, corpo?: unknown) => requisitar<T>('POST', caminho, corpo),
};

// --- Tipos das respostas usadas pelas telas ---------------------------------

export interface Sessao {
  usuarioId: string;
  tenantId: string;
  unidadeId: string | null;
  exigeSupervisao: boolean;
  permissoes: string[];
  /** Falso quando a conta ainda não cadastrou o segundo fator. */
  mfaAtivo: boolean;
  /**
   * M09: preenchido quando a unidade do usuário é um laboratório de apoio.
   * O front usa para escolher a tela inicial; o isolamento de verdade é do
   * servidor, que filtra os lotes pela mesma informação.
   */
  laboratorioApoioId: string | null;
}

export interface CasoNaFila {
  casoId: string;
  identificador: string;
  paciente: string;
  cliente: string;
  servico: string;
  prioridade: string;
  etapa: string;
  previsaoLiberacao: string | null;
  alertaPrazo: 'normal' | 'atencao' | 'critico' | 'atrasado';
  bloqueado: boolean;
}

export interface EventoTimeline {
  id: string;
  tipo: string;
  moduloOrigem: string;
  ocorridoEm: string;
  payload: Record<string, unknown>;
}

export interface Dossie {
  caso: {
    id: string;
    identificador: string;
    prioridade: string;
    recebidoEm: string | null;
    triadoEm: string | null;
    resultadoTriagem: string | null;
  };
  cliente: { nomeFantasia: string };
  paciente: { nome: string; microchip: string | null };
  servico: { nome: string };
  estado: { etapa: string; previsaoLiberacao: string | null; bloqueado: boolean } | null;
  amostras: Array<{
    id: string;
    identificador: string;
    descricao: string | null;
    lateralidade: string;
    resultadoTriagem: string | null;
  }>;
  recipientes: Array<{
    id: string;
    identificador: string;
    quantidadeDeclarada: number | null;
    quantidadeRecebida: number | null;
  }>;
  historicos: Array<{ id: string; texto: string; origem: string }>;
  linhaDoTempo: EventoTimeline[];
}

export interface StatusIa {
  disponivel: boolean;
  provedor: string;
}

// --- M01: dados mestres consumidos pelos formulários ------------------------

export interface Servico {
  id: string;
  nome: string;
  codigo: string;
  modalidade: string;
  /**
   * As flags decidem por quais etapas o caso passa (M07). O formulário as usa
   * para dizer ao usuário o que vem depois do cadastro.
   */
  exigeTriagem: boolean;
  exigeMacroscopia: boolean;
  exigeProcessamento: boolean;
  exigeMicroscopia: boolean;
  prazoDiasUteis: number | null;
}

export interface ClienteResumo {
  id: string;
  nomeFantasia: string;
  codigo: string | null;
  tipo: string;
}

export interface VeterinarioResumo {
  id: string;
  nome: string;
  crmv: string | null;
  crmvUf: string | null;
}

/** Termo de tabela mestre: espécie, órgão, fixador, recipiente, coloração. */
export interface Termo {
  id: string;
  valor: string;
  codigo: string | null;
  ordem: number | null;
}

export interface CasoCriado {
  id: string;
  identificador: string;
}

// --- M09: processamento terceirizado ----------------------------------------

export interface LaboratorioApoio {
  id: string;
  nome: string;
  codigo: string | null;
}

export interface CassetePendente {
  id: string;
  identificador: string;
  tecidoOrigem: string;
  exigeDescalcificacao: boolean;
  casoId: string;
  caso: string;
  paciente: string;
}

export interface LoteResumo {
  id: string;
  identificador: string;
  dataEnvio: string;
  status: string;
  enviadoEm: string | null;
  recebidoParceiroEm: string | null;
  totalCassetes: number;
  divergencias: number;
}

export interface LoteDetalhe {
  id: string;
  identificador: string;
  dataEnvio: string;
  status: string;
  enviadoEm: string | null;
  recebidoParceiroEm: string | null;
  cassetes: Array<{
    id: string;
    identificador: string;
    tecidoOrigem: string;
    exigeDescalcificacao: boolean;
    statusTecnico: string;
    confirmadoRecebimento: boolean | null;
    caso: string;
  }>;
  divergencias: Array<{
    id: string;
    tipo: string;
    casseteId: string | null;
    codigoInformado: string | null;
    descricao: string;
    resolvidaEm: string | null;
  }>;
  laminas: Array<{
    id: string;
    identificador: string;
    coloracaoSigla: string;
    nivel: number;
    casseteId: string;
  }>;
}

// --- M08: ficha de macroscopia ----------------------------------------------

/**
 * Numéricos chegam como string: `numeric` do Postgres preserva a escala, e
 * converter para `number` no caminho perderia o "2.50" que o profissional
 * mediu. O front trata como texto até precisar comparar.
 */
export interface FichaMacroscopia {
  id: string;
  casoId: string;
  amostraId: string;
  descricaoTexto: string | null;
  comprimentoCm: string | null;
  larguraCm: string | null;
  alturaCm: string | null;
  pesoG: string | null;
  materialTotalmenteIncluido: boolean;
  iniciadaEm: string | null;
  concluidaEm: string | null;
  lesoes: Array<{
    rotulo: string;
    tipo: string | null;
    localizacao: string | null;
    lateralidade: string;
    maiorEixoCm: string | null;
    menorEixoCm: string | null;
  }>;
  margens: Array<{
    nome: string;
    metodoAmostragem: string | null;
    distanciaCm: string | null;
    naoAvaliavel: boolean;
  }>;
  cassetes: Array<{
    id: string;
    identificador: string;
    tecidoOrigem: string;
    descricao: string | null;
    exigeDescalcificacao: boolean;
  }>;
}
