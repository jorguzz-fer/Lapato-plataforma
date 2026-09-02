import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ExpandMore from '@mui/icons-material/ExpandMoreOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import { ETAPA, PRIORIDADE } from '@lapato/shared';
import {
  api,
  ErroApi,
  type CasoNaFila,
  type MensagemSolicitacao,
  type PendenciaResumo,
  type SolicitacaoResumo,
} from '../api';

/**
 * M10 - Solicitacoes e Pendencias.
 *
 * A fila unica que substitui mensagens, planilhas e comentarios soltos
 * (secao 1): toda demanda com responsavel, status, prazo e historico. As
 * subabas seguem a secao 51; a conversa fica anexa a demanda (secao 49) - o
 * modulo existe para desencorajar "lembrar de fazer PAS" como comentario
 * (secao 50).
 *
 * O que cada perfil PODE fazer chega resolvido do servidor via permissoes -
 * a tela so esconde; a autorizacao de verdade e da API.
 */

const TIPOS_SOLICITACAO = [
  { valor: 'coloracao_especial', rotulo: 'Coloração especial' },
  { valor: 'ihq', rotulo: 'Imuno-histoquímica' },
  { valor: 'recorte', rotulo: 'Recorte' },
  { valor: 'niveis_adicionais', rotulo: 'Níveis adicionais' },
  { valor: 'reamostragem', rotulo: 'Reamostragem' },
  { valor: 'revisao_interna', rotulo: 'Revisão interna' },
  { valor: 'cadastral', rotulo: 'Correção cadastral' },
  { valor: 'clinica', rotulo: 'Informação clínica' },
  { valor: 'administrativa', rotulo: 'Administrativa' },
  { valor: 'outra', rotulo: 'Outra' },
] as const;

const TIPOS_PENDENCIA = [
  { valor: 'cadastral', rotulo: 'Cadastral' },
  { valor: 'clinica', rotulo: 'Clínica' },
  { valor: 'margens', rotulo: 'Identificação de margens' },
  { valor: 'execucao_tecnica', rotulo: 'Execução técnica' },
  { valor: 'autorizacao', rotulo: 'Autorização' },
  { valor: 'outra', rotulo: 'Outra' },
] as const;

const TIPO_LABEL: Record<string, string> = {
  ...Object.fromEntries([...TIPOS_SOLICITACAO, ...TIPOS_PENDENCIA].map((t) => [t.valor, t.rotulo])),
  // Criada pelo M06 quando a triagem bloqueia; resolvida aqui (M10 seção 5).
  triagem_bloqueada: 'Triagem bloqueada',
};

const STATUS_LABEL: Record<string, string> = {
  criada: 'Criada',
  aguardando_analise: 'Aguardando análise',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  aguardando_execucao: 'Aguardando execução',
  em_execucao: 'Em execução',
  aguardando_informacao: 'Aguardando informação',
  parcialmente_concluida: 'Parcialmente concluída',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  aberta: 'Aberta',
  aguardando_acao_interna: 'Aguardando ação interna',
  aguardando_cliente: 'Aguardando cliente',
  aguardando_veterinario: 'Aguardando veterinário',
  aguardando_patologista: 'Aguardando patologista',
  aguardando_autorizacao: 'Aguardando autorização',
  aguardando_execucao_tecnica: 'Aguardando execução técnica',
  respondida: 'Respondida',
  em_validacao: 'Em validação',
  resolvida: 'Resolvida',
};

const PRIORIDADE_LABEL: Record<string, string> = {
  rotina: 'Rotina',
  prioritaria: 'Prioritária',
  urgente: 'Urgente',
  critica: 'Crítica',
};

const STATUS_ABERTOS = [
  'criada',
  'aguardando_analise',
  'aprovada',
  'aguardando_execucao',
  'em_execucao',
  'aguardando_informacao',
  'parcialmente_concluida',
];

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

type Aba = 'abertas' | 'minhas' | 'pendencias' | 'vencidas' | 'concluidas';

interface Props {
  permissoes: string[];
}

