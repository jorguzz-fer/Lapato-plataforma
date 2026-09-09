import type {
  CanalOrigemLogistico,
  CondicaoMaterialLogistica,
  ConservacaoLogistica,
  GeoMarco,
  MotivoGeoAusente,
  PessoaNoLocal,
  PrioridadeLogistica,
  Recebedor,
  RequisitoEspecialLogistico,
  StatusOferta,
  StatusRotaLogistica,
  StatusSolicitacaoLogistica,
  TipoOperacaoLogistica,
  TipoServicoLogistico,
} from '@lapato/shared';

/**
 * M19 - o que a tela sabe da API.
 *
 * Os tipos ficam aqui, e nao em `api.ts`, porque so a Logistica os usa - e
 * porque a tela do encarregado e a da central leem o MESMO objeto com olhos
 * diferentes (secao 115: o encarregado ve o que precisa para executar).
 */

export interface SolicitacaoResumo {
  id: string;
  identificador: string;
  tipoServico: TipoServicoLogistico;
  tipoOperacao: TipoOperacaoLogistica;
  canalOrigem: CanalOrigemLogistico;
  cliente: string;
  endereco: string;
  contatoNoLocal: string | null;
  telefoneContato: string | null;
  dataDesejada: string | null;
  janelaInicio: string | null;
  janelaFim: string | null;
  prioridade: PrioridadeLogistica;
  tipoMaterial: string | null;
  conservacao: ConservacaoLogistica | null;
  requisitosEspeciais: RequisitoEspecialLogistico[];
  volumesEstimados: number | null;
  valorCentavos: number | null;
  status: StatusSolicitacaoLogistica;
  encarregado: string | null;
  encarregadoId: string | null;
  criadaEm: string;
  ofertasAbertas: number;
  rotaId: string | null;
  ordemNaRota: number | null;
  retiradaEm: string | null;
  entregueEm: string | null;
  comOcorrencia: boolean;
  comDivergencia: boolean;
}

export interface Movimentacao {
  tipo: string;
  statusAnterior: StatusSolicitacaoLogistica | null;
  statusNovo: StatusSolicitacaoLogistica | null;
  descricao: string | null;
  detalhe: Record<string, unknown>;
  visivelPortal: boolean;
  ocorridoEm: string;
  responsavel: string | null;
}

export interface Oferta {
  id: string;
  encarregadoId: string;
  encarregado: string;
  status: StatusOferta;
  enviadaEm: string;
  expiraEm: string | null;
  respondidaEm: string | null;
  motivoRecusa: string | null;
}

export interface FichaSolicitacao extends Omit<SolicitacaoResumo, 'ofertasAbertas'> {
  clienteId: string;
  casoId: string | null;
  pontoReferencia: string | null;
  observacoes: string | null;
  aceitaEm: string | null;
  motivoCancelamento: string | null;
  statusExterno: string | null;
  deslocamentoEm: string | null;
  chegadaEm: string | null;
  transporteEm: string | null;
  concluidaEm: string | null;
  volumesRecebidos: number | null;
  justificativaVolumes: string | null;
  volumesEntregues: number | null;
  condicaoMaterial: CondicaoMaterialLogistica[] | null;
  observacaoRetirada: string | null;
  quemEntregou: PessoaNoLocal | null;
  recebedor: Recebedor | null;
  geoRetirada: GeoMarco | null;
  geoEntrega: GeoMarco | null;
  motivoNaoRealizacao: string | null;
  detalheNaoRealizacao: string | null;
  reagendamentoDeId: string | null;
  ofertas: Oferta[];
  timeline: Movimentacao[];
}

export interface Evidencia {
  id: string;
  identificador: string;
  legenda: string | null;
  metadados: { marco?: string };
  capturadaEm: string | null;
  enviadaEm: string;
  autor: string | null;
  temMiniatura: boolean;
}

export interface Encarregado {
  id: string;
  nome: string;
}

