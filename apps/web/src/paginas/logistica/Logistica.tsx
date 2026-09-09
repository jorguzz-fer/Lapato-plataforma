import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  SITUACAO_PRODUCAO_LOGISTICA,
  SITUACAO_PRODUCAO_LOGISTICA_LABEL,
  STATUS_LOGISTICO_ABERTO,
  STATUS_SOLICITACAO_LOGISTICA,
  STATUS_SOLICITACAO_LOGISTICA_LABEL,
  TIPO_SERVICO_LOGISTICO_LABEL,
  type AchadoGuardian,
  type SituacaoProducaoLogistica,
  type StatusSolicitacaoLogistica,
} from '@lapato/shared';
import { api, ErroApi, type Sessao } from '../../api';
import { Execucao } from './Execucao';
import { FichaSolicitacao } from './FichaSolicitacao';
import { NovaSolicitacao } from './NovaSolicitacao';
import { Rotas } from './Rotas';
import {
  dataCurta,
  janela,
  reais,
  MONO,
  horaCurta,
  hojeIso,
  type PainelLogistica,
  type RelatorioProducao,
  type SolicitacaoResumo,
} from './comum';

type Aba = 'central' | 'meus' | 'rotas' | 'painel' | 'producao';

const COR: Partial<Record<StatusSolicitacaoLogistica, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'>> = {
  recebida: 'default',
  aguardando_aceite: 'warning',
  aceita: 'info',
  agendada: 'info',
  em_deslocamento: 'primary',
  no_local: 'primary',
  coletada: 'primary',
  em_transporte: 'primary',
  entregue: 'success',
  concluida: 'success',
  cancelada: 'default',
  nao_realizada: 'error',
};

/**
 * M19 - Logistica.
 *
 * Duas pessoas usam a mesma tela com perguntas diferentes. A central pergunta
 * "quem pediu, quem vai buscar, ja foi coletado" (secao 133) e trabalha na
 * fila; o encarregado pergunta "o que e o meu proximo servico" e trabalha no
 * celular (secao 45). As abas separam os dois sem separar o dado.
 */