export function Solicitacoes({ permissoes }: Props) {
  const [aba, setAba] = useState<Aba>('abertas');
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoResumo[]>([]);
  const [pendencias, setPendencias] = useState<PendenciaResumo[]>([]);
  const [casos, setCasos] = useState<CasoNaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogoSolicitacao, setDialogoSolicitacao] = useState(false);
  const [dialogoPendencia, setDialogoPendencia] = useState(false);

  const podeCriar = permissoes.includes('solicitacao:criar');

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    const busca =
      aba === 'pendencias'
        ? api.get<PendenciaResumo[]>('/solicitacoes/pendencias').then(setPendencias)
        : api.get<SolicitacaoResumo[]>(`/solicitacoes?aba=${aba}`).then(setSolicitacoes);
    busca
      .catch(() => setErro('Não foi possível carregar as demandas.'))
      .finally(() => setCarregando(false));
  }, [aba]);

  useEffect(recarregar, [recarregar]);

  /** Os formulários de criação vinculam a demanda a um caso da central. */
  useEffect(() => {
    if (!podeCriar || !permissoes.includes('fluxo:visualizar')) return;
    api.get<CasoNaFila[]>('/fluxo/casos').then(setCasos).catch(() => setCasos([]));
  }, [podeCriar, permissoes]);

  return (
    <Box component="section" sx={{ maxWidth: 1080 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{
          mb: 1.5,
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Box>
          <Typography variant="h2">Solicitações e Pendências</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Toda ação necessária para um caso avançar, com responsável, prazo e histórico.
          </Typography>
        </Box>

        {podeCriar && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddOutlined />}
              onClick={() => setDialogoPendencia(true)}
            >
              Pendência
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddOutlined />}
              onClick={() => setDialogoSolicitacao(true)}
            >
              Solicitação
            </Button>
          </Stack>
        )}
      </Stack>

      <Tabs
        value={aba}
        onChange={(_, v) => setAba(v as Aba)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="abertas" label="Abertas" />
        {/* Segunda review: o que EU pedi não pode se perder (coloração especial, recorte). */}
        <Tab value="minhas" label="Minhas" />
        <Tab value="pendencias" label="Pendências" />
        <Tab value="vencidas" label="Vencidas" />
        <Tab value="concluidas" label="Encerradas" />
      </Tabs>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {carregando && (
        <Stack spacing={1.5}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={92} />
          ))}
        </Stack>
      )}

      {!carregando && aba === 'pendencias' && (
        <ListaPendencias
          pendencias={pendencias}
          podeResolver={permissoes.includes('pendencia:resolver')}
          aoMudar={recarregar}
        />
      )}

      {!carregando && aba !== 'pendencias' && (
        <ListaSolicitacoes
          solicitacoes={solicitacoes}
          permissoes={permissoes}
          aoMudar={recarregar}
        />
      )}

      <DialogoNovaSolicitacao
        aberto={dialogoSolicitacao}
        casos={casos}
        aoFechar={() => setDialogoSolicitacao(false)}
        aoCriar={() => {
          setDialogoSolicitacao(false);
          setAba('abertas');
          recarregar();
        }}
      />

      <DialogoNovaPendencia
        aberto={dialogoPendencia}
        casos={casos}
        aoFechar={() => setDialogoPendencia(false)}
        aoCriar={() => {
          setDialogoPendencia(false);
          setAba('pendencias');
          recarregar();
        }}
      />
    </Box>
  );
}

// --- solicitações -----------------------------------------------------------

function ListaSolicitacoes({
  solicitacoes,
  permissoes,
  aoMudar,
}: {
  solicitacoes: SolicitacaoResumo[];
  permissoes: string[];
  aoMudar: () => void;
}) {
  if (solicitacoes.length === 0) {
    return <Vazio texto="Nenhuma solicitação nesta fila." />;
  }

  return (
    <Stack spacing={1.5}>
      {solicitacoes.map((s) => (
        <CartaoSolicitacao key={s.id} solicitacao={s} permissoes={permissoes} aoMudar={aoMudar} />
      ))}
    </Stack>
  );
}

