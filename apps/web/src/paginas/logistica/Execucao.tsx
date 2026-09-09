import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import MyLocationOutlined from '@mui/icons-material/MyLocationOutlined';
import NavigationOutlined from '@mui/icons-material/NavigationOutlined';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import {
  CONDICAO_MATERIAL_LOGISTICA,
  CONDICAO_MATERIAL_LOGISTICA_LABEL,
  FOTOS_MAXIMAS_POR_MARCO,
  MOTIVO_CONTATO_SEM_SUCESSO,
  MOTIVO_CONTATO_SEM_SUCESSO_LABEL,
  MOTIVO_GEO_AUSENTE_LABEL,
  MOTIVO_NAO_REALIZACAO,
  MOTIVO_NAO_REALIZACAO_LABEL,
  ORIGENS_DO_MARCO,
  REQUISITO_ESPECIAL_LOGISTICO_LABEL,
  STATUS_SOLICITACAO_LOGISTICA_LABEL,
  TIPO_OCORRENCIA_LOGISTICA,
  TIPO_OCORRENCIA_LOGISTICA_LABEL,
  TIPO_OPERACAO_LOGISTICA_LABEL,
  TIPO_SERVICO_LOGISTICO_LABEL,
  marcosDoServico,
  type CondicaoMaterialLogistica,
  type MarcoOperacional,
} from '@lapato/shared';
import { api, ErroApi, urlArquivo } from '../../api';
import {
  capturarPosicao,
  gerarMiniatura,
  janela,
  reais,
  MONO,
  type Evidencia,
  type FichaSolicitacao,
  type PosicaoCapturada,
} from './comum';

/**
 * A pagina operacional do encarregado (M19 secoes 45, 46, 149 e 150).
 *
 * Feita para o celular na mao: um marco por vez, o proximo botao grande, e o
 * que o marco exige (foto, posicao, volumes) pedido na hora, nao antes. O
 * encarregado nao ve dado clinico - a ficha aqui e endereco, contato, janela,
 * material e valor (secao 115).
 */
