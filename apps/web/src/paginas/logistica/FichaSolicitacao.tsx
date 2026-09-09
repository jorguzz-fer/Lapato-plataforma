import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  CANAL_ORIGEM_LOGISTICO_LABEL,
  CONDICAO_MATERIAL_LOGISTICA_LABEL,
  CONSERVACAO_LOGISTICA_LABEL,
  MOTIVO_GEO_AUSENTE_LABEL,
  PRIORIDADE_LOGISTICA_LABEL,
  REQUISITO_ESPECIAL_LOGISTICO_LABEL,
  STATUS_EXTERNO_LOGISTICO_LABEL,
  STATUS_LOGISTICO_ABERTO,
  STATUS_OFERTA_LABEL,
  STATUS_SOLICITACAO_LOGISTICA_LABEL,
  TIPO_OPERACAO_LOGISTICA_LABEL,
  TIPO_SERVICO_LOGISTICO_LABEL,
  type GeoMarco,
  type StatusExternoLogistico,
} from '@lapato/shared';
import { api, ErroApi, urlArquivo } from '../../api';
import {
  horaCurta,
  janela,
  reais,
  MONO,
  type Encarregado,
  type Evidencia,
  type FichaSolicitacao as Ficha,
} from './comum';

/**
 * A ficha da operacao vista pela central (M19 secoes 88, 133).
 *
 * Responde as perguntas da secao 133 sem sair da tela: quem pediu, quem vai
 * buscar, o material ja foi coletado, quantos volumes, chegou, por que nao.
 * As acoes da central ficam embaixo: ofertar, atribuir, cancelar, reagendar.
 */