function CartaoSolicitacao({
  solicitacao: s,
  permissoes,
  aoMudar,
}: {
  solicitacao: SolicitacaoResumo;
  permissoes: string[];
  aoMudar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<MensagemSolicitacao[] | null>(null);
  const [novaMensagem, setNovaMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const aberta = STATUS_ABERTOS.includes(s.status);
  const vencida = aberta && s.prazoEm !== null && new Date(s.prazoEm) < new Date();

  const podeAnalisar = s.status === 'aguardando_analise' && permissoes.includes('solicitacao:aprovar');
  const podeConcluir =
    aberta && s.status !== 'aguardando_analise' && permissoes.includes('solicitacao:executar');
  const podeCancelar = aberta && permissoes.includes('solicitacao:cancelar');

  function expandir() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && mensagens === null) {
      api
        .get<MensagemSolicitacao[]>(`/solicitacoes/${s.id}/mensagens`)
        .then(setMensagens)
        .catch(() => setMensagens([]));
    }
  }

  async function agir(fn: () => Promise<unknown>, mensagemErro: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagemErro);
    } finally {
      setOcupado(false);
    }
  }

  async function comentar() {
    if (!novaMensagem.trim()) return;
    setOcupado(true);
    try {
      await api.post(`/solicitacoes/${s.id}/mensagens`, { texto: novaMensagem.trim() });
      setNovaMensagem('');
      setMensagens(await api.get<MensagemSolicitacao[]>(`/solicitacoes/${s.id}/mensagens`));
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível comentar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card sx={{ p: 2 }}>
      <Stack
        direction="row"
        onClick={expandir}
        sx={{ alignItems: 'flex-start', justifyContent: 'space-between', cursor: 'pointer', gap: 1 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'primary.main' }}>
              {s.identificador}
            </Typography>
            <Chip size="small" variant="outlined" label={TIPO_LABEL[s.tipo] ?? s.tipo} />
            <ChipStatus status={s.status} />
            {vencida && <Chip size="small" color="error" label="Vencida" />}
            {(s.prioridade === 'urgente' || s.prioridade === 'critica') && (
              <Chip size="small" color="warning" label={PRIORIDADE_LABEL[s.prioridade]} />
            )}
          </Stack>

          <Typography sx={{ fontSize: 13.5, mt: 0.75 }}>{s.descricao}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
            {s.caso ? (
              <>
                <Box
                  component={Link}
                  to={`/casos/${s.casoId}`}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ color: 'inherit' }}
                >
                  {s.caso}
                </Box>
                {s.paciente ? ` · ${s.paciente}` : ''}
              </>
            ) : (
              'Sem caso (administrativa)'
            )}
            {s.solicitante ? ` · por ${s.solicitante}` : ''}
            {' · '}
            {new Date(s.criadaEm).toLocaleDateString('pt-BR')}
          </Typography>
        </Box>

        <ExpandMore
          sx={{
            color: 'text.disabled',
            transform: aberto ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms',
            flexShrink: 0,
          }}
        />
      </Stack>

      <Collapse in={aberto}>
        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={1.5}>
          {s.justificativa && <Detalhe rotulo="Justificativa" valor={s.justificativa} />}
          {s.motivoRecusa && <Detalhe rotulo="Motivo da recusa" valor={s.motivoRecusa} />}
          {s.resultadoTecnico && (
            /* M10 seção 82: resultado técnico, nunca interpretação. */
            <Detalhe rotulo="Resultado técnico" valor={s.resultadoTecnico} />
          )}
          {s.setorResponsavel && <Detalhe rotulo="Setor responsável" valor={s.setorResponsavel} />}

          {/* Conversa estruturada (seção 49): anexa à demanda, nunca solta no caso. */}
          {mensagens && mensagens.length > 0 && (
            <Stack spacing={0.75}>
              {mensagens.map((m) => (
                <Typography key={m.id} sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {m.autor ?? 'Sistema'}
                  </Box>
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    {' · '}
                    {new Date(m.criadaEm).toLocaleString('pt-BR')}
                  </Box>
                  {' — '}
                  {m.texto}
                </Typography>
              ))}
            </Stack>
          )}

          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="Comentar…"
              value={novaMensagem}
              onChange={(e) => setNovaMensagem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void comentar();
              }}
            />
            <Button size="small" onClick={() => void comentar()} disabled={ocupado || !novaMensagem.trim()}>
              Enviar
            </Button>
          </Stack>

          {erro && <Alert severity="error">{erro}</Alert>}

          {(podeAnalisar || podeConcluir || podeCancelar) && (
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {podeCancelar && (
                <AcaoComTexto
                  rotulo="Cancelar"
                  cor="inherit"
                  titulo="Cancelar solicitação"
                  campo="Motivo"
                  obrigatorio
                  ocupado={ocupado}
                  aoConfirmar={(motivo) =>
                    agir(
                      () => api.post(`/solicitacoes/${s.id}/cancelamento`, { motivo }),
                      'Não foi possível cancelar.',
                    )
                  }
                />
              )}
              {podeAnalisar && (
                <>
                  <AcaoComTexto
                    rotulo="Recusar"
                    cor="warning"
                    titulo="Recusar solicitação"
                    campo="Motivo"
                    obrigatorio
                    ocupado={ocupado}
                    aoConfirmar={(motivo) =>
                      agir(
                        () =>
                          api.post(`/solicitacoes/${s.id}/analise`, {
                            resultado: 'recusada',
                            motivo,
                          }),
                        'Não foi possível recusar.',
                      )
                    }
                  />
                  <Button
                    size="small"
                    variant="contained"
                    disabled={ocupado}
                    onClick={() =>
                      void agir(
                        () => api.post(`/solicitacoes/${s.id}/analise`, { resultado: 'aprovada' }),
                        'Não foi possível aprovar.',
                      )
                    }
                  >
                    Aprovar
                  </Button>
                </>
              )}
              {podeConcluir && (
                <AcaoComTexto
                  rotulo="Concluir execução"
                  cor="primary"
                  variante="contained"
                  titulo="Concluir execução"
                  campo="Resultado técnico"
                  ajuda="O que foi feito — a interpretação pertence ao módulo diagnóstico."
                  ocupado={ocupado}
                  aoConfirmar={(resultadoTecnico) =>
                    agir(
                      () =>
                        api.post(`/solicitacoes/${s.id}/conclusao`, {
                          ...(resultadoTecnico.trim() ? { resultadoTecnico } : {}),
                        }),
                      'Não foi possível concluir.',
                    )
                  }
                />
              )}
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Card>
  );
}

