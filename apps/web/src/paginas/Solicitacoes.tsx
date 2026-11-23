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
  type AmostraDoCaso,
  type MembroEquipe,
  type MensagemSolicitacao,
  type PendenciaResumo,
  type SolicitacaoResumo,
  type TipoPendencia,
  type TipoSolicitacao,
  type TrilhaSolicitacao,
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

/**
 * Rotulos de tipos ANTIGOS, gravados em texto antes do catalogo do M01
 * (quarta revisao). O formulario novo le o catalogo do servidor; esta lista
 * sobrevive so para a fila nao mostrar `coloracao_especial` cru num registro
 * de 2026. Nao acrescente nada aqui: tipo novo se cadastra na Administracao.
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
  /** Quem está logado — o atalho "Para mim" da pendência. */
  euId: string;
}

export function Solicitacoes({ permissoes, euId }: Props) {
  const [aba, setAba] = useState<Aba>('abertas');
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoResumo[]>([]);
  const [pendencias, setPendencias] = useState<PendenciaResumo[]>([]);
  const [casos, setCasos] = useState<CasoNaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogoSolicitacao, setDialogoSolicitacao] = useState(false);
  const [dialogoPendencia, setDialogoPendencia] = useState(false);
  const [tipos, setTipos] = useState<TipoSolicitacao[]>([]);
  const [tiposPendencia, setTiposPendencia] = useState<TipoPendencia[]>([]);
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);

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

  /**
   * Catálogo de tipos e equipe: o que o laboratório cadastrou na Administração
   * (quarta revisão) é o que o formulário oferece, e o destino é nominal.
   */
  useEffect(() => {
    api.get<TipoSolicitacao[]>('/solicitacoes/tipos').then(setTipos).catch(() => setTipos([]));
    api
      .get<TipoPendencia[]>('/solicitacoes/tipos-pendencia')
      .then(setTiposPendencia)
      .catch(() => setTiposPendencia([]));
    if (podeCriar) {
      api.get<MembroEquipe[]>('/usuarios/equipe').then(setEquipe).catch(() => setEquipe([]));
    }
  }, [podeCriar]);

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
        tipos={tipos}
        equipe={equipe}
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
        tiposPendencia={tiposPendencia}
        equipe={equipe}
        euId={euId}
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
  const [trilha, setTrilha] = useState<TrilhaSolicitacao | null>(null);
  const [novaMensagem, setNovaMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const aberta = STATUS_ABERTOS.includes(s.status);
  const vencida = aberta && s.prazoEm !== null && new Date(s.prazoEm) < new Date();

  const podeAnalisar = s.status === 'aguardando_analise' && permissoes.includes('solicitacao:aprovar');
  const podeConcluir =
    aberta && s.status !== 'aguardando_analise' && permissoes.includes('solicitacao:executar');
  const podeCancelar = aberta && permissoes.includes('solicitacao:cancelar');
  /**
   * Quarta revisão: quando o tipo tem fluxo, o caminho normal é avançar etapa
   * por etapa — a última delas é que conclui. "Concluir execução" continua ali
   * para o que não tem fluxo e para encerrar no meio, com o resultado técnico.
   */
  const temFluxo = s.totalEtapas > 0;
  const proximaEtapa = trilha?.etapas[s.etapaAtual] ?? null;
  const podeAvancar = podeConcluir && temFluxo && proximaEtapa !== null;

  function carregarTrilha() {
    api
      .get<TrilhaSolicitacao>(`/solicitacoes/${s.id}/trilha`)
      .then(setTrilha)
      .catch(() => setTrilha(null));
  }

  function expandir() {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && mensagens === null) {
      api
        .get<MensagemSolicitacao[]>(`/solicitacoes/${s.id}/mensagens`)
        .then(setMensagens)
        .catch(() => setMensagens([]));
      if (temFluxo) carregarTrilha();
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
            <Chip
              size="small"
              variant="outlined"
              label={s.nomeTipo ?? TIPO_LABEL[s.tipo] ?? s.tipo}
            />
            <ChipStatus status={s.status} />
            {/* Review: "cê precisa saber em que status tá — tá no estágio 3 de 4". */}
            {s.totalEtapas > 0 && s.status !== 'cancelada' && (
              <Chip
                size="small"
                color={s.etapaAtual >= s.totalEtapas ? 'success' : 'default'}
                variant={s.etapaAtual >= s.totalEtapas ? 'filled' : 'outlined'}
                label={
                  s.ultimaEtapa
                    ? `Etapa ${s.etapaAtual} de ${s.totalEtapas} · ${s.ultimaEtapa}`
                    : `Etapa 0 de ${s.totalEtapas} · ainda não iniciada`
                }
              />
            )}
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
          {temFluxo && trilha && <Trilha trilha={trilha} />}
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
              {podeAvancar && (
                <AcaoComTexto
                  rotulo={`Avançar: ${proximaEtapa!.rotulo}`}
                  cor="primary"
                  variante="contained"
                  titulo={proximaEtapa!.rotulo}
                  campo="Observação"
                  ajuda="Opcional — fica na trilha, com a data, a hora e o seu nome."
                  ocupado={ocupado}
                  aoConfirmar={(observacao) =>
                    agir(async () => {
                      await api.post(`/solicitacoes/${s.id}/etapa`, {
                        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
                      });
                      carregarTrilha();
                    }, 'Não foi possível avançar a etapa.')
                  }
                />
              )}
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

/**
 * O fluxo da solicitacao: o que ja aconteceu e o que falta, na mesma coluna.
 *
 * Quarta revisao com o Hugo: "tem um fluxo dele aqui embaixo... a Raquel deu
 * ok e recebeu, esta separando o bloco no dia cinco, foi enviado pro
 * processamento, a Alane recebeu tambem, e ai foi enviado pro patologista".
 * Cada linha cumprida traz quem clicou e quando; as que faltam ficam em
 * cinza, para a pessoa saber quanto resta antes de prometer prazo a alguem.
 */
function Trilha({ trilha }: { trilha: TrilhaSolicitacao }) {
  const feitas = new Map(trilha.andamento.map((a) => [a.ordem, a]));

  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
        FLUXO
      </Typography>
      <Stack spacing={0.75}>
        {trilha.etapas.map((etapa) => {
          const feita = feitas.get(etapa.ordem);
          return (
            <Stack key={etapa.ordem} direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
              <Box
                sx={{
                  width: 18,
                  flexShrink: 0,
                  textAlign: 'center',
                  fontSize: 12,
                  color: feita ? 'success.main' : 'text.disabled',
                }}
              >
                {feita ? '✓' : etapa.ordem}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: feita ? 600 : 400,
                    color: feita ? 'text.primary' : 'text.disabled',
                  }}
                >
                  {etapa.rotulo}
                  {etapa.setor && !feita ? (
                    <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}>
                      {` · ${etapa.setor}`}
                    </Box>
                  ) : null}
                </Typography>
                {feita && (
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                    {new Date(feita.registradoEm).toLocaleString('pt-BR')}
                    {feita.por ? ` · ${feita.por}` : ''}
                    {feita.observacao ? ` — ${feita.observacao}` : ''}
                  </Typography>
                )}
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </Box>
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
  tipos,
  equipe,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  casos: CasoNaFila[];
  tipos: TipoSolicitacao[];
  equipe: MembroEquipe[];
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [casoId, setCasoId] = useState('');
  const [tipoId, setTipoId] = useState('');
  const [subtipoId, setSubtipoId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [amostras, setAmostras] = useState<AmostraDoCaso[]>([]);
  const [amostraIds, setAmostraIds] = useState<string[]>([]);
  const [descricao, setDescricao] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [prioridade, setPrioridade] = useState('rotina');
  const [exigeAprovacao, setExigeAprovacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** O primeiro tipo do catálogo é o padrão — abrir vazio só dá trabalho. */
  useEffect(() => {
    if (!tipoId && tipos.length > 0) setTipoId(tipos[0]!.id);
  }, [tipoId, tipos]);

  const tipo = tipos.find((t) => t.id === tipoId) ?? null;

  /**
   * Aprovação prévia é característica do tipo (IHQ de alto custo). A caixa
   * segue ali para a exceção, mas nasce marcada quando o tipo já pede.
   */
  useEffect(() => {
    if (tipo) setExigeAprovacao(tipo.exigeAprovacao);
  }, [tipo]);

  /** Trocar o tipo zera o corante: PAS não é subtipo de "aprofundar corte". */
  useEffect(() => {
    setSubtipoId('');
  }, [tipoId]);

  /**
   * Quinta revisão: "digita DB28901, aparece DB28901 A, B e C; o usuário
   * escolhe qual — pode escolher apenas 1 dos 3 ou todos". As amostras só
   * fazem sentido depois de escolher o caso.
   */
  useEffect(() => {
    setAmostraIds([]);
    if (!casoId) {
      setAmostras([]);
      return;
    }
    api
      .get<AmostraDoCaso[]>(`/solicitacoes/casos/${casoId}/amostras`)
      .then(setAmostras)
      .catch(() => setAmostras([]));
  }, [casoId]);

  /**
   * Destino restrito ao perfil, quando o tipo diz para quem vai. O servidor
   * recusa de todo modo; esconder aqui é o que evita o erro acontecer.
   */
  const destinos =
    tipo && tipo.perfisDestino.length > 0
      ? equipe.filter((m) => m.perfis.some((chave) => tipo.perfisDestino.includes(chave)))
      : equipe;

  /** Destino escolhido que o novo tipo não aceita mais não pode ficar preso. */
  useEffect(() => {
    if (responsavelId && !destinos.some((m) => m.id === responsavelId)) setResponsavelId('');
  }, [destinos, responsavelId]);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/solicitacoes', {
        ...(casoId ? { casoId } : {}),
        ...(tipo ? { tipoId: tipo.id, tipo: tipo.chave } : { tipo: 'outra' }),
        ...(subtipoId ? { subtipoId } : {}),
        ...(responsavelId ? { responsavelId } : {}),
        ...(amostraIds.length > 0 ? { amostraIds } : {}),
        descricao: descricao.trim(),
        ...(justificativa.trim() ? { justificativa: justificativa.trim() } : {}),
        prioridade,
        exigeAprovacao,
      });
      setDescricao('');
      setJustificativa('');
      setResponsavelId('');
      setAmostraIds([]);
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

          <TextField
            select
            label="Tipo"
            value={tipoId}
            onChange={(e) => setTipoId(e.target.value)}
            disabled={tipos.length === 0}
            helperText={
              tipos.length === 0
                ? 'Nenhum tipo cadastrado — configure em Configurações › Solicitações.'
                : tipo?.descricao ?? ' '
            }
          >
            {tipos.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.nome}
              </MenuItem>
            ))}
          </TextField>

          {/*
            Segundo nível do catálogo. "Coloração especial" não é um pedido: é
            PAS, Ziehl-Neelsen, Gram… — e é o corante que vai no rótulo da
            demanda, não a categoria.
          */}
          {tipo && tipo.subtipos.length > 0 && (
            <TextField
              select
              label={`${tipo.nome} — qual`}
              value={subtipoId}
              onChange={(e) => setSubtipoId(e.target.value)}
              required
              helperText="Aparece no nome da demanda e na trilha."
            >
              {tipo.subtipos.map((sub) => (
                <MenuItem key={sub.id} value={sub.id}>
                  {sub.nome}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* O fluxo do tipo, antes de pedir: quem solicita vê por onde isso passa. */}
          {tipo && tipo.etapas.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
                FLUXO DESTE TIPO
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                {tipo.etapas.map((e) => `${e.rotulo}${e.automatica ? ' (automática)' : ''}`).join(' → ')}
              </Typography>
            </Box>
          )}

          {/*
            As amostras do caso. Cada uma escolhida vira uma solicitação
            própria: o bloco A pode voltar hoje e o C na sexta, e uma demanda
            só para os três esconderia isso.
          */}
          {amostras.length > 0 && (
            <SeletorDeAmostras
              amostras={amostras}
              escolhidas={amostraIds}
              aoMudar={setAmostraIds}
              rodape="Nenhuma marcada: o pedido é do caso inteiro."
            />
          )}

          <TextField
            select
            label="Destino"
            value={responsavelId}
            onChange={(e) => setResponsavelId(e.target.value)}
            helperText={
              responsavelId
                ? 'Fica no nome dessa pessoa — é assim que se sabe quem colocou a mão.'
                : `Sem nome, vai para o setor${tipo?.setorPadrao ? ` ${tipo.setorPadrao}` : ' do tipo'}.`
            }
          >
            <MenuItem value="">
              Setor{tipo?.setorPadrao ? ` · ${tipo.setorPadrao}` : ''}
            </MenuItem>
            {destinos.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.nome}
                {m.setor ? ` · ${m.setor}` : ''}
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
          disabled={
            ocupado ||
            descricao.trim() === '' ||
            (tipo !== null && tipo.subtipos.length > 0 && subtipoId === '')
          }
        >
          {ocupado
            ? 'Criando…'
            : amostraIds.length > 1
              ? `Criar ${amostraIds.length} solicitações`
              : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogoNovaPendencia({
  aberto,
  casos,
  tiposPendencia,
  equipe,
  euId,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  casos: CasoNaFila[];
  tiposPendencia: TipoPendencia[];
  equipe: MembroEquipe[];
  /** Para o atalho "Para mim" — o uso que a quinta revisão descreve. */
  euId: string | null;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [casoId, setCasoId] = useState('');
  const [tipoId, setTipoId] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [amostras, setAmostras] = useState<AmostraDoCaso[]>([]);
  const [amostraIds, setAmostraIds] = useState<string[]>([]);
  const [descricao, setDescricao] = useState('');
  const [status, setStatus] = useState('aberta');
  const [nivelBloqueio, setNivelBloqueio] = useState('nao');
  const [etapaBloqueada, setEtapaBloqueada] = useState('');
  const [suspendePrazo, setSuspendePrazo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!tipoId && tiposPendencia.length > 0) setTipoId(tiposPendencia[0]!.id);
  }, [tipoId, tiposPendencia]);

  const tipoEscolhido = tiposPendencia.find((t) => t.id === tipoId) ?? null;

  /**
   * O catálogo traz o bloqueio que o laboratório decidiu como padrão para
   * aquele tipo — "Autorização" trava o caso, "Cadastral" não. Quem cria
   * ainda muda no campo abaixo; o padrão só evita a escolha repetida.
   */
  useEffect(() => {
    if (tipoEscolhido) setNivelBloqueio(tipoEscolhido.bloqueiaPadrao);
  }, [tipoEscolhido]);

  useEffect(() => {
    setAmostraIds([]);
    if (!casoId) {
      setAmostras([]);
      return;
    }
    api
      .get<AmostraDoCaso[]>(`/solicitacoes/casos/${casoId}/amostras`)
      .then(setAmostras)
      .catch(() => setAmostras([]));
  }, [casoId]);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/solicitacoes/pendencias', {
        casoId,
        ...(tipoEscolhido ? { tipoId: tipoEscolhido.id, tipo: tipoEscolhido.nome } : {}),
        ...(responsavelId ? { responsavelId } : {}),
        ...(amostraIds.length > 0 ? { amostraIds } : {}),
        descricao: descricao.trim(),
        status,
        nivelBloqueio,
        ...(nivelBloqueio !== 'nao' && etapaBloqueada ? { etapaBloqueada } : {}),
        suspendePrazo,
      });
      setDescricao('');
      setEtapaBloqueada('');
      setSuspendePrazo(false);
      setResponsavelId('');
      setAmostraIds([]);
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

          <TextField
            select
            label="Tipo"
            value={tipoId}
            onChange={(e) => setTipoId(e.target.value)}
            disabled={tiposPendencia.length === 0}
            helperText={
              tiposPendencia.length === 0
                ? 'Nenhum tipo cadastrado — configure em Configurações › Solicitações.'
                : ' '
            }
          >
            {tiposPendencia.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.nome}
              </MenuItem>
            ))}
          </TextField>

          {/*
            Destino nominal. Quinta revisão: "o patologista poderá criar
            pendências para ele próprio ou enviar para outro usuário" — e o
            atalho "Para mim" é o caso mais comum, o lembrete que não se perde.
          */}
          <TextField
            select
            label="Para quem"
            value={responsavelId}
            onChange={(e) => setResponsavelId(e.target.value)}
            helperText={
              responsavelId
                ? 'Aparece na tela inicial dessa pessoa.'
                : 'Sem nome, a pendência fica na lista geral do laboratório.'
            }
          >
            <MenuItem value="">Ninguém em especial</MenuItem>
            {euId && <MenuItem value={euId}>Para mim</MenuItem>}
            {equipe
              .filter((m) => m.id !== euId)
              .map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.nome}
                  {m.setor ? ` · ${m.setor}` : ''}
                </MenuItem>
              ))}
          </TextField>

          {amostras.length > 0 && (
            <SeletorDeAmostras
              amostras={amostras}
              escolhidas={amostraIds}
              aoMudar={setAmostraIds}
              rodape="Nenhuma marcada: a pendência é do caso inteiro."
            />
          )}

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
          disabled={ocupado || descricao.trim() === '' || casoId === '' || tipoId === ''}
        >
          {ocupado
            ? 'Criando…'
            : amostraIds.length > 1
              ? `Criar ${amostraIds.length} pendências`
              : 'Criar'}
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

