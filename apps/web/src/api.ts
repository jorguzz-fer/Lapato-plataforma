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
    /** M03 secao 20: cadastros candidatos quando o 409 e de duplicidade. */
    readonly duplicidades?: DuplicidadeCadastral[],
  ) {
    super(detalhe || titulo);
    this.name = 'ErroApi';
  }

  get bloqueadoPeloGuardian(): boolean {
    return this.status === 409 && Array.isArray(this.achados);
  }

  get possivelDuplicidade(): boolean {
    return this.status === 409 && Array.isArray(this.duplicidades);
  }
}

/** Candidato devolvido pela deteccao de duplicidade (M03 secao 20). */
export interface DuplicidadeCadastral {
  id: string;
  nomeFantasia?: string;
  nome?: string;
  documento?: string | null;
  codigo?: string;
  crmv?: string | null;
  crmvUf?: string | null;
  status: string;
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
  /**
   * `FormData` vai cru: o navegador precisa definir o `content-type` com o
   * boundary do multipart. Serializar como JSON, ou fixar o cabeçalho aqui,
   * quebraria o upload de imagem (M16).
   */
  const ehFormulario = corpo instanceof FormData;

  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    credentials: 'include',
    headers: corpo === undefined || ehFormulario ? {} : { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : ehFormulario ? corpo : JSON.stringify(corpo),
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
      dados?.duplicidades,
    );
  }

  return dados as T;
}

export const api = {
  get: <T>(caminho: string) => requisitar<T>('GET', caminho),
  post: <T>(caminho: string, corpo?: unknown) => requisitar<T>('POST', caminho, corpo),
  /** Envio de arquivo (M16): multipart, com o boundary definido pelo navegador. */
  postForm: <T>(caminho: string, corpo: FormData) => requisitar<T>('POST', caminho, corpo),
};

/**
 * URL absoluta de um recurso servido pela API, para uso direto em `<img src>`.
 *
 * A galeria do M16 não baixa os bytes por `fetch`: deixa o navegador buscá-los,
 * com cache e carregamento preguiçoso. Como o cookie é `credentials: include`
 * por padrão em imagens de mesma origem, a sessão viaja normalmente.
 */
export function urlArquivo(caminho: string): string {
  return `${BASE}${caminho}`;
}

/**
 * Baixa um arquivo binário (o PDF do laudo) - `requisitar` assume corpo JSON e
 * não serve aqui.
 */
export async function baixarArquivo(caminho: string): Promise<Blob> {
  const resposta = await fetch(`${BASE}${caminho}`, { credentials: 'include' });

  if (!resposta.ok) {
    const texto = await resposta.text();
    const dados = texto ? JSON.parse(texto) : null;
    throw new ErroApi(
      resposta.status,
      dados?.title ?? 'Erro',
      dados?.detail ?? 'Não foi possível baixar o arquivo.',
    );
  }

  return resposta.blob();
}

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
  /** A modalidade decide a forma da bancada de laudo (M12: interface adaptativa). */
  servico: { nome: string; modalidade: string };
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

// --- M11/M13: laudo ----------------------------------------------------------

export interface DiagnosticoLaudo {
  amostraId: string | null;
  hierarquia: string;
  processo: string | null;
  entidade: string | null;
  comportamento: string | null;
  distribuicao: string | null;
  severidade: string | null;
  lateralidade: string;
  textoExibido: string;
  classificacaoNome: string | null;
  classificacaoVersao: string | null;
  grau: string | null;
  criteriosGraduacao: Record<string, unknown> | null;
  provisorio: boolean;
}

export interface MargemLaudo {
  nome: string;
  resultado: string;
  distanciaMm: string | null;
  observacoes: string | null;
}