export interface RotaResumo {
  id: string;
  data: string;
  status: StatusRotaLogistica;
  veiculo: string | null;
  encarregadoId: string;
  encarregado: string;
  iniciadaEm: string | null;
  encerradaEm: string | null;
  paradas: number;
  concluidas: number;
}

export interface Parada {
  id: string;
  identificador: string;
  ordem: number | null;
  tipoServico: TipoServicoLogistico;
  tipoOperacao: TipoOperacaoLogistica;
  cliente: string;
  endereco: string;
  pontoReferencia: string | null;
  contatoNoLocal: string | null;
  telefoneContato: string | null;
  janelaInicio: string | null;
  janelaFim: string | null;
  prioridade: PrioridadeLogistica;
  tipoMaterial: string | null;
  requisitosEspeciais: RequisitoEspecialLogistico[];
  status: StatusSolicitacaoLogistica;
  comOcorrencia: boolean;
}

export interface FichaRota extends Omit<RotaResumo, 'paradas' | 'concluidas'> {
  observacoes: string | null;
  paradas: Parada[];
}

export interface PainelLogistica {
  hoje: number;
  aguardandoAceite: number;
  agendadas: number;
  emRota: number;
  coletadasNaoEntregues: number;
  entreguesNaoConcluidas: number;
  atrasadas: number;
  urgentes: number;
  naoRealizadas30d: number;
  comOcorrencia: number;
  comDivergencia: number;
  rotasEmAndamento: number;
  encarregadosEmAtividade: Array<{ encarregadoId: string; nome: string; servicos: number }>;
}

export interface ItemProducao {
  id: string;
  solicitacaoId: string;
  identificador: string;
  cliente: string;
  encarregadoId: string;
  encarregado: string;
  tipoServico: TipoServicoLogistico;
  concluidaEm: string;
  valorCentavos: number;
  situacao: string;
  referenciaFinanceira: string | null;
  pagaEm: string | null;
}

export interface RelatorioProducao {
  de: string;
  ate: string;
  totalCentavos: number;
  encarregados: Array<{
    encarregadoId: string;
    encarregado: string;
    retiradas: number;
    entregas: number;
    valorCentavos: number;
    pendenteCentavos: number;
    pagoCentavos: number;
  }>;
  itens: ItemProducao[];
}

/** O que a tela manda num marco critico (secao 153). */
export interface PosicaoCapturada {
  latitude?: number | null;
  longitude?: number | null;
  precisaoMetros?: number | null;
  geoAusente?: MotivoGeoAusente | null;
}

export const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function reais(centavos: number | null | undefined): string {
  if (centavos == null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function horaCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function janela(s: { janelaInicio: string | null; janelaFim: string | null }): string | null {
  if (!s.janelaInicio && !s.janelaFim) return null;
  return `${s.janelaInicio ?? '…'}–${s.janelaFim ?? '…'}`;
}

/** `AAAA-MM-DD` de hoje no fuso do navegador, para o filtro de rota. */
export function hojeIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

/**
 * Pede a posicao ao dispositivo (secao 153).
 *
 * Nunca inventa coordenada: sem permissao, sem hardware ou sem sinal, devolve o
 * MOTIVO, que e o que o servidor grava. O tempo limite curto e deliberado -
 * o encarregado esta com o pote na mao e nao vai esperar o GPS convergir.
 */
export function capturarPosicao(limiteMs = 8000): Promise<PosicaoCapturada> {
  return new Promise((resolver) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolver({ geoAusente: 'indisponivel' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolver({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precisaoMetros: p.coords.accuracy,
        }),
      (erro) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        resolver({
          geoAusente: erro.code === 1 ? 'sem_permissao' : erro.code === 2 ? 'indisponivel' : 'sem_sinal',
        });
      },
      { enableHighAccuracy: true, timeout: limiteMs, maximumAge: 30_000 },
    );
  });
}

/** Miniatura no navegador, como faz a galeria do M16: o servidor nao redimensiona. */
export async function gerarMiniatura(arquivo: File, lado = 400): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}