// --- pendências -------------------------------------------------------------

function ListaPendencias({
  pendencias,
  podeResolver,
  aoMudar,
}: {
  pendencias: PendenciaResumo[];
  podeResolver: boolean;
  aoMudar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (pendencias.length === 0) {
    return <Vazio texto="Nenhuma pendência aberta — nada impedindo os casos de avançar." />;
  }

  async function resolver(id: string, resolucao: string) {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/solicitacoes/pendencias/${id}/resolucao`, { resolucao });
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível resolver a pendência.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      {erro && <Alert severity="error">{erro}</Alert>}

      {pendencias.map((p) => (
        <Card key={p.id} sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ justifyContent: 'space-between', gap: 1.5 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip size="small" variant="outlined" label={TIPO_LABEL[p.tipo] ?? p.tipo} />
                <ChipStatus status={p.status} />
                {p.nivelBloqueio !== 'nao' && (
                  <Chip
                    size="small"
                    color="error"
                    label={p.nivelBloqueio === 'total' ? 'Bloqueia o caso' : 'Bloqueio parcial'}
                  />
                )}
                {p.suspendePrazo && <Chip size="small" color="warning" label="Prazo suspenso" />}
              </Stack>

              <Typography sx={{ fontSize: 13.5, mt: 0.75 }}>{p.descricao}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                <Box component={Link} to={`/casos/${p.casoId}`} sx={{ color: 'inherit' }}>
                  {p.caso}
                </Box>
                {p.paciente ? ` · ${p.paciente}` : ''}
                {' · aberta em '}
                {new Date(p.criadaEm).toLocaleDateString('pt-BR')}
              </Typography>
            </Box>

            {podeResolver && (
              <Box sx={{ flexShrink: 0, alignSelf: { sm: 'center' } }}>
                <AcaoComTexto
                  rotulo="Resolver"
                  cor="primary"
                  variante="contained"
                  titulo="Resolver pendência"
                  campo="Resolução"
                  ajuda="Como a pendência saiu do caminho — fica no histórico do caso."
                  obrigatorio
                  ocupado={ocupado}
                  aoConfirmar={(resolucao) => resolver(p.id, resolucao)}
                />
              </Box>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

// --- diálogos de criação ----------------------------------------------------

function DialogoNovaSolicitacao({
  aberto,
  casos,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  casos: CasoNaFila[];
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [casoId, setCasoId] = useState('');
  const [tipo, setTipo] = useState('coloracao_especial');
  const [descricao, setDescricao] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [prioridade, setPrioridade] = useState('rotina');
  const [exigeAprovacao, setExigeAprovacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/solicitacoes', {
        ...(casoId ? { casoId } : {}),
        tipo,
        descricao: descricao.trim(),
        ...(justificativa.trim() ? { justificativa: justificativa.trim() } : {}),
        prioridade,
        exigeAprovacao,
      });
      setDescricao('');
      setJustificativa('');
      setExigeAprovacao(false);
      aoCriar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar a solicitação.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>Nova solicitação</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Caso"
            value={casoId}
            onChange={(e) => setCasoId(e.target.value)}
            helperText="Opcional — demandas administrativas podem não ter caso (M10 seção 8)."
          >
            <MenuItem value="">Sem caso</MenuItem>
            {casos.map((c) => (
              <MenuItem key={c.casoId} value={c.casoId}>
                {c.identificador} · {c.paciente}
              </MenuItem>
            ))}
          </TextField>

          <TextField select label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_SOLICITACAO.map((t) => (
              <MenuItem key={t.valor} value={t.valor}>
                {t.rotulo}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            multiline
            minRows={2}
            helperText='O que está sendo pedido — "PAS — Bloco A2", não "lembrar de fazer PAS".'
          />

          <TextField
            label="Justificativa"
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            multiline
            minRows={2}
          />

          <TextField
            select
            label="Prioridade"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value)}
            helperText="Da solicitação — não altera a prioridade do caso (M10 seção 19)."
          >
            {PRIORIDADE.map((p) => (
              <MenuItem key={p} value={p}>
                {PRIORIDADE_LABEL[p]}
              </MenuItem>
            ))}
          </TextField>

          <FormControlLabel
            control={
              <Checkbox
                checked={exigeAprovacao}
                onChange={(e) => setExigeAprovacao(e.target.checked)}
              />
            }
            label="Exige aprovação prévia (ex.: IHQ de alto custo)"
            slotProps={{ typography: { sx: { fontSize: 13.5 } } }}
          />

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => void criar()}
          disabled={ocupado || descricao.trim() === ''}
        >
          {ocupado ? 'Criando…' : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogoNovaPendencia({
  aberto,
  casos,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  casos: CasoNaFila[];
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [casoId, setCasoId] = useState('');
  const [tipo, setTipo] = useState('cadastral');
  const [descricao, setDescricao] = useState('');
  const [status, setStatus] = useState('aberta');
  const [nivelBloqueio, setNivelBloqueio] = useState('nao');
  const [etapaBloqueada, setEtapaBloqueada] = useState('');
  const [suspendePrazo, setSuspendePrazo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/solicitacoes/pendencias', {
        casoId,
        tipo,
        descricao: descricao.trim(),
        status,
        nivelBloqueio,
        ...(nivelBloqueio !== 'nao' && etapaBloqueada ? { etapaBloqueada } : {}),
        suspendePrazo,
      });
      setDescricao('');
      setNivelBloqueio('nao');
      setEtapaBloqueada('');
      setSuspendePrazo(false);
      aoCriar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar a pendência.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>Nova pendência</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Caso"
            value={casoId}
            onChange={(e) => setCasoId(e.target.value)}
            required
          >
            {casos.map((c) => (
              <MenuItem key={c.casoId} value={c.casoId}>
                {c.identificador} · {c.paciente}
              </MenuItem>
            ))}
          </TextField>

          <TextField select label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_PENDENCIA.map((t) => (
              <MenuItem key={t.valor} value={t.valor}>
                {t.rotulo}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            multiline
            minRows={2}
            helperText="O que falta para o caso avançar."
          />

          <TextField
            select
            label="Aguardando"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              'aberta',
              'aguardando_acao_interna',
              'aguardando_cliente',
              'aguardando_veterinario',
              'aguardando_patologista',
              'aguardando_autorizacao',
              'aguardando_execucao_tecnica',
            ].map((v) => (
              <MenuItem key={v} value={v}>
                {STATUS_LABEL[v]}
              </MenuItem>
            ))}
          </TextField>

          {/* M10 seções 21-22: a pendência INFORMA o impacto; o M07 decide. */}
          <TextField
            select
            label="Bloqueia o fluxo?"
            value={nivelBloqueio}
            onChange={(e) => setNivelBloqueio(e.target.value)}
          >
            <MenuItem value="nao">Não</MenuItem>
            <MenuItem value="parcial">Parcialmente</MenuItem>
            <MenuItem value="total">Sim — o caso não avança</MenuItem>
          </TextField>

          {nivelBloqueio !== 'nao' && (
            <TextField
              select
              label="Etapa impedida"
              value={etapaBloqueada}
              onChange={(e) => setEtapaBloqueada(e.target.value)}
              helperText="Vazio = o fluxo inteiro."
            >
              <MenuItem value="">Fluxo inteiro</MenuItem>
              {ETAPA.map((e) => (
                <MenuItem key={e} value={e}>
                  {e}
                </MenuItem>
              ))}
            </TextField>
          )}

          <FormControlLabel
            control={
              <Checkbox
                checked={suspendePrazo}
                onChange={(e) => setSuspendePrazo(e.target.checked)}
              />
            }
            label="Suspende a contagem do prazo enquanto aberta"
            slotProps={{ typography: { sx: { fontSize: 13.5 } } }}
          />

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => void criar()}
          disabled={ocupado || descricao.trim() === '' || casoId === ''}
        >
          {ocupado ? 'Criando…' : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- apoio ------------------------------------------------------------------

/** Botão que abre um diálogo com um campo de texto e confirma a ação. */
function AcaoComTexto({
  rotulo,
  titulo,
  campo,
  ajuda,
  cor,
  variante = 'outlined',
  obrigatorio = false,
  ocupado,
  aoConfirmar,
}: {
  rotulo: string;
  titulo: string;
  campo: string;
  ajuda?: string;
  cor: 'primary' | 'warning' | 'inherit';
  variante?: 'outlined' | 'contained';
  obrigatorio?: boolean;
  ocupado: boolean;
  aoConfirmar: (texto: string) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');

  return (
    <>
      <Button size="small" variant={variante} color={cor} onClick={() => setAberto(true)}>
        {rotulo}
      </Button>
      <Dialog open={aberto} onClose={() => setAberto(false)} fullWidth maxWidth="xs">
        <DialogTitle>{titulo}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            multiline
            minRows={2}
            required={obrigatorio}
            helperText={ajuda}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAberto(false)} disabled={ocupado}>
            Voltar
          </Button>
          <Button
            variant="contained"
            disabled={ocupado || (obrigatorio && texto.trim() === '')}
            onClick={() => {
              setAberto(false);
              void aoConfirmar(texto);
              setTexto('');
            }}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function ChipStatus({ status }: { status: string }) {
  const cor =
    status === 'concluida' || status === 'resolvida'
      ? 'success'
      : status === 'recusada' || status === 'cancelada'
        ? 'default'
        : status === 'aguardando_analise' || status === 'em_validacao'
          ? 'warning'
          : 'primary';

  return (
    <Chip
      size="small"
      variant="outlined"
      color={cor as 'success' | 'default' | 'warning' | 'primary'}
      label={STATUS_LABEL[status] ?? status}
    />
  );
}

function Detalhe({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 13 }}>{valor}</Typography>
    </Box>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <Box sx={{ py: 7, textAlign: 'center' }}>
      <InboxOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>{texto}</Typography>
    </Box>
  );
}