export function FichaSolicitacao({
  solicitacaoId,
  permissoes,
  aoFechar,
  aoMudar,
  aoExecutar,
}: {
  solicitacaoId: string | null;
  permissoes: string[];
  aoFechar: () => void;
  aoMudar: () => void;
  aoExecutar?: (id: string) => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [encarregados, setEncarregados] = useState<Encarregado[]>([]);
  const [acao, setAcao] = useState<'ofertar' | 'atribuir' | 'cancelar' | 'reagendar' | null>(null);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [alvo, setAlvo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const podeOfertar = permissoes.includes('logistica:ofertar');
  const podeAtribuir = permissoes.includes('logistica:atribuir');
  const podeCancelar = permissoes.includes('logistica:cancelar');
  const podeSolicitar = permissoes.includes('logistica:solicitar');

  const carregar = useCallback(() => {
    if (!solicitacaoId) return;
    api
      .get<Ficha>(`/logistica/solicitacoes/${solicitacaoId}`)
      .then(setFicha)
      .catch((e) => setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível carregar.'));
    api
      .get<Evidencia[]>(`/logistica/solicitacoes/${solicitacaoId}/evidencias`)
      .then(setEvidencias)
      .catch(() => setEvidencias([]));
  }, [solicitacaoId]);

  useEffect(() => {
    setFicha(null);
    setAcao(null);
    setErro(null);
    setEscolhidos([]);
    setAlvo('');
    setMotivo('');
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!solicitacaoId || (!podeOfertar && !podeAtribuir)) return;
    api.get<Encarregado[]>('/logistica/encarregados').then(setEncarregados).catch(() => setEncarregados([]));
  }, [solicitacaoId, podeOfertar, podeAtribuir]);

  if (!solicitacaoId) return null;

  const aberta = ficha ? STATUS_LOGISTICO_ABERTO.includes(ficha.status) : false;

  async function executar() {
    if (!ficha || !acao) return;
    setOcupado(true);
    setErro(null);
    try {
      if (acao === 'ofertar') {
        await api.post(`/logistica/solicitacoes/${ficha.id}/oferta`, { encarregadoIds: escolhidos });
      } else if (acao === 'atribuir') {
        await api.post(`/logistica/solicitacoes/${ficha.id}/atribuicao`, { encarregadoId: alvo, motivo: motivo || undefined });
      } else if (acao === 'cancelar') {
        await api.post(`/logistica/solicitacoes/${ficha.id}/cancelamento`, { motivo });
      } else {
        await api.post(`/logistica/solicitacoes/${ficha.id}/reagendamento`, {
          dataDesejada: data ? new Date(data).toISOString() : null,
          observacoes: motivo || null,
        });
      }
      setAcao(null);
      aoMudar();
      carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível executar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open fullWidth maxWidth="md" onClose={aoFechar}>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: 15, fontWeight: 600 }}>{ficha?.identificador ?? '…'}</Typography>
          {ficha && <Chip size="small" color="primary" label={STATUS_SOLICITACAO_LOGISTICA_LABEL[ficha.status]} />}
          {ficha?.statusExterno && (
            <Chip
              size="small"
              variant="outlined"
              label={`Cliente vê: ${STATUS_EXTERNO_LOGISTICO_LABEL[ficha.statusExterno as StatusExternoLogistico] ?? ficha.statusExterno}`}
            />
          )}
          {ficha?.comOcorrencia && <Chip size="small" color="warning" label="Com ocorrência" />}
          {ficha?.comDivergencia && <Chip size="small" color="error" variant="outlined" label="Divergência de volumes" />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
            {erro}
          </Alert>
        )}
        {!ficha ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Linha r="Serviço" v={`${TIPO_SERVICO_LOGISTICO_LABEL[ficha.tipoServico]} · ${TIPO_OPERACAO_LOGISTICA_LABEL[ficha.tipoOperacao]}`} />
                <Linha r="Cliente" v={ficha.cliente} />
                <Linha r="Endereço" v={[ficha.endereco, ficha.pontoReferencia].filter(Boolean).join(' — ')} />
                <Linha r="Contato" v={[ficha.contatoNoLocal, ficha.telefoneContato].filter(Boolean).join(' · ') || '—'} />
                <Linha r="Quando" v={[ficha.dataDesejada ? new Date(ficha.dataDesejada).toLocaleDateString('pt-BR') : null, janela(ficha)].filter(Boolean).join(' · ') || 'Sem data'} />
                <Linha r="Canal" v={CANAL_ORIGEM_LOGISTICO_LABEL[ficha.canalOrigem]} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Linha r="Material" v={[ficha.tipoMaterial, ficha.volumesEstimados != null ? `${ficha.volumesEstimados} volume(s)` : null, ficha.conservacao ? CONSERVACAO_LOGISTICA_LABEL[ficha.conservacao] : null].filter(Boolean).join(' · ') || '—'} />
                <Linha r="Prioridade" v={PRIORIDADE_LOGISTICA_LABEL[ficha.prioridade]} />
                <Linha r="Requisitos" v={ficha.requisitosEspeciais.map((r) => REQUISITO_ESPECIAL_LOGISTICO_LABEL[r]).join(', ') || '—'} />
                <Linha r="Encarregado" v={ficha.encarregado ?? 'Sem dono'} />
                <Linha r="Valor ao encarregado" v={reais(ficha.valorCentavos)} />
                {ficha.observacoes && <Linha r="Observações" v={ficha.observacoes} />}
              </Box>
            </Stack>

            {(ficha.retiradaEm || ficha.entregueEm || ficha.motivoNaoRealizacao) && (
              <>
                <Divider />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Execução</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    {ficha.chegadaEm && <Linha r="Chegada" v={horaCurta(ficha.chegadaEm)} />}
                    {ficha.retiradaEm && (
                      <>
                        <Linha r="Retirada" v={`${horaCurta(ficha.retiradaEm)} · ${ficha.volumesRecebidos ?? '?'} volume(s)${ficha.volumesEstimados != null && ficha.volumesEstimados !== ficha.volumesRecebidos ? ` (estimados ${ficha.volumesEstimados})` : ''}`} />
                        {ficha.justificativaVolumes && <Linha r="Justificativa" v={ficha.justificativaVolumes} />}
                        {ficha.quemEntregou && <Linha r="Entregue por" v={[ficha.quemEntregou.nome, ficha.quemEntregou.funcao].filter(Boolean).join(' · ')} />}
                        {ficha.condicaoMaterial && ficha.condicaoMaterial.length > 0 && (
                          <Linha r="Condição" v={ficha.condicaoMaterial.map((c) => CONDICAO_MATERIAL_LOGISTICA_LABEL[c]).join(', ')} />
                        )}
                        <Linha r="Posição" v={geo(ficha.geoRetirada)} />
                      </>
                    )}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    {ficha.entregueEm && (
                      <>
                        <Linha r="Entrega" v={`${horaCurta(ficha.entregueEm)} · ${ficha.volumesEntregues ?? '?'} volume(s)`} />
                        {ficha.recebedor && <Linha r="Recebido por" v={[ficha.recebedor.nome, ficha.recebedor.documento].filter(Boolean).join(' · ')} />}
                        <Linha r="Posição" v={geo(ficha.geoEntrega)} />
                      </>
                    )}
                    {ficha.concluidaEm && <Linha r="Concluída" v={horaCurta(ficha.concluidaEm)} />}
                    {ficha.motivoNaoRealizacao && <Linha r="Não realizada" v={[ficha.motivoNaoRealizacao, ficha.detalheNaoRealizacao].filter(Boolean).join(' — ')} />}
                    {ficha.motivoCancelamento && <Linha r="Cancelada" v={ficha.motivoCancelamento} />}
                  </Box>
                </Stack>
              </>
            )}

            {evidencias.length > 0 && (
              <>
                <Divider />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Fotografias</Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  {evidencias.map((e) => (
                    <a
                      key={e.id}
                      href={urlArquivo(`/logistica/solicitacoes/${ficha.id}/evidencias/${e.id}/arquivo`)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none' }}
                    >
                      <img
                        src={urlArquivo(`/logistica/solicitacoes/${ficha.id}/evidencias/${e.id}/arquivo?tamanho=miniatura`)}
                        alt={e.legenda ?? ''}
                        loading="lazy"
                        style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                      />
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                        {e.metadados?.marco ?? ''} · {e.autor ?? ''}
                      </Typography>
                    </a>
                  ))}
                </Stack>
              </>
            )}

            {ficha.ofertas.length > 0 && (
              <>
                <Divider />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Ofertas</Typography>
                <Stack spacing={0.5}>
                  {ficha.ofertas.map((o) => (
                    <Stack key={o.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: 13, minWidth: 180 }}>{o.encarregado}</Typography>
                      <Chip size="small" variant="outlined" label={STATUS_OFERTA_LABEL[o.status]} />
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {o.status === 'enviada' && o.expiraEm ? `expira ${horaCurta(o.expiraEm)}` : o.respondidaEm ? horaCurta(o.respondidaEm) : ''}
                        {o.motivoRecusa ? ` · ${o.motivoRecusa}` : ''}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </>
            )}

            <Divider />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Linha do tempo</Typography>
            <Stack spacing={0.75}>
              {ficha.timeline.map((m, i) => (
                <Stack key={i} direction="row" spacing={1.5} sx={{ alignItems: 'baseline' }}>
                  <Typography sx={{ ...MONO, fontSize: 12, color: 'text.secondary', minWidth: 118 }}>{horaCurta(m.ocorridoEm)}</Typography>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 13 }}>
                      {m.descricao ?? m.tipo}
                      {m.tipo === 'alerta_guardian' && <Chip size="small" color="warning" label="Guardian" sx={{ ml: 1 }} />}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                      {m.responsavel ?? ''}
                      {m.visivelPortal ? ' · visível ao cliente' : ''}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>

            {acao && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                {acao === 'ofertar' && (
                  <>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Quem recebe a oferta? O primeiro que aceitar leva.</Typography>
                    <Stack>
                      {encarregados.map((e) => (
                        <FormControlLabel
                          key={e.id}
                          control={
                            <Checkbox
                              checked={escolhidos.includes(e.id)}
                              onChange={(_, marcado) => setEscolhidos((a) => (marcado ? [...a, e.id] : a.filter((x) => x !== e.id)))}
                            />
                          }
                          label={e.nome}
                        />
                      ))}
                    </Stack>
                  </>
                )}
                {acao === 'atribuir' && (
                  <Stack spacing={1.5}>
                    <TextField select size="small" label="Encarregado" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
                      {encarregados.map((e) => (
                        <MenuItem key={e.id} value={e.id}>
                          {e.nome}
                        </MenuItem>
                      ))}
                    </TextField>
                    {ficha.encarregadoId && (
                      <TextField size="small" label="Motivo da troca (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    )}
                  </Stack>
                )}
                {acao === 'cancelar' && (
                  <TextField fullWidth size="small" label="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                )}
                {acao === 'reagendar' && (
                  <Stack spacing={1.5}>
                    <TextField size="small" type="date" label="Nova data" slotProps={{ inputLabel: { shrink: true } }} value={data} onChange={(e) => setData(e.target.value)} />
                    <TextField size="small" label="Observações" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </Stack>
                )}
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => setAcao(null)}>
                    Voltar
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={
                      ocupado ||
                      (acao === 'ofertar' && escolhidos.length === 0) ||
                      (acao === 'atribuir' && (!alvo || (Boolean(ficha.encarregadoId) && !motivo.trim()))) ||
                      (acao === 'cancelar' && !motivo.trim())
                    }
                    onClick={() => void executar()}
                  >
                    Confirmar
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button onClick={aoFechar}>Fechar</Button>
        <Box sx={{ flex: 1 }} />
        {ficha && aberta && !ficha.encarregadoId && podeOfertar && (
          <Button size="small" variant="contained" onClick={() => setAcao('ofertar')}>
            Enviar oferta
          </Button>
        )}
        {ficha && aberta && podeAtribuir && ficha.status !== 'entregue' && (
          <Button size="small" onClick={() => setAcao('atribuir')}>
            {ficha.encarregadoId ? 'Reatribuir' : 'Atribuir direto'}
          </Button>
        )}
        {ficha && aberta && ficha.encarregadoId && podeAtribuir && aoExecutar && (
          <Button size="small" onClick={() => aoExecutar(ficha.id)}>
            Registrar pelo encarregado
          </Button>
        )}
        {ficha && (ficha.status === 'nao_realizada' || ficha.status === 'cancelada') && podeSolicitar && (
          <Button size="small" onClick={() => setAcao('reagendar')}>
            Reagendar
          </Button>
        )}
        {ficha && aberta && podeCancelar && (
          <Button size="small" color="error" onClick={() => setAcao('cancelar')}>
            Cancelar operação
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function Linha({ r, v }: { r: string; v: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ py: 0.25 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', minWidth: 120 }}>{r}</Typography>
      <Typography sx={{ fontSize: 13, flex: 1 }}>{v}</Typography>
    </Stack>
  );
}

function geo(g: GeoMarco | null): string {
  if (!g) return '—';
  if (g.latitude != null && g.longitude != null) {
    return `${g.latitude.toFixed(5)}, ${g.longitude.toFixed(5)}${g.precisaoMetros ? ` (±${Math.round(g.precisaoMetros)} m)` : ''}`;
  }
  return `Sem posição: ${g.ausente ? MOTIVO_GEO_AUSENTE_LABEL[g.ausente] : 'motivo não informado'}`;
}