export function Logistica({ sessao }: { sessao: Sessao }) {
  const permissoes = sessao.permissoes;
  const podeSolicitar = permissoes.includes('logistica:solicitar');
  const podeExecutar = permissoes.includes('logistica:executar');
  const central = permissoes.includes('logistica:ofertar') || permissoes.includes('logistica:atribuir');
  const veFinanceiro = permissoes.includes('financeiro:visualizar');

  const [aba, setAba] = useState<Aba>(central ? 'central' : podeExecutar ? 'meus' : 'painel');
  const [lista, setLista] = useState<SolicitacaoResumo[] | null>(null);
  const [minhas, setMinhas] = useState<SolicitacaoResumo[] | null>(null);
  const [filtro, setFiltro] = useState<'abertas' | 'hoje' | 'urgentes' | 'sem_dono' | 'ocorrencia' | 'todas' | StatusSolicitacaoLogistica>('abertas');
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [execucaoId, setExecucaoId] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    const abertasApenas = !['todas', 'cancelada', 'nao_realizada', 'concluida'].includes(filtro);
    api
      .get<SolicitacaoResumo[]>(`/logistica/solicitacoes${abertasApenas ? '?abertas=true' : ''}`)
      .then(setLista)
      .catch((e) => setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível carregar a fila.'));
    if (podeExecutar) {
      api
        .get<SolicitacaoResumo[]>('/logistica/solicitacoes?minhasOfertas=true')
        .then(setMinhas)
        .catch(() => setMinhas([]));
    }
  }, [filtro, podeExecutar]);
  useEffect(recarregar, [recarregar]);

  const filtrada = useMemo(() => {
    const hoje = hojeIso();
    const q = busca.trim().toLowerCase();
    return (lista ?? []).filter((s) => {
      if (filtro === 'hoje' && !(s.dataDesejada && s.dataDesejada.slice(0, 10) === hoje)) return false;
      if (filtro === 'urgentes' && s.prioridade !== 'urgente') return false;
      if (filtro === 'sem_dono' && s.encarregadoId) return false;
      if (filtro === 'ocorrencia' && !(s.comOcorrencia || s.comDivergencia)) return false;
      if (STATUS_SOLICITACAO_LOGISTICA.includes(filtro as StatusSolicitacaoLogistica) && s.status !== filtro) return false;
      if (q && ![s.identificador, s.cliente, s.endereco, s.encarregado ?? ''].some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [lista, filtro, busca]);

  const ofertadas = (minhas ?? []).filter((s) => !s.encarregadoId);
  const meus = (minhas ?? []).filter((s) => s.encarregadoId === sessao.usuarioId && STATUS_LOGISTICO_ABERTO.includes(s.status));

  async function responderOferta(id: string, aceitar: boolean) {
    try {
      await api.post(`/logistica/solicitacoes/${id}/${aceitar ? 'aceite' : 'recusa'}`, aceitar ? undefined : {});
      recarregar();
      if (aceitar) setExecucaoId(id);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível responder.');
    }
  }

  return (
    <Box sx={{ maxWidth: 1120 }}>
      <Stack direction="row" sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h2">Logística</Typography>
        {podeSolicitar && (
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setNova(true)}>
            Nova solicitação
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Retiradas e entregas: quem pediu, quem vai buscar, o que foi retirado e quando chegou.
      </Typography>

      <Tabs value={aba} onChange={(_, v: Aba) => setAba(v)} sx={{ mb: 2 }} variant="scrollable" allowScrollButtonsMobile>
        {central && <Tab value="central" label="Fila" />}
        {podeExecutar && <Tab value="meus" label={`Meus serviços${ofertadas.length ? ` (${ofertadas.length} oferta${ofertadas.length > 1 ? 's' : ''})` : ''}`} />}
        <Tab value="rotas" label="Rotas" />
        <Tab value="painel" label="Painel" />
        <Tab value="producao" label="Produção" />
      </Tabs>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
          {erro}
        </Alert>
      )}

      {aba === 'central' && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField size="small" label="Buscar" placeholder="Número, cliente, endereço, encarregado" value={busca} onChange={(e) => setBusca(e.target.value)} sx={{ flex: 1 }} />
            <TextField size="small" select label="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} sx={{ minWidth: 220 }}>
              <MenuItem value="abertas">Abertas</MenuItem>
              <MenuItem value="hoje">Hoje</MenuItem>
              <MenuItem value="urgentes">Urgentes</MenuItem>
              <MenuItem value="sem_dono">Sem encarregado</MenuItem>
              <MenuItem value="ocorrencia">Com ocorrência ou divergência</MenuItem>
              <MenuItem value="todas">Todas</MenuItem>
              {STATUS_SOLICITACAO_LOGISTICA.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_SOLICITACAO_LOGISTICA_LABEL[s]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <ListaSolicitacoes lista={lista === null ? null : filtrada} vazio="Nenhuma solicitação com esses critérios." aoAbrir={setFichaId} />
        </>
      )}

      {aba === 'meus' && (
        <Stack spacing={2}>
          {ofertadas.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Ofertas para você — o primeiro que aceitar leva</Typography>
              <Stack spacing={1}>
                {ofertadas.map((s) => (
                  <Card key={s.id} sx={{ p: 2 }}>
                    <Resumo s={s} />
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <Button variant="contained" size="large" sx={{ flex: 1 }} onClick={() => void responderOferta(s.id, true)}>
                        Aceitar serviço
                      </Button>
                      <Button variant="outlined" size="large" onClick={() => void responderOferta(s.id, false)}>
                        Não posso
                      </Button>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Box>
          )}
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Meus serviços em andamento</Typography>
            <ListaSolicitacoes lista={minhas === null ? null : meus} vazio="Nenhum serviço com você agora." aoAbrir={setExecucaoId} />
          </Box>
        </Stack>
      )}

      {aba === 'rotas' && (
        <Rotas usuarioId={sessao.usuarioId} permissoes={permissoes} aoAbrirSolicitacao={setFichaId} aoExecutar={setExecucaoId} />
      )}

      {aba === 'painel' && <Painel aoAbrir={setFichaId} />}

      {aba === 'producao' && <Producao propria={!veFinanceiro} podeLancar={permissoes.includes('financeiro:lancar')} />}

      <NovaSolicitacao
        aberto={nova}
        aoFechar={() => setNova(false)}
        aoSalvar={(id) => {
          setNova(false);
          recarregar();
          setFichaId(id);
        }}
      />
      <FichaSolicitacao
        solicitacaoId={fichaId}
        permissoes={permissoes}
        aoFechar={() => setFichaId(null)}
        aoMudar={recarregar}
        aoExecutar={(id) => {
          setFichaId(null);
          setExecucaoId(id);
        }}
      />
      <Execucao solicitacaoId={execucaoId} aoFechar={() => setExecucaoId(null)} aoMudar={recarregar} />
    </Box>
  );
}

function Resumo({ s }: { s: SolicitacaoResumo }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 600 }}>{s.identificador}</Typography>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{TIPO_SERVICO_LOGISTICO_LABEL[s.tipoServico]}</Typography>
        <Typography sx={{ fontSize: 14 }}>{s.cliente}</Typography>
        <Chip size="small" color={COR[s.status] ?? 'default'} label={STATUS_SOLICITACAO_LOGISTICA_LABEL[s.status]} />
        {s.prioridade === 'urgente' && <Chip size="small" color="error" variant="outlined" label="Urgente" />}
        {s.comOcorrencia && <Chip size="small" color="warning" variant="outlined" label="Ocorrência" />}
        {s.comDivergencia && <Chip size="small" color="error" variant="outlined" label="Divergência" />}
        {s.ofertasAbertas > 0 && <Chip size="small" variant="outlined" label={`${s.ofertasAbertas} oferta(s) aberta(s)`} />}
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
        {s.endereco}
        {s.dataDesejada ? ` · ${dataCurta(s.dataDesejada)}` : ''}
        {janela(s) ? ` ${janela(s)}` : ''}
        {s.encarregado ? ` · ${s.encarregado}` : ' · sem encarregado'}
        {s.valorCentavos != null ? ` · ${reais(s.valorCentavos)}` : ''}
      </Typography>
    </Box>
  );
}

function ListaSolicitacoes({ lista, vazio, aoAbrir }: { lista: SolicitacaoResumo[] | null; vazio: string; aoAbrir: (id: string) => void }) {
  if (lista === null) {
    return (
      <Stack spacing={1}>
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={64} />
      </Stack>
    );
  }
  if (lista.length === 0) return <Alert severity="info">{vazio}</Alert>;
  return (
    <Stack spacing={1}>
      {lista.map((s) => (
        <Card key={s.id} sx={{ p: 2, cursor: 'pointer' }} onClick={() => aoAbrir(s.id)}>
          <Resumo s={s} />
        </Card>
      ))}
    </Stack>
  );
}

/** Secao 94: o painel da central, mais a varredura do Guardian (secao 111). */
function Painel({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const [painel, setPainel] = useState<PainelLogistica | null>(null);
  const [achados, setAchados] = useState<AchadoGuardian[] | null>(null);

  useEffect(() => {
    api.get<PainelLogistica>('/logistica/painel').then(setPainel).catch(() => setPainel(null));
    api.get<AchadoGuardian[]>('/logistica/guardian').then(setAchados).catch(() => setAchados([]));
  }, []);

  if (!painel) return <Skeleton variant="rounded" height={160} />;

  const tiles: Array<[string, number, 'default' | 'warning' | 'error']> = [
    ['Para hoje', painel.hoje, 'default'],
    ['Aguardando aceite', painel.aguardandoAceite, 'warning'],
    ['Agendadas', painel.agendadas, 'default'],
    ['Em rota', painel.emRota, 'default'],
    ['Coletadas, não entregues', painel.coletadasNaoEntregues, 'warning'],
    ['Entregues, não concluídas', painel.entreguesNaoConcluidas, 'default'],
    ['Atrasadas', painel.atrasadas, 'error'],
    ['Urgentes abertas', painel.urgentes, 'error'],
    ['Não realizadas (30 d)', painel.naoRealizadas30d, 'default'],
    ['Com ocorrência', painel.comOcorrencia, 'warning'],
    ['Com divergência', painel.comDivergencia, 'error'],
    ['Rotas em andamento', painel.rotasEmAndamento, 'default'],
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
        {tiles.map(([r, v, cor]) => (
          <Card key={r} sx={{ px: 2, py: 1.5, minWidth: 150 }}>
            <Typography sx={{ fontSize: 24, fontWeight: 600, color: v > 0 && cor !== 'default' ? `${cor}.main` : 'text.primary' }}>{v}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{r}</Typography>
          </Card>
        ))}
      </Stack>

      {painel.encarregadosEmAtividade.length > 0 && (
        <Card sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>Encarregados na rua agora</Typography>
          {painel.encarregadosEmAtividade.map((e) => (
            <Typography key={e.encarregadoId} sx={{ fontSize: 13 }}>
              {e.nome} · {e.servicos} serviço(s)
            </Typography>
          ))}
        </Card>
      )}

      <Card sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Guardian</Typography>
        {achados === null ? (
          <Skeleton variant="rounded" height={40} />
        ) : achados.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Nada perdido de vista.</Typography>
        ) : (
          <Stack spacing={1}>
            {achados.map((a, i) => (
              <Alert
                key={i}
                severity={a.nivel === 'critico' ? 'error' : a.nivel === 'atencao' ? 'warning' : 'info'}
                sx={{ cursor: a.evidencias?.solicitacaoId ? 'pointer' : 'default' }}
                onClick={() => {
                  const id = a.evidencias?.solicitacaoId;
                  if (typeof id === 'string') aoAbrir(id);
                }}
              >
                {a.mensagem} <em>{a.comoResolver}</em>
              </Alert>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

/** Secoes 161 a 163: a producao por encarregado; o M20 move a situacao. */
function Producao({ propria, podeLancar }: { propria: boolean; podeLancar: boolean }) {
  const inicioMes = `${hojeIso().slice(0, 7)}-01`;
  const [de, setDe] = useState(inicioMes);
  const [ate, setAte] = useState(hojeIso());
  const [rel, setRel] = useState<RelatorioProducao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    const fim = new Date(`${ate}T00:00:00`);
    fim.setDate(fim.getDate() + 1);
    const q = `de=${de}&ate=${fim.toISOString().slice(0, 10)}`;
    api
      .get<RelatorioProducao>(propria ? `/logistica/producao?${q}` : `/financeiro/producao-logistica?${q}`)
      .then(setRel)
      .catch((e) => setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível carregar.'));
  }, [de, ate, propria]);
  useEffect(carregar, [carregar]);

  async function mudarSituacao(id: string, situacao: SituacaoProducaoLogistica) {
    try {
      await api.post(`/financeiro/producao-logistica/${id}/situacao`, { situacao });
      carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível.');
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField size="small" type="date" label="De" slotProps={{ inputLabel: { shrink: true } }} value={de} onChange={(e) => setDe(e.target.value)} />
        <TextField size="small" type="date" label="Até" slotProps={{ inputLabel: { shrink: true } }} value={ate} onChange={(e) => setAte(e.target.value)} />
      </Stack>
      {erro && <Alert severity="error">{erro}</Alert>}
      {!rel ? (
        <Skeleton variant="rounded" height={120} />
      ) : rel.encarregados.length === 0 ? (
        <Alert severity="info">Nenhum serviço concluído no período.</Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
            {rel.encarregados.map((e) => (
              <Card key={e.encarregadoId} sx={{ px: 2, py: 1.5, minWidth: 220 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{e.encarregado}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {e.retiradas} retirada(s) · {e.entregas} entrega(s)
                </Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 600, mt: 0.5 }}>{reais(e.valorCentavos)}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  pendente {reais(e.pendenteCentavos)} · pago {reais(e.pagoCentavos)}
                </Typography>
              </Card>
            ))}
          </Stack>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 6 }}>Serviço</th>
                  <th style={{ padding: 6 }}>Cliente</th>
                  <th style={{ padding: 6 }}>Encarregado</th>
                  <th style={{ padding: 6 }}>Concluído</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Valor</th>
                  <th style={{ padding: 6 }}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {rel.itens.map((i) => (
                  <tr key={i.id} style={{ borderTop: '1px solid rgba(128,128,128,.25)' }}>
                    <td style={{ padding: 6 }}>
                      <span style={MONO}>{i.identificador}</span> · {TIPO_SERVICO_LOGISTICO_LABEL[i.tipoServico]}
                    </td>
                    <td style={{ padding: 6 }}>{i.cliente}</td>
                    <td style={{ padding: 6 }}>{i.encarregado}</td>
                    <td style={{ padding: 6 }}>{horaCurta(i.concluidaEm)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{reais(i.valorCentavos)}</td>
                    <td style={{ padding: 6 }}>
                      {podeLancar ? (
                        <TextField select size="small" value={i.situacao} onChange={(e) => void mudarSituacao(i.id, e.target.value as SituacaoProducaoLogistica)} sx={{ minWidth: 190 }}>
                          {SITUACAO_PRODUCAO_LOGISTICA.map((s) => (
                            <MenuItem key={s} value={s}>
                              {SITUACAO_PRODUCAO_LOGISTICA_LABEL[s]}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        SITUACAO_PRODUCAO_LOGISTICA_LABEL[i.situacao as SituacaoProducaoLogistica] ?? i.situacao
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </>
      )}
    </Stack>
  );
}
