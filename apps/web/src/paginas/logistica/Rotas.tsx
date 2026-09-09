import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import {
  STATUS_ROTA_LOGISTICA_LABEL,
  STATUS_SOLICITACAO_LOGISTICA_LABEL,
  TIPO_SERVICO_LOGISTICO_LABEL,
  type StatusSolicitacaoLogistica,
} from '@lapato/shared';
import { api, ErroApi } from '../../api';
import { hojeIso, janela, MONO, type Encarregado, type FichaRota, type RotaResumo, type SolicitacaoResumo } from './comum';

const PLANEJAVEIS: StatusSolicitacaoLogistica[] = [
  'recebida',
  'aguardando_informacao',
  'aguardando_triagem',
  'aguardando_aceite',
  'aceita',
  'agendada',
];

/**
 * Rotas do dia (M19 secoes 37 a 47).
 *
 * A central monta a rota escolhendo as paradas e a ordem (secao 38); o
 * encarregado ve a dele em ordem de atendimento (secao 41) e a inicia. Encerrar
 * com parada aberta e barrado pelo Guardian - o 409 traz a lista.
 */
export function Rotas({
  usuarioId,
  permissoes,
  aoAbrirSolicitacao,
  aoExecutar,
}: {
  usuarioId: string;
  permissoes: string[];
  aoAbrirSolicitacao: (id: string) => void;
  aoExecutar: (id: string) => void;
}) {
  const podeMontar = permissoes.includes('logistica:atribuir');
  const [data, setData] = useState(hojeIso());
  const [rotas, setRotas] = useState<RotaResumo[] | null>(null);
  const [rotaId, setRotaId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaRota | null>(null);
  const [montando, setMontando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [achados, setAchados] = useState<Array<{ mensagem: string; comoResolver?: string }>>([]);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(() => {
    api
      .get<RotaResumo[]>(`/logistica/rotas?data=${data}`)
      .then(setRotas)
      .catch(() => setErro('Não foi possível carregar as rotas.'));
  }, [data]);
  useEffect(recarregar, [recarregar]);

  const abrir = useCallback((id: string | null) => {
    setRotaId(id);
    setAchados([]);
    if (!id) {
      setFicha(null);
      return;
    }
    api.get<FichaRota>(`/logistica/rotas/${id}`).then(setFicha).catch(() => setFicha(null));
  }, []);

  async function agir(caminho: 'inicio' | 'encerramento') {
    if (!rotaId) return;
    setOcupado(true);
    setErro(null);
    setAchados([]);
    try {
      await api.post(`/logistica/rotas/${rotaId}/${caminho}`, {});
      abrir(rotaId);
      recarregar();
    } catch (e) {
      if (e instanceof ErroApi && e.bloqueadoPeloGuardian) setAchados(e.achados ?? []);
      else setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível.');
    } finally {
      setOcupado(false);
    }
  }

  async function mover(idx: number, delta: number) {
    if (!ficha || !rotaId) return;
    const ids = ficha.paradas.map((p) => p.id);
    const alvo = idx + delta;
    if (alvo < 0 || alvo >= ids.length) return;
    [ids[idx], ids[alvo]] = [ids[alvo]!, ids[idx]!];
    setOcupado(true);
    try {
      await api.post(`/logistica/rotas/${rotaId}/paradas`, { solicitacaoIds: ids });
      abrir(rotaId);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível reordenar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField size="small" type="date" label="Dia" slotProps={{ inputLabel: { shrink: true } }} value={data} onChange={(e) => setData(e.target.value)} />
        <Box sx={{ flex: 1 }} />
        {podeMontar && (
          <Button variant="contained" onClick={() => setMontando(true)}>
            Montar rota
          </Button>
        )}
      </Stack>
      {erro && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
          {erro}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          {rotas === null ? (
            <Skeleton variant="rounded" height={64} />
          ) : rotas.length === 0 ? (
            <Alert severity="info">Nenhuma rota neste dia.</Alert>
          ) : (
            rotas.map((r) => (
              <Card
                key={r.id}
                sx={{ p: 1.5, cursor: 'pointer', outline: r.id === rotaId ? '2px solid' : 'none', outlineColor: 'primary.main' }}
                onClick={() => abrir(r.id)}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
                    {r.encarregado}
                    {r.encarregadoId === usuarioId ? ' (você)' : ''}
                  </Typography>
                  <Chip size="small" color={r.status === 'em_andamento' ? 'primary' : r.status === 'encerrada' ? 'default' : 'warning'} label={STATUS_ROTA_LOGISTICA_LABEL[r.status]} />
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {r.concluidas}/{r.paradas} parada(s) fechadas{r.veiculo ? ` · ${r.veiculo}` : ''}
                </Typography>
              </Card>
            ))
          )}
        </Stack>

        <Box sx={{ flex: 1.4, minWidth: 0 }}>
          {rotaId && !ficha && <Skeleton variant="rounded" height={160} />}
          {ficha && (
            <Card sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600, flex: 1 }}>
                  Rota de {ficha.encarregado} · {new Date(`${ficha.data}T12:00:00`).toLocaleDateString('pt-BR')}
                </Typography>
                {ficha.status === 'planejada' && (ficha.encarregadoId === usuarioId || podeMontar) && (
                  <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir('inicio')}>
                    Iniciar rota
                  </Button>
                )}
                {ficha.status === 'em_andamento' && (ficha.encarregadoId === usuarioId || podeMontar) && (
                  <Button size="small" variant="outlined" disabled={ocupado} onClick={() => void agir('encerramento')}>
                    Encerrar rota
                  </Button>
                )}
              </Stack>
              {achados.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  <AlertTitle>A rota não encerra com parada em aberto</AlertTitle>
                  {achados.map((a, i) => (
                    <div key={i}>
                      {a.mensagem} <em>{a.comoResolver}</em>
                    </div>
                  ))}
                </Alert>
              )}
              <Stack spacing={0.75}>
                {ficha.paradas.map((p, i) => (
                  <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ ...MONO, fontSize: 13, width: 22, color: 'text.secondary' }}>{p.ordem}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => (p.status === 'concluida' || podeMontar ? aoAbrirSolicitacao(p.id) : aoExecutar(p.id))}>
                      <Typography sx={{ fontSize: 13 }}>
                        <strong>{TIPO_SERVICO_LOGISTICO_LABEL[p.tipoServico]}</strong> · {p.cliente}
                        {p.prioridade === 'urgente' ? ' · URGENTE' : ''}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.endereco}
                        {janela(p) ? ` · ${janela(p)}` : ''}
                      </Typography>
                    </Box>
                    <Chip size="small" variant="outlined" label={STATUS_SOLICITACAO_LOGISTICA_LABEL[p.status]} />
                    {podeMontar && ficha.status !== 'encerrada' && (
                      <>
                        <IconButton size="small" disabled={ocupado || i === 0} onClick={() => void mover(i, -1)} aria-label="Subir">
                          <ArrowUpward fontSize="inherit" />
                        </IconButton>
                        <IconButton size="small" disabled={ocupado || i === ficha.paradas.length - 1} onClick={() => void mover(i, 1)} aria-label="Descer">
                          <ArrowDownward fontSize="inherit" />
                        </IconButton>
                      </>
                    )}
                  </Stack>
                ))}
              </Stack>
            </Card>
          )}
        </Box>
      </Stack>

      {montando && (
        <DialogoMontarRota
          data={data}
          aoFechar={() => setMontando(false)}
          aoSalvar={(id) => {
            setMontando(false);
            recarregar();
            abrir(id);
          }}
        />
      )}
    </Box>
  );
}