export interface LaudoDoCaso {
  laudoId: string;
  status: string;
  patologistaId: string | null;
  liberadoEm: string | null;
  versaoCorrente: {
    id: string;
    versao: number;
    tipo: string;
    motivo: string | null;
    descricaoMicroscopica: string | null;
    comentarios: string | null;
    conclusao: string | null;
    /** `null` também quando o perfil não tem `laudo:ver_nota_interna`. */
    notaInterna: string | null;
    assinadaEm: string | null;
    assinaturaIdentificacao: string | null;
    codigoValidacao: string | null;
  };
  diagnosticos: DiagnosticoLaudo[];
  margens: MargemLaudo[];
  revisoes: Array<{
    resultado: string;
    comentarios: string | null;
    discordancia: boolean;
    concluidaEm: string | null;
  }>;
  versoes: Array<{
    versao: number;
    tipo: string;
    motivo: string | null;
    assinadaEm: string | null;
    substituida: boolean;
  }>;
}

// --- M16: imagens do caso ---------------------------------------------------

export interface ImagemDoCaso {
  id: string;
  identificador: string;
  tipo: string;
  /** M16 §83: o que veio de fora aparece marcado, e não se confunde com o interno. */
  origem: string;
  moduloContexto: string;
  objetoTipo: string | null;
  objetoId: string | null;
  legenda: string | null;
  descricao: string | null;
  metadados: Record<string, unknown>;
  capturadaEm: string | null;
  enviadaEm: string;
  autor: string | null;
  incluidaNoLaudo: boolean;
  ordemNoLaudo: number | null;
  autorizadaEnsino: boolean;
  inativadaEm: string | null;
  motivoInativacao: string | null;
  temMiniatura: boolean;
}

// --- M12: avaliação citológica ----------------------------------------------

/**
 * M12: a avaliação é por AMOSTRA, não por laudo — três massas aspiradas no
 * mesmo caso podem ter três adequações e três conclusões diferentes (§115).
 */
export interface AvaliacaoCitologica {
  amostraId: string;
  tipoColeta: string | null;
  sitio: string | null;
  numeroLaminas: number | null;
  coloracoes: string[];
  adequacao: string | null;
  motivosLimitacao: string[];
  celularidade: string | null;
  preservacao: string | null;
  fundo: string[];
  hemorragia: string | null;
  achadosHemorragia: string[];
  necrose: string | null;
  materialExtracelular: string[];
  populacoes: Array<Record<string, unknown>>;
  criteriosMalignidade: Record<string, string>;
  mitoses: string | null;
  inflamacao: Record<string, unknown> | null;
  agentes: Array<Record<string, unknown>>;
  descricaoCitologica: string | null;
  interpretacao: string | null;
  grauCerteza: string | null;
  limitacoes: string[];
  recomendacoes: string | null;
}

export interface CitologiaDaVersao {
  versaoId: string;
  assinada: boolean;
  amostras: Array<{
    id: string;
    identificador: string;
    letra: string;
    descricao: string | null;
    regiaoAnatomica: string | null;
    lateralidade: string;
    metodoColeta: string | null;
  }>;
  avaliacoes: AvaliacaoCitologica[];
}