/**
 * As amostras do caso, para marcar o alvo do pedido.
 *
 * Quinta revisao: "digita DB28901, aparece DB28901 A, B e C; o usuario escolhe
 * qual - pode escolher apenas 1 dos 3 ou todos". "Todas" existe porque tres
 * cliques para o caso de tres fragmentos e o que faz a pessoa desistir e pedir
 * pelo WhatsApp - que e o problema que o modulo inteiro ataca.
 */
function SeletorDeAmostras({
  amostras,
  escolhidas,
  aoMudar,
  rodape,
}: {
  amostras: AmostraDoCaso[];
  escolhidas: string[];
  aoMudar: (ids: string[]) => void;
  rodape: string;
}) {
  const todas = escolhidas.length === amostras.length;

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
          AMOSTRAS
        </Typography>
        <Button
          size="small"
          onClick={() => aoMudar(todas ? [] : amostras.map((a) => a.id))}
          sx={{ fontSize: 12, minWidth: 0 }}
        >
          {todas ? 'Limpar' : 'Todas'}
        </Button>
      </Stack>
      <Stack>
        {amostras.map((a) => (
          <FormControlLabel
            key={a.id}
            control={
              <Checkbox
                size="small"
                checked={escolhidas.includes(a.id)}
                onChange={(e) =>
                  aoMudar(
                    e.target.checked
                      ? [...escolhidas, a.id]
                      : escolhidas.filter((id) => id !== a.id),
                  )
                }
              />
            }
            label={
              <span>
                <Typography
                  component="span"
                  sx={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {a.identificador}
                </Typography>
                {a.descricao && (
                  <Typography
                    component="span"
                    sx={{ fontSize: 12.5, color: 'text.secondary', ml: 0.75 }}
                  >
                    {a.descricao}
                  </Typography>
                )}
              </span>
            }
          />
        ))}
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{rodape}</Typography>
    </Box>
  );
}