function DialogoMontarRota({ data, aoFechar, aoSalvar }: { data: string; aoFechar: () => void; aoSalvar: (id: string) => void }) {
  const [encarregados, setEncarregados] = useState<Encarregado[]>([]);
  const [candidatas, setCandidatas] = useState<SolicitacaoResumo[]>([]);
  const [encarregadoId, setEncarregadoId] = useState('');
  const [dia, setDia] = useState(data);
  const [veiculo, setVeiculo] = useState('');
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api.get<Encarregado[]>('/logistica/encarregados').then(setEncarregados).catch(() => setEncarregados([]));
    api
      .get<SolicitacaoResumo[]>('/logistica/solicitacoes?abertas=true')
      .then((l) => setCandidatas(l.filter((s) => !s.rotaId && PLANEJAVEIS.includes(s.status))))
      .catch(() => setCandidatas([]));
  }, []);

  // Uma parada ja com dono so entra na rota desse dono.
  const visiveis = candidatas.filter((s) => !s.encarregadoId || s.encarregadoId === encarregadoId);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ id: string }>('/logistica/rotas', {
        encarregadoId,
        data: dia,
        veiculo: veiculo || null,
        solicitacaoIds: escolhidas,
      });
      aoSalvar(r.id);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível montar a rota.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={aoFechar}>
      <DialogTitle>Montar rota do dia</DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {erro}
          </Alert>
        )}
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" label="Encarregado" sx={{ flex: 1 }} value={encarregadoId} onChange={(e) => { setEncarregadoId(e.target.value); setEscolhidas([]); }}>
              {encarregados.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.nome}
                </MenuItem>
              ))}
            </TextField>
            <TextField size="small" type="date" label="Dia" slotProps={{ inputLabel: { shrink: true } }} value={dia} onChange={(e) => setDia(e.target.value)} />
          </Stack>
          <TextField size="small" label="Veículo" placeholder="Fiorino ABC-1234" value={veiculo} onChange={(e) => setVeiculo(e.target.value)} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            Paradas, na ordem em que marcar. Solicitação sem dono passa a ser deste encarregado.
          </Typography>
          {visiveis.length === 0 ? (
            <Alert severity="info">Nenhuma solicitação aberta fora de rota.</Alert>
          ) : (
            <Stack>
              {visiveis.map((s) => (
                <FormControlLabel
                  key={s.id}
                  control={
                    <Checkbox
                      checked={escolhidas.includes(s.id)}
                      onChange={(_, m) => setEscolhidas((a) => (m ? [...a, s.id] : a.filter((x) => x !== s.id)))}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: 13 }}>
                      {escolhidas.includes(s.id) ? `${escolhidas.indexOf(s.id) + 1}. ` : ''}
                      <span style={MONO}>{s.identificador}</span> · {TIPO_SERVICO_LOGISTICO_LABEL[s.tipoServico]} · {s.cliente} — {s.endereco}
                      {s.encarregado ? ` (${s.encarregado})` : ''}
                    </Typography>
                  }
                />
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button variant="contained" disabled={ocupado || !encarregadoId || escolhidas.length === 0} onClick={() => void salvar()}>
          Criar rota
        </Button>
      </DialogActions>
    </Dialog>
  );
}