/** Vocabulário estruturado do M12, servido pela API (§3). */
export interface VocabularioCitologia {
  tiposColeta: ReadonlyArray<{ chave: string; rotulo: string; grupo: string }>;
  adequacao: readonly string[];
  motivosLimitacao: readonly string[];
  celularidade: readonly string[];
  preservacao: readonly string[];
  fundo: readonly string[];
  intensidade: readonly string[];
  materialExtracelular: readonly string[];
  populacoes: readonly string[];
  criteriosMalignidade: readonly string[];
  mitoses: readonly string[];
  tiposInflamacao: readonly string[];
  gruposAgente: readonly string[];
  localizacoesAgente: readonly string[];
  significanciasAgente: readonly string[];
  grauCerteza: readonly string[];
  limitacoes: readonly string[];
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

// --- M02: gestão de usuários --------------------------------------------------

export interface UsuarioLista {
  id: string;
  nomeCompleto: string;
  email: string;
  status: string;
  categoria: string;
  mfaAtivo: boolean;
  senhaTrocaObrigatoria: boolean;
  ultimoAcessoEm: string | null;
  unidadePrincipal: string | null;
  /** Nomes dos perfis, separados por " · ". */
  perfis: string;
}

export interface PerfilResumo {
  id: string;
  chave: string;
  nome: string;
  exigeSupervisao: boolean;
}

// --- M01: administração e configurações --------------------------------------

export interface ServicoAdmin {
  id: string;
  nome: string;
  codigo: string;
  categoria: string;
  modalidade: string;
  descricao: string | null;
  exigeTriagem: boolean;
  exigeMacroscopia: boolean;
  exigeProcessamento: boolean;
  exigeMicroscopia: boolean;
  geraLaudo: boolean;
  permiteComplementares: boolean;
  prazoDiasUteis: number;
  prazoUrgenteDiasUteis: number | null;
  inativadoEm: string | null;
}

export interface TabelaAdmin {
  id: string;
  chave: string;
  nome: string;
  sistema: boolean;
  totalTermos: number;
}

export interface TermoAdmin {
  id: string;
  valor: string;
  codigo: string;
  abreviacao: string | null;
  sinonimos: string[];
  ordem: number;
  inativadoEm: string | null;
}

export interface UnidadeAdmin {
  id: string;
  nome: string;
  codigo: string;
  sigla: string | null;
  tipo: string;
  responsavel: string | null;
  inativadoEm: string | null;
  setores: Array<{
    id: string;
    nome: string;
    codigo: string;
    tipo: string;
    inativadoEm: string | null;
  }>;
}

export interface DiaNaoUtil {
  id: string;
  data: string;
  descricao: string;
  tipo: string;
  unidadeId: string | null;
}

// --- M03: cadastro de clientes e veterinários --------------------------------

export interface ClienteLista {
  id: string;
  nomeFantasia: string;
  razaoSocial: string | null;
  documento: string | null;
  tipo: string;
  status: string;
  codigo: string;
  criadoEm: string;
  inativadoEm: string | null;
  totalCasos: number;
}

export interface VinculoDoCliente {
  id: string;
  veterinarioId: string;
  nome: string;
  crmv: string | null;
  crmvUf: string | null;
  cargo: string | null;
  principal: boolean;
  inicioEm: string | null;
  terminoEm: string | null;
}

export interface ClienteFicha extends Omit<ClienteLista, 'totalCasos'> {
  nomeAbreviado: string | null;
  observacoes: string | null;
  vinculos: VinculoDoCliente[];
  casos: Array<{ id: string; identificador: string; paciente: string | null; criadoEm: string }>;
}

export interface VeterinarioLista {
  id: string;
  nome: string;
  crmv: string | null;
  crmvUf: string | null;
  email: string | null;
  telefone: string | null;
  especialidade: string | null;
  status: string;
  inativadoEm: string | null;
  /** Nomes dos clientes com vínculo vigente, separados por " · ". */
  vinculos: string;
}

// --- M10: solicitações e pendências ------------------------------------------

export interface SolicitacaoResumo {
  id: string;
  identificador: string;
  tipo: string;
  descricao: string;
  justificativa: string | null;
  prioridade: string;
  status: string;
  exigeAprovacao: boolean;
  motivoRecusa: string | null;
  resultadoTecnico: string | null;
  setorResponsavel: string | null;
  prazoEm: string | null;
  criadaEm: string;
  concluidaEm: string | null;
  casoId: string | null;
  caso: string | null;
  paciente: string | null;
  solicitante: string | null;
  responsavel: string | null;
}

export interface PendenciaResumo {
  id: string;
  tipo: string;
  descricao: string;
  status: string;
  nivelBloqueio: string;
  etapaBloqueada: string | null;
  suspendePrazo: boolean;
  setorResponsavel: string | null;
  visivelPortal: boolean;
  criadaEm: string;
  casoId: string;
  caso: string;
  paciente: string | null;
}

export interface MensagemSolicitacao {
  id: string;
  texto: string;
  externa: boolean;
  autor: string | null;
  criadaEm: string;
}

// --- M11: validação pública do laudo pelo QR Code do PDF --------------------

/**
 * Resposta deliberadamente pobre (M11 seção 88) - nada de dado clínico,
 * diagnóstico ou paciente. Só o que autentica o documento perante terceiros.
 */
export interface LaudoValidado {
  instituicao: string;
  caso: string;
  versao: number;
  tipo: string;
  assinadoPor: string | null;
  assinadoEm: string;
  vigente: boolean;
}