export function Execucao({
  solicitacaoId,
  aoFechar,
  aoMudar,
}: {
  solicitacaoId: string | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const tema = useTheme();
  const celular = useMediaQuery(tema.breakpoints.down('sm'));
  const [ficha, setFicha] = useState<FichaSolicitacao | null>(null);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [passo, setPasso] = useState<MarcoOperacional | null>(null);
  const [extra, setExtra] = useState<'contato' | 'ocorrencia' | 'nao_realizada' | null>(null);

  const carregar = useCallback(() => {
    if (!solicitacaoId) return;
    api
      .get<FichaSolicitacao>(`/logistica/solicitacoes/${solicitacaoId}`)
      .then(setFicha)
      .catch((e) => setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível carregar.'));
    api
      .get<Evidencia[]>(`/logistica/solicitacoes/${solicitacaoId}/evidencias`)
      .then(setEvidencias)
      .catch(() => setEvidencias([]));
  }, [solicitacaoId]);

  useEffect(() => {
    setFicha(null);
    setPasso(null);
    setExtra(null);
    setErro(null);
    setAviso([]);
    carregar();
  }, [carregar]);

  if (!solicitacaoId) return null;

  const marcos = ficha ? marcosDoServico(ficha.tipoServico) : [];
  /**
   * Um marco e alcancavel quando ainda nao foi feito, a origem inclui o status
   * atual e nenhum marco obrigatorio ficou para tras. A chegada e opcional, entao
   * "Material retirado" fica clicavel ao lado de "Cheguei ao local".
   */
  const alcancavel = (m: MarcoOperacional): boolean =>
    Boolean(ficha) &&
    !marcoFeito(ficha!, m) &&
    ORIGENS_DO_MARCO[m.status].includes(ficha!.status) &&
    ehOProximo(ficha!.status, m, marcos);
  const proximo = marcos.find(alcancavel) ?? null;
  const encerrada = ficha && ['concluida', 'cancelada', 'nao_realizada'].includes(ficha.status);

  async function executarSimples(m: MarcoOperacional) {
    if (!ficha) return;
    setOcupado(true);
    setErro(null);
    try {
      const rota =
        m.status === 'em_deslocamento'
          ? 'deslocamento'
          : m.status === 'em_transporte'
            ? 'transporte'
            : m.status === 'concluida'
              ? 'conclusao'
              : null;
      if (!rota) return;
      await api.post(`/logistica/solicitacoes/${ficha.id}/${rota}`, {});
      aoMudar();
      carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível registrar.');
    } finally {
      setOcupado(false);
    }
  }

  async function registrarChegada() {
    if (!ficha) return;
    setOcupado(true);
    setErro(null);
    try {
      const posicao = await capturarPosicao();
      await api.post(`/logistica/solicitacoes/${ficha.id}/chegada`, posicao);
      aoMudar();
      carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível registrar a chegada.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open fullScreen={celular} fullWidth maxWidth="sm" onClose={aoFechar}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ ...MONO, fontSize: 13, color: 'text.secondary' }}>
            {ficha?.identificador ?? '…'}
          </Typography>
          <Typography sx={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>
            {ficha ? `${TIPO_SERVICO_LOGISTICO_LABEL[ficha.tipoServico]} · ${ficha.cliente}` : 'Carregando'}
          </Typography>
        </Box>
        <IconButton onClick={aoFechar} aria-label="Fechar">
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
            {erro}
          </Alert>
        )}
        {aviso.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setAviso([])}>
            {aviso.map((a) => (
              <div key={a}>{a}</div>
            ))}
          </Alert>
        )}

        {ficha && (
          <>
            {/* Secao 149: a pagina operacional simplificada. */}
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip size="small" color="primary" label={STATUS_SOLICITACAO_LOGISTICA_LABEL[ficha.status]} />
                <Chip size="small" variant="outlined" label={TIPO_OPERACAO_LOGISTICA_LABEL[ficha.tipoOperacao]} />
                {ficha.prioridade === 'urgente' && <Chip size="small" color="error" label="Urgente" />}
                {ficha.requisitosEspeciais.map((r) => (
                  <Chip key={r} size="small" color="warning" variant="outlined" label={REQUISITO_ESPECIAL_LOGISTICO_LABEL[r]} />
                ))}
              </Stack>
              <Typography sx={{ fontSize: 15, mt: 1 }}>{ficha.endereco}</Typography>
              {ficha.pontoReferencia && (
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{ficha.pontoReferencia}</Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<NavigationOutlined />}
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ficha.endereco)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Navegar
                </Button>
                {ficha.telefoneContato && (
                  <Button size="small" variant="outlined" startIcon={<PhoneOutlined />} href={`tel:${ficha.telefoneContato}`}>
                    {ficha.contatoNoLocal ?? 'Ligar'}
                  </Button>
                )}
              </Stack>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 1 }}>
                {[
                  janela(ficha) ? `Janela ${janela(ficha)}` : null,
                  ficha.tipoMaterial,
                  ficha.volumesEstimados != null ? `${ficha.volumesEstimados} volume(s) estimado(s)` : null,
                  ficha.valorCentavos != null ? `Valor do serviço ${reais(ficha.valorCentavos)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
              {ficha.observacoes && (
                <Typography sx={{ fontSize: 13, mt: 0.5 }}>{ficha.observacoes}</Typography>
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />

            {/* Secao 150: os botoes, na ordem; o proximo em destaque. */}
            {encerrada ? (
              <Alert severity={ficha.status === 'concluida' ? 'success' : 'info'}>
                Serviço {STATUS_SOLICITACAO_LOGISTICA_LABEL[ficha.status].toLowerCase()}.
              </Alert>
            ) : !ficha.encarregadoId ? (
              <Alert severity="info">Este serviço ainda não tem encarregado. Aceite a oferta na sua caixa.</Alert>
            ) : (
              <Stack spacing={1}>
                {marcos.map((m) => {
                  const feito = marcoFeito(ficha, m);
                  const podeClicar = alcancavel(m);
                  const ehProximo = proximo?.status === m.status;
                  return (
                    <Button
                      key={m.status}
                      fullWidth
                      size="large"
                      disabled={ocupado || (!podeClicar && !feito)}
                      variant={ehProximo ? 'contained' : 'outlined'}
                      color={feito ? 'success' : 'primary'}
                      sx={{ justifyContent: 'flex-start', py: 1.5, textTransform: 'none', fontSize: 16 }}
                      onClick={() => {
                        if (!podeClicar) return;
                        if (m.exigeEvidencia) setPasso(m);
                        else if (m.status === 'no_local') void registrarChegada();
                        else void executarSimples(m);
                      }}
                    >
                      {feito ? '✓ ' : ''}
                      {m.rotulo}
                    </Button>
                  );
                })}

                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                  <Button size="small" onClick={() => setExtra('contato')}>
                    Não consegui contato
                  </Button>
                  <Button size="small" onClick={() => setExtra('ocorrencia')}>
                    Ocorrência
                  </Button>
                  <Button size="small" color="error" onClick={() => setExtra('nao_realizada')}>
                    Não realizada
                  </Button>
                </Stack>
              </Stack>
            )}

            {evidencias.length > 0 && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Fotografias</Typography>
                <Galeria solicitacaoId={ficha.id} evidencias={evidencias} />
              </>
            )}
          </>
        )}
      </DialogContent>

      {ficha && passo && (
        <DialogoMarco
          ficha={ficha}
          marco={passo}
          evidencias={evidencias}
          aoFechar={() => setPasso(null)}
          aoAnexar={carregar}
          aoConcluir={(alertas) => {
            setPasso(null);
            setAviso(alertas);
            aoMudar();
            carregar();
          }}
        />
      )}
      {ficha && extra && (
        <DialogoExtra
          ficha={ficha}
          tipo={extra}
          aoFechar={() => setExtra(null)}
          aoConcluir={() => {
            setExtra(null);
            aoMudar();
            carregar();
          }}
        />
      )}
    </Dialog>
  );
}

/** Um marco esta feito quando o status atual ja passou por ele. */
function marcoFeito(ficha: FichaSolicitacao, m: MarcoOperacional): boolean {
  switch (m.status) {
    case 'em_deslocamento':
      return Boolean(ficha.deslocamentoEm);
    case 'no_local':
      return Boolean(ficha.chegadaEm);
    case 'coletada':
      return Boolean(ficha.retiradaEm);
    case 'em_transporte':
      return Boolean(ficha.transporteEm);
    case 'entregue':
      return Boolean(ficha.entregueEm);
    case 'concluida':
      return Boolean(ficha.concluidaEm);
  }
}

/**
 * O proximo marco e o primeiro ainda nao feito cuja origem inclui o status
 * atual. A chegada e opcional na retirada, entao "material retirado" tambem
 * e alcancavel de `em_deslocamento`; o primeiro da lista vence, e o
 * encarregado pode pular clicando no seguinte.
 */
function ehOProximo(status: string, m: MarcoOperacional, marcos: MarcoOperacional[]): boolean {
  const idx = marcos.findIndex((x) => x.status === m.status);
  return marcos.slice(0, idx).every((anterior) => !ORIGENS_DO_MARCO[anterior.status].includes(status as never) || anterior.status === 'no_local');
}

function Galeria({ solicitacaoId, evidencias }: { solicitacaoId: string; evidencias: Evidencia[] }) {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      {evidencias.map((e) => (
        <Box key={e.id} sx={{ width: 96 }}>
          <img
            src={urlArquivo(`/logistica/solicitacoes/${solicitacaoId}/evidencias/${e.id}/arquivo?tamanho=miniatura`)}
            alt={e.legenda ?? e.identificador}
            loading="lazy"
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6, display: 'block' }}
          />
          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{e.metadados?.marco ?? ''}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

/**
 * O marco com evidencia (secoes 151 a 155): fotos, posicao, e o que o marco
 * pergunta - volumes e quem entregou na retirada; quem recebeu na entrega.
 */
function DialogoMarco({
  ficha,
  marco,
  evidencias,
  aoFechar,
  aoAnexar,
  aoConcluir,
}: {
  ficha: FichaSolicitacao;
  marco: MarcoOperacional;
  evidencias: Evidencia[];
  aoFechar: () => void;
  aoAnexar: () => void;
  aoConcluir: (alertas: string[]) => void;
}) {
  const ehRetirada = marco.status === 'coletada';
  const chaveMarco = ehRetirada ? 'retirada' : 'entrega';
  const fotos = evidencias.filter((e) => e.metadados?.marco === chaveMarco);
  const entrada = useRef<HTMLInputElement | null>(null);
  const [posicao, setPosicao] = useState<PosicaoCapturada | null>(null);
  const [buscandoPosicao, setBuscandoPosicao] = useState(false);
  const [volumes, setVolumes] = useState(
    String(ehRetirada ? (ficha.volumesEstimados ?? 1) : (ficha.volumesRecebidos ?? 1)),
  );
  const [justificativa, setJustificativa] = useState('');
  const [condicao, setCondicao] = useState<CondicaoMaterialLogistica[]>([]);
  const [pessoa, setPessoa] = useState('');
  const [funcao, setFuncao] = useState('');
  const [documento, setDocumento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const divergente =
    ehRetirada && ficha.volumesEstimados != null && Number(volumes) !== ficha.volumesEstimados;
  const entregaAoCliente = !ehRetirada && ficha.tipoServico === 'entrega';

  async function enviarFotos(lista: FileList | null) {
    if (!lista) return;
    setOcupado(true);
    setErro(null);
    try {
      for (const arquivo of Array.from(lista)) {
        const corpo = new FormData();
        corpo.append('marco', chaveMarco);
        corpo.append('arquivo', arquivo);
        const mini = await gerarMiniatura(arquivo);
        if (mini) corpo.append('miniatura', mini, 'miniatura.jpg');
        await api.postForm(`/logistica/solicitacoes/${ficha.id}/evidencias`, corpo);
      }
      aoAnexar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível enviar a foto.');
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function pedirPosicao() {
    setBuscandoPosicao(true);
    setPosicao(await capturarPosicao());
    setBuscandoPosicao(false);
  }

  async function confirmar() {
    setOcupado(true);
    setErro(null);
    try {
      const geo = posicao ?? (await capturarPosicao());
      setPosicao(geo);
      const caminho = `/logistica/solicitacoes/${ficha.id}/${ehRetirada ? 'retirada' : 'entrega'}`;
      const corpo = ehRetirada
        ? {
            ...geo,
            volumesRecebidos: Number(volumes),
            justificativaVolumes: justificativa || null,
            condicaoMaterial: condicao,
            observacao: observacao || null,
            quemEntregou: pessoa ? { nome: pessoa, funcao: funcao || null } : null,
          }
        : {
            ...geo,
            volumesEntregues: volumes === '' ? null : Number(volumes),
            recebedor: pessoa ? { nome: pessoa, documento: documento || null, observacao: observacao || null } : null,
            observacao: observacao || null,
          };
      const r = await api.post<{ divergente: boolean; alertas: string[] }>(caminho, corpo);
      aoConcluir(r.alertas ?? []);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível registrar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={aoFechar}>
      <DialogTitle>{marco.rotulo}</DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {erro}
          </Alert>
        )}

        {/* Secao 151: a camera primeiro. */}
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>
          Fotografias ({fotos.length}/{FOTOS_MAXIMAS_POR_MARCO})
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
          Ao menos uma: frasco, caixa, requisição ou a condição do material.
        </Typography>
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => void enviarFotos(e.target.files)}
        />
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          {fotos.map((f) => (
            <img
              key={f.id}
              src={urlArquivo(`/logistica/solicitacoes/${ficha.id}/evidencias/${f.id}/arquivo?tamanho=miniatura`)}
              alt=""
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }}
            />
          ))}
          <Button
            variant={fotos.length === 0 ? 'contained' : 'outlined'}
            startIcon={<PhotoCameraOutlined />}
            disabled={ocupado || fotos.length >= FOTOS_MAXIMAS_POR_MARCO}
            onClick={() => entrada.current?.click()}
          >
            {fotos.length === 0 ? 'Tirar foto' : 'Mais uma'}
          </Button>
        </Stack>

        {/* Secao 153: posicao, ou o motivo de nao ter. */}
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>Posição</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MyLocationOutlined />}
            disabled={buscandoPosicao}
            onClick={() => void pedirPosicao()}
          >
            {buscandoPosicao ? 'Localizando…' : posicao ? 'Atualizar' : 'Registrar posição'}
          </Button>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {posicao
              ? posicao.latitude != null
                ? `${posicao.latitude.toFixed(5)}, ${posicao.longitude!.toFixed(5)}${posicao.precisaoMetros ? ` (±${Math.round(posicao.precisaoMetros)} m)` : ''}`
                : `Sem posição: ${MOTIVO_GEO_AUSENTE_LABEL[posicao.geoAusente!]}`
              : 'Será pedida ao confirmar, se não registrar antes.'}
          </Typography>
        </Stack>

        <Stack spacing={1.5}>
          <TextField
            size="small"
            type="number"
            label={ehRetirada ? 'Volumes recebidos' : 'Volumes entregues'}
            value={volumes}
            onChange={(e) => setVolumes(e.target.value)}
            helperText={
              ehRetirada && ficha.volumesEstimados != null
                ? `Estimado na solicitação: ${ficha.volumesEstimados}`
                : !ehRetirada && ficha.volumesRecebidos != null
                  ? `Coletados: ${ficha.volumesRecebidos}`
                  : undefined
            }
            slotProps={{ htmlInput: { min: 0 } }}
          />
          {divergente && (
            <TextField
              size="small"
              label="Por que a quantidade difere?"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
            />
          )}
          {ehRetirada && (
            <Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
                Condição da embalagem (o que você vê, sem avaliar o material)
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                {CONDICAO_MATERIAL_LOGISTICA.map((c) => (
                  <Chip
                    key={c}
                    size="small"
                    label={CONDICAO_MATERIAL_LOGISTICA_LABEL[c]}
                    color={condicao.includes(c) ? 'warning' : 'default'}
                    variant={condicao.includes(c) ? 'filled' : 'outlined'}
                    onClick={() =>
                      setCondicao((atual) => (atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c]))
                    }
                  />
                ))}
              </Stack>
            </Box>
          )}
          <TextField
            size="small"
            label={ehRetirada ? 'Quem entregou o material' : entregaAoCliente ? 'Quem recebeu (obrigatório)' : 'Quem recebeu no laboratório'}
            value={pessoa}
            onChange={(e) => setPessoa(e.target.value)}
            required={entregaAoCliente}
          />
          {ehRetirada ? (
            <TextField size="small" label="Função ou cargo" value={funcao} onChange={(e) => setFuncao(e.target.value)} />
          ) : (
            entregaAoCliente && (
              <TextField size="small" label="Documento ou identificador" value={documento} onChange={(e) => setDocumento(e.target.value)} />
            )
          )}
          <TextField size="small" label="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} multiline />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Voltar</Button>
        <Button
          variant="contained"
          disabled={ocupado || fotos.length === 0 || (entregaAoCliente && !pessoa.trim())}
          onClick={() => void confirmar()}
        >
          Confirmar {marco.rotulo.toLowerCase()}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Tentativa de contato (secao 52), ocorrencia (secao 73) e nao realizada (secao 83). */
function DialogoExtra({
  ficha,
  tipo,
  aoFechar,
  aoConcluir,
}: {
  ficha: FichaSolicitacao;
  tipo: 'contato' | 'ocorrencia' | 'nao_realizada';
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [medidas, setMedidas] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const titulo =
    tipo === 'contato' ? 'Não consegui contato' : tipo === 'ocorrencia' ? 'Registrar ocorrência' : 'Serviço não realizado';

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      if (tipo === 'contato') {
        await api.post(`/logistica/solicitacoes/${ficha.id}/tentativa-contato`, { motivo, detalhe: texto || null });
      } else if (tipo === 'ocorrencia') {
        await api.post(`/logistica/solicitacoes/${ficha.id}/ocorrencia`, { tipo: motivo, descricao: texto, medidas: medidas || null });
      } else {
        await api.post(`/logistica/solicitacoes/${ficha.id}/nao-realizacao`, { motivo, detalhe: texto || null });
      }
      aoConcluir();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível registrar.');
    } finally {
      setOcupado(false);
    }
  }

  const opcoes: Array<[string, string]> =
    tipo === 'contato'
      ? MOTIVO_CONTATO_SEM_SUCESSO.map((m) => [m, MOTIVO_CONTATO_SEM_SUCESSO_LABEL[m]])
      : tipo === 'ocorrencia'
        ? TIPO_OCORRENCIA_LOGISTICA.map((m) => [m, TIPO_OCORRENCIA_LOGISTICA_LABEL[m]])
        : MOTIVO_NAO_REALIZACAO.map((m) => [m, MOTIVO_NAO_REALIZACAO_LABEL[m]]);

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={aoFechar}>
      <DialogTitle>{titulo}</DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {erro}
          </Alert>
        )}
        <Stack spacing={1.5}>
          <TextField select size="small" label={tipo === 'ocorrencia' ? 'Tipo' : 'Motivo'} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {opcoes.map(([v, r]) => (
              <MenuItem key={v} value={v}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={tipo === 'ocorrencia' ? 'O que aconteceu' : 'Detalhe'}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            multiline
            required={tipo === 'ocorrencia'}
          />
          {tipo === 'ocorrencia' && (
            <TextField size="small" label="Medidas adotadas" value={medidas} onChange={(e) => setMedidas(e.target.value)} multiline />
          )}
          {tipo === 'nao_realizada' && (
            <Alert severity="warning">A central poderá reagendar; esta tentativa fica no histórico.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Voltar</Button>
        <Button
          variant="contained"
          color={tipo === 'nao_realizada' ? 'error' : 'primary'}
          disabled={ocupado || !motivo || (tipo === 'ocorrencia' && !texto.trim())}
          onClick={() => void salvar()}
        >
          Registrar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
