import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  CONDICAO_OBJETO,
  CONDICAO_OBJETO_LABEL,
  FINALIDADE_USO,
  FINALIDADE_USO_LABEL,
  METODO_DESCARTE,
  METODO_DESCARTE_LABEL,
  RESTRICAO_OBJETO,
  RESTRICAO_OBJETO_LABEL,
  STATUS_EMPRESTIMO_LABEL,
  STATUS_OBJETO_BIOLOGICO,
  STATUS_OBJETO_BIOLOGICO_LABEL,
  TIPO_EMPRESTIMO_LABEL,
  TIPO_MOVIMENTACAO_OBJETO_LABEL,
  TIPO_OBJETO_BIOLOGICO,
  TIPO_OBJETO_BIOLOGICO_LABEL,
  type AchadoGuardian,
  type CondicaoObjeto,
  type FinalidadeUso,
  type MetodoDescarte,
  type RestricaoObjeto,
  type StatusObjetoBiologico,
  type TipoObjetoBiologico,
} from '@lapato/shared';
import {
  api,
  ErroApi,
  type ElegiveisDescarte,
  type EmprestimoLista,
  type FichaObjetoBiologico,
  type InventarioLista,
  type LocalFisicoAdmin,
  type MapaAcervo,
  type PosicaoAcervo,
  type ObjetoBiologicoLista,
} from '../api';
import { ConferenciaGuardian } from './BloqueioGuardian';

/**
 * M18 - Bioteca e Gestao de Acervo Biologico.
 *
 * A tela existe para responder as perguntas da secao 115 sem consultar
 * ninguem: onde esta, ainda existe, esta reservado, foi emprestado, para quem,
 * quando volta, quando pode ser descartado.
 *
 * Tres escolhas que vem direto da documentacao:
 *
 * - **O que saiu continua na tela.** A secao 33 e explicita: material retirado
 *   nao desaparece do sistema. O mapa lista o que esta fora, com a posicao de
 *   origem - senao seria material que ninguem procura.
 * - **A lista de descarte mostra os bloqueados.** A secao 50 quer a decisao
 *   confirmada por quem tem autoridade, e para decidir e preciso ver por que
 *   cada material vencido continua no armario.
 * - **Esgotado aparece antes do pedido, nao depois.** A secao 25 pede que o
 *   esgotamento seja "visivel ao patologista antes de solicitar novos
 *   complementares" - por isso ele e um chip vermelho na lista, e nao um
 *   detalhe da ficha.
 */

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const COR_STATUS: Partial<
  Record<StatusObjetoBiologico, 'default' | 'primary' | 'success' | 'warning' | 'error'>
> = {
  disponivel: 'success',
  arquivado: 'success',
  reservado: 'primary',
  emprestado: 'warning',
  em_uso: 'warning',
  enviado: 'warning',
  aguardando_devolucao: 'warning',
  parcialmente_consumido: 'primary',
  proximo_esgotamento: 'warning',
  esgotado: 'error',
  bloqueado: 'error',
  nao_localizado: 'error',
  perdido: 'error',
  descartado: 'default',
};

function data(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Bioteca({ permissoes }: { permissoes: string[] }) {
  const [aba, setAba] = useState<'acervo' | 'mapa' | 'emprestimos' | 'inventarios' | 'descarte'>(
    'acervo',
  );
  const [lista, setLista] = useState<ObjetoBiologicoLista[] | null>(null);
  const [mapa, setMapa] = useState<MapaAcervo | null>(null);
  const [emprestimos, setEmprestimos] = useState<EmprestimoLista[] | null>(null);
  const [inventarios, setInventarios] = useState<InventarioLista[] | null>(null);
  const [elegiveis, setElegiveis] = useState<ElegiveisDescarte | null>(null);
  const [achados, setAchados] = useState<AchadoGuardian[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<TipoObjetoBiologico | 'todos'>('todos');
  const [filtroStatus, setFiltroStatus] = useState<StatusObjetoBiologico | 'todos'>('todos');
  const [busca, setBusca] = useState('');
  const [arquivando, setArquivando] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const podeArquivar = permissoes.includes('bioteca:movimentar');
  const podeDescartar = permissoes.includes('bioteca:descartar');
  const podeInventariar = permissoes.includes('bioteca:inventariar');

  const recarregar = useCallback(() => {
    const q = new URLSearchParams();
    if (filtroTipo !== 'todos') q.set('tipo', filtroTipo);
    if (filtroStatus !== 'todos') q.set('status', filtroStatus);
    if (busca.trim()) q.set('q', busca.trim());

    api
      .get<ObjetoBiologicoLista[]>(`/bioteca?${q.toString()}`)
      .then(setLista)
      .catch(() => setErro('Não foi possível carregar o acervo.'));
    api.get<MapaAcervo>('/bioteca/mapa').then(setMapa).catch(() => undefined);
    api
      .get<EmprestimoLista[]>('/bioteca/emprestimos')
      .then(setEmprestimos)
      .catch(() => undefined);
    api
      .get<InventarioLista[]>('/bioteca/inventarios')
      .then(setInventarios)
      .catch(() => undefined);
    api
      .get<ElegiveisDescarte>('/bioteca/descarte/elegiveis')
      .then(setElegiveis)
      .catch(() => undefined);
    api
      .get<AchadoGuardian[]>('/bioteca/conferencia')
      .then(setAchados)
      .catch(() => undefined);
  }, [filtroTipo, filtroStatus, busca]);

  useEffect(recarregar, [recarregar]);

  /**
   * Indicadores da secao 88.
   *
   * "Fora do acervo" conta emprestado e em uso juntos porque, para quem olha o
   * painel, os dois significam a mesma coisa: material que nao esta na gaveta.
   */
  const indicadores = useMemo(() => {
    const todos = lista ?? [];
    const atrasados = (emprestimos ?? []).filter((e) => e.diasAtraso > 0 && e.pendentes > 0);
    return [
      { rotulo: 'No acervo', valor: todos.filter((o) => o.localCodigo).length },
      {
        rotulo: 'Fora do acervo',
        valor: todos.filter((o) => ['em_uso', 'emprestado', 'enviado'].includes(o.status)).length,
      },
      {
        rotulo: 'Esgotados',
        valor: todos.filter((o) => o.status === 'esgotado').length,
        alerta: true,
      },
      { rotulo: 'Empréstimos atrasados', valor: atrasados.length, alerta: atrasados.length > 0 },
    ];
  }, [lista, emprestimos]);

  return (
    <Box sx={{ maxWidth: 1080 }}>
      <Stack
        direction="row"
        sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h2">Bioteca e Acervo Biológico</Typography>
        {podeArquivar && (
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setArquivando(true)}
          >
            Arquivar material
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Onde está cada material preservado, o que ainda existe e o que impede o descarte.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ mb: 3, flexWrap: 'wrap' }}>
        {indicadores.map((i) => (
          <Card key={i.rotulo} sx={{ px: 2, py: 1.5, minWidth: 160 }}>
            <Typography
              sx={{
                fontSize: 24,
                fontWeight: 600,
                color: i.alerta && i.valor > 0 ? 'warning.main' : 'text.primary',
              }}
            >
              {i.valor}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{i.rotulo}</Typography>
          </Card>
        ))}
      </Stack>

      {achados.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <ConferenciaGuardian achados={achados} titulo="Conferências do acervo" />
        </Box>
      )}

      <Tabs
        value={aba}
        onChange={(_, v: typeof aba) => setAba(v)}
        sx={{ mb: 2 }}
        variant="scrollable"
      >
        <Tab value="acervo" label="Acervo" />
        <Tab value="mapa" label="Mapa de posições" />
        <Tab value="emprestimos" label="Empréstimos" />
        <Tab value="inventarios" label="Inventários" />
        <Tab value="descarte" label="Destinação" />
      </Tabs>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {aba === 'acervo' && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField
              size="small"
              label="Buscar"
              placeholder="Identificador, descrição ou órgão"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              select
              label="Tipo"
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as TipoObjetoBiologico | 'todos')}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="todos">Todos</MenuItem>
              {TIPO_OBJETO_BIOLOGICO.map((t) => (
                <MenuItem key={t} value={t}>
                  {TIPO_OBJETO_BIOLOGICO_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label="Situação"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as StatusObjetoBiologico | 'todos')}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="todos">Todas</MenuItem>
              {STATUS_OBJETO_BIOLOGICO.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_OBJETO_BIOLOGICO_LABEL[s]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {lista === null ? (
            <Stack spacing={1}>
              <Skeleton variant="rounded" height={64} />
              <Skeleton variant="rounded" height={64} />
            </Stack>
          ) : lista.length === 0 ? (
            <Alert severity="info">Nenhum material com esses critérios.</Alert>
          ) : (
            <Stack spacing={1}>
              {lista.map((o) => (
                <Card key={o.id} sx={{ p: 2, cursor: 'pointer' }} onClick={() => setFichaId(o.id)}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    sx={{ justifyContent: 'space-between', gap: 1 }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 600 }}>
                          {o.identificador}
                        </Typography>
                        <Chip
                          size="small"
                          color={COR_STATUS[o.status as StatusObjetoBiologico] ?? 'default'}
                          label={
                            STATUS_OBJETO_BIOLOGICO_LABEL[o.status as StatusObjetoBiologico] ??
                            o.status
                          }
                        />
                        {/* Secao 85: a restricao acompanha o objeto e muda o que se pode fazer. */}
                        {o.restricoes.map((r) => (
                          <Chip
                            key={r}
                            size="small"
                            color="error"
                            variant="outlined"
                            label={RESTRICAO_OBJETO_LABEL[r as RestricaoObjeto] ?? r}
                          />
                        ))}
                        {o.preservacaoEspecial && (
                          <Chip
                            size="small"
                            color="secondary"
                            variant="outlined"
                            label="Preservação especial"
                          />
                        )}
                      </Stack>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                        {TIPO_OBJETO_BIOLOGICO_LABEL[o.tipo as TipoObjetoBiologico] ?? o.tipo}
                        {o.descricao ? ` · ${o.descricao}` : ''}
                        {o.casoIdentificador ? ` · ${o.casoIdentificador}` : ''}
                      </Typography>
                    </Box>

                    <Box sx={{ flexShrink: 0, textAlign: { md: 'right' } }}>
                      <Typography sx={{ ...MONO, fontSize: 13 }}>
                        {o.localCodigo ?? o.localizacaoDescritiva ?? 'Sem localização'}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {o.quantidadeInicial > 1
                          ? `${o.quantidadeDisponivel} de ${o.quantidadeInicial}`
                          : `Guarda até ${data(o.retencaoAte)}`}
                      </Typography>
                    </Box>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </>
      )}

      {aba === 'mapa' && <Mapa mapa={mapa} aoAbrir={setFichaId} />}

      {aba === 'emprestimos' && <Emprestimos lista={emprestimos} aoMudar={recarregar} />}

      {aba === 'inventarios' && (
        <Inventarios lista={inventarios} podeInventariar={podeInventariar} aoMudar={recarregar} />
      )}

      {aba === 'descarte' && (
        <Destinacao dados={elegiveis} podeDescartar={podeDescartar} aoMudar={recarregar} />
      )}

      <DialogoArquivamento
        aberto={arquivando}
        aoFechar={() => setArquivando(false)}
        aoSalvar={() => {
          setArquivando(false);
          recarregar();
        }}
      />

      <DialogoFicha
        objetoId={fichaId}
        permissoes={permissoes}
        aoFechar={() => setFichaId(null)}
        aoMudar={recarregar}
      />
    </Box>
  );
}

/**
 * Mapa de posicoes e ocupacao (secoes 17, 19 e 20).
 *
 * A secao 17 descreve a localizacao como hierarquia - Unidade → Sala →
 * Equipamento → Estante → Caixa → Posicao - e e assim que ela e desenhada:
 * cada equipamento vira um bloco, com as suas posicoes dentro. Numa lista
 * plana, as dezenas de posicoes de uma camara afogam os dois armarios que a
 * Bioteca de fato usa.
 *
 * A barra de ocupacao existe porque a secao 20 pede o percentual - "Freezer
 * -80 °C 01: 87% ocupado" - e planejar espaco a olho, contando caixas, e
 * exatamente o que o modulo veio substituir.
 */
function Mapa({ mapa, aoAbrir }: { mapa: MapaAcervo | null; aoAbrir: (id: string) => void }) {
  if (!mapa) return <Skeleton variant="rounded" height={200} />;

  const porPai = new Map<string, PosicaoAcervo[]>();
  for (const p of mapa.posicoes) {
    if (!p.paiId) continue;
    porPai.set(p.paiId, [...(porPai.get(p.paiId) ?? []), p]);
  }
  const raizes = mapa.posicoes.filter((p) => !p.paiId);
  /** Filho cujo pai foi inativado ou pertence a outra unidade: nao pode sumir. */
  const orfaos = mapa.posicoes.filter(
    (p) => p.paiId && !mapa.posicoes.some((r) => r.id === p.paiId),
  );

  return (
    <Stack spacing={2}>
      {mapa.posicoes.length === 0 && (
        <Alert severity="info">
          <AlertTitle>Nenhum local físico cadastrado</AlertTitle>
          O acervo precisa de armários, gavetas e freezers antes de guardar material. Cadastre-os
          em Administração → Locais físicos.
        </Alert>
      )}

      {[...raizes, ...orfaos].map((raiz) => {
        const filhos = porPai.get(raiz.id) ?? [];
        const ocupacao = raiz.ocupacao + filhos.reduce((t, f) => t + f.ocupacao, 0);
        const capacidade =
          raiz.capacidade == null && filhos.length === 0
            ? null
            : (raiz.capacidade ?? 0) + filhos.reduce((t, f) => t + (f.capacidade ?? 0), 0);
        const percentual =
          capacidade && capacidade > 0 ? Math.round((ocupacao / capacidade) * 100) : null;

        return (
          <Card key={raiz.id} sx={{ p: 2 }}>
            <Stack
              direction="row"
              sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1, gap: 1 }}
            >
              <Box>
                <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 600 }}>
                  {raiz.codigo}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {raiz.nome}
                  {raiz.condicaoAmbiental ? ` · ${raiz.condicaoAmbiental}` : ''}
                  {filhos.length > 0 ? ` · ${filhos.length} posição(ões)` : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {/* Secao 62: equipamento fora de serviço não recebe posição nova. */}
                {raiz.status !== 'operacional' && (
                  <Chip size="small" color="error" variant="outlined" label={raiz.status} />
                )}
                <Typography sx={{ ...MONO, fontSize: 13 }}>
                  {ocupacao}
                  {capacidade != null ? `/${capacidade}` : ''}
                  {percentual != null ? ` · ${percentual}%` : ''}
                </Typography>
              </Stack>
            </Stack>

            {capacidade != null && capacidade > 0 && (
              <LinearProgress
                variant="determinate"
                value={Math.min(100, percentual ?? 0)}
                color={(percentual ?? 0) >= 90 ? 'warning' : 'primary'}
                /* O trilho fica neutro de propósito: com o trilho na cor da
                   barra, 0% se lê como "cheio" numa olhada rápida - e o mapa
                   existe justamente para ser lido de relance. */
                sx={{ height: 8, borderRadius: 1, bgcolor: 'action.hover' }}
              />
            )}

            {filhos.length > 0 && (
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
                {filhos.map((f) => (
                  <Chip
                    key={f.id}
                    size="small"
                    variant={f.ocupacao > 0 ? 'filled' : 'outlined'}
                    color={f.ocupacao > 0 ? 'primary' : 'default'}
                    label={`${f.codigo}${f.capacidade != null ? ` ${f.ocupacao}/${f.capacidade}` : f.ocupacao > 0 ? ` ${f.ocupacao}` : ''}`}
                  />
                ))}
              </Stack>
            )}
          </Card>
        );
      })}

      {/* Secao 33: o que saiu continua na tela, com a posicao de volta. */}
      <Card sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Fora do acervo</Typography>
        {mapa.foraDoAcervo.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Nenhum material fora das posições.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {mapa.foraDoAcervo.map((o) => (
              <Stack
                key={o.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }}
                onClick={() => aoAbrir(o.id)}
              >
                <Typography sx={{ ...MONO, fontSize: 13 }}>{o.identificador}</Typography>
                <Chip
                  size="small"
                  color={COR_STATUS[o.status as StatusObjetoBiologico] ?? 'default'}
                  label={
                    STATUS_OBJETO_BIOLOGICO_LABEL[o.status as StatusObjetoBiologico] ?? o.status
                  }
                />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  em {o.localizacaoDescritiva ?? '—'}
                  {o.origemCodigo ? ` · volta para ${o.origemCodigo}` : ''}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

/** Empréstimos e vencimentos (secoes 38-39). */
function Emprestimos({
  lista,
  aoMudar,
}: {
  lista: EmprestimoLista[] | null;
  aoMudar: () => void;
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  if (!lista) return <Skeleton variant="rounded" height={200} />;
  if (lista.length === 0) return <Alert severity="info">Nenhum empréstimo registrado.</Alert>;

  return (
    <>
      <Stack spacing={1}>
        {lista.map((e) => (
          <Card key={e.id} sx={{ p: 2, cursor: 'pointer' }} onClick={() => setAberto(e.id)}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{ justifyContent: 'space-between', gap: 1 }}
            >
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 600 }}>
                    {e.identificador}
                  </Typography>
                  <Chip
                    size="small"
                    color={
                      e.status === 'devolvido'
                        ? 'success'
                        : e.diasAtraso > 0
                          ? 'error'
                          : 'default'
                    }
                    label={
                      STATUS_EMPRESTIMO_LABEL[e.status as keyof typeof STATUS_EMPRESTIMO_LABEL] ??
                      e.status
                    }
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={TIPO_EMPRESTIMO_LABEL[e.tipo as keyof typeof TIPO_EMPRESTIMO_LABEL]}
                  />
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {e.destinatario} ·{' '}
                  {FINALIDADE_USO_LABEL[e.finalidade as FinalidadeUso] ?? e.finalidade}
                </Typography>
              </Box>
              <Box sx={{ textAlign: { md: 'right' } }}>
                <Typography sx={{ fontSize: 13 }}>Prazo: {data(e.prazoDevolucao)}</Typography>
                <Typography
                  sx={{
                    fontSize: 12,
                    color: e.diasAtraso > 0 && e.pendentes > 0 ? 'error.main' : 'text.secondary',
                  }}
                >
                  {/* Secao 39: o empréstimo não encerra sozinho — o pendente aparece. */}
                  {e.pendentes > 0
                    ? `${e.pendentes} de ${e.itens} sem devolver${e.diasAtraso > 0 ? ` · ${e.diasAtraso} dia(s) de atraso` : ''}`
                    : `${e.itens} material(is) devolvido(s)`}
                </Typography>
              </Box>
            </Stack>
          </Card>
        ))}
      </Stack>

      <DialogoEmprestimo
        emprestimoId={aberto}
        aoFechar={() => setAberto(null)}
        aoMudar={aoMudar}
      />
    </>
  );
}

function DialogoEmprestimo({
  emprestimoId,
  aoFechar,
  aoMudar,
}: {
  emprestimoId: string | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [dados, setDados] = useState<Record<string, unknown> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!emprestimoId) return;
    api
      .get<Record<string, unknown>>(`/bioteca/emprestimos/${emprestimoId}`)
      .then(setDados)
      .catch(() => setErro('Não foi possível carregar o empréstimo.'));
  }, [emprestimoId]);

  useEffect(() => {
    setDados(null);
    setErro(null);
    carregar();
  }, [carregar]);

  const itens = (dados?.itens ?? []) as Array<{
    objetoId: string;
    identificador: string;
    tipo: string;
    descricao: string | null;
    devolvidoEm: string | null;
  }>;

  return (
    <Dialog open={emprestimoId != null} onClose={aoFechar} maxWidth="sm" fullWidth>
      <DialogTitle>{(dados?.identificador as string) ?? 'Empréstimo'}</DialogTitle>
      <DialogContent dividers>
        {erro && <Alert severity="error">{erro}</Alert>}
        {!dados ? (
          <Skeleton variant="rounded" height={120} />
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography sx={{ fontSize: 13 }}>{dados.destinatario as string}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {(dados.contatoDestinatario as string) ?? 'Sem contato registrado'} · prazo{' '}
                {data(dados.prazoDevolucao as string)}
              </Typography>
              {(dados.condicoes as string) && (
                <Typography sx={{ fontSize: 12, mt: 1 }}>{dados.condicoes as string}</Typography>
              )}
            </Box>
            <Divider />
            <Stack spacing={1}>
              {itens.map((i) => (
                <Stack
                  key={i.objetoId}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Box>
                    <Typography sx={{ ...MONO, fontSize: 13 }}>{i.identificador}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {TIPO_OBJETO_BIOLOGICO_LABEL[i.tipo as TipoObjetoBiologico] ?? i.tipo}
                      {i.descricao ? ` · ${i.descricao}` : ''}
                    </Typography>
                  </Box>
                  {i.devolvidoEm ? (
                    <Chip size="small" color="success" label={`Devolvido ${data(i.devolvidoEm)}`} />
                  ) : (
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await api.post(`/bioteca/emprestimos/${emprestimoId}/devolucao`, {
                            objetoId: i.objetoId,
                          });
                          carregar();
                          aoMudar();
                        } catch (e) {
                          setErro(e instanceof ErroApi ? e.detalhe : 'Falha ao devolver.');
                        }
                      }}
                    >
                      Registrar devolução
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Inventarios (secoes 54-57). */
function Inventarios({
  lista,
  podeInventariar,
  aoMudar,
}: {
  lista: InventarioLista[] | null;
  podeInventariar: boolean;
  aoMudar: () => void;
}) {
  const [locais, setLocais] = useState<LocalFisicoAdmin[]>([]);
  const [localId, setLocalId] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<LocalFisicoAdmin[]>('/administracao/locais')
      .then((l) => setLocais(l.filter((x) => !x.inativadoEm)))
      .catch(() => undefined);
  }, []);

  return (
    <Stack spacing={2}>
      {podeInventariar && (
        <Card sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1.5 }}>Novo inventário</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              select
              label="Local"
              value={localId}
              onChange={(e) => setLocalId(e.target.value)}
              sx={{ flex: 1 }}
            >
              {locais.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.codigo} — {l.nome}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              disabled={!localId}
              onClick={async () => {
                try {
                  const local = locais.find((l) => l.id === localId);
                  await api.post('/bioteca/inventarios', {
                    localId,
                    descricao: `Inventário — ${local?.nome ?? ''}`,
                  });
                  setLocalId('');
                  aoMudar();
                } catch (e) {
                  setErro(e instanceof ErroApi ? e.detalhe : 'Falha ao abrir inventário.');
                }
              }}
            >
              Abrir
            </Button>
          </Stack>
          {erro && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {erro}
            </Alert>
          )}
        </Card>
      )}

      {!lista ? (
        <Skeleton variant="rounded" height={120} />
      ) : lista.length === 0 ? (
        <Alert severity="info">Nenhum inventário registrado.</Alert>
      ) : (
        <Stack spacing={1}>
          {lista.map((i) => (
            <Card key={i.id} sx={{ p: 2 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                sx={{ justifyContent: 'space-between', gap: 1 }}
              >
                <Box>
                  <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 600 }}>
                    {i.identificador}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {i.descricao ?? i.localCodigo ?? '—'} · aberto em {dataHora(i.iniciadoEm)}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: { md: 'right' } }}>
                  {i.concluidoEm && i.resumo ? (
                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                      <Chip size="small" label={`${i.resumo.encontrados} encontrados`} />
                      {/* Secao 56: a divergencia e o produto valioso do inventario. */}
                      {i.resumo.naoLocalizados > 0 && (
                        <Chip
                          size="small"
                          color="error"
                          label={`${i.resumo.naoLocalizados} não localizados`}
                        />
                      )}
                      {i.resumo.posicaoIncorreta > 0 && (
                        <Chip
                          size="small"
                          color="warning"
                          label={`${i.resumo.posicaoIncorreta} fora de lugar`}
                        />
                      )}
                      {i.resumo.naoCadastrados > 0 && (
                        <Chip
                          size="small"
                          color="warning"
                          label={`${i.resumo.naoCadastrados} não cadastrados`}
                        />
                      )}
                    </Stack>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={async () => {
                        try {
                          await api.post(`/bioteca/inventarios/${i.id}/conclusao`);
                          aoMudar();
                        } catch (e) {
                          setErro(e instanceof ErroApi ? e.detalhe : 'Falha ao concluir.');
                        }
                      }}
                    >
                      Concluir
                    </Button>
                  )}
                </Box>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Destinacao final (secoes 49-53).
 *
 * A lista de bloqueados vem primeiro por escolha: quem abre esta aba quer
 * limpar o armario, e a pergunta util nao e "o que posso descartar" - e "por
 * que aquele lote vencido continua aqui".
 */
function Destinacao({
  dados,
  podeDescartar,
  aoMudar,
}: {
  dados: ElegiveisDescarte | null;
  podeDescartar: boolean;
  aoMudar: () => void;
}) {
  const [selecao, setSelecao] = useState<string[]>([]);
  const [metodo, setMetodo] = useState<MetodoDescarte>('incineracao');
  const [empresa, setEmpresa] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  if (!dados) return <Skeleton variant="rounded" height={200} />;

  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>
          Elegíveis para destinação ({dados.elegiveis.length})
        </Typography>
        {dados.elegiveis.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Nenhum material livre para destinação.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {dados.elegiveis.map((o) => (
              <Stack
                key={o.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Chip
                  size="small"
                  color={selecao.includes(o.id) ? 'primary' : 'default'}
                  variant={selecao.includes(o.id) ? 'filled' : 'outlined'}
                  label={o.identificador}
                  onClick={
                    podeDescartar
                      ? () =>
                          setSelecao((s) =>
                            s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id],
                          )
                      : undefined
                  }
                />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {TIPO_OBJETO_BIOLOGICO_LABEL[o.tipo as TipoObjetoBiologico] ?? o.tipo}
                  {o.descricao ? ` · ${o.descricao}` : ''} · guarda até {data(o.retencaoAte)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        {podeDescartar && selecao.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                size="small"
                select
                label="Método"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as MetodoDescarte)}
                sx={{ minWidth: 220 }}
              >
                {METODO_DESCARTE.map((m) => (
                  <MenuItem key={m} value={m}>
                    {METODO_DESCARTE_LABEL[m]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Empresa responsável"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                variant="contained"
                color="error"
                onClick={async () => {
                  try {
                    await api.post('/bioteca/descarte', {
                      metodo,
                      empresa: empresa || null,
                      objetoIds: selecao,
                    });
                    setSelecao([]);
                    setEmpresa('');
                    setErro(null);
                    aoMudar();
                  } catch (e) {
                    setErro(e instanceof ErroApi ? e.detalhe : 'Falha ao destinar.');
                  }
                }}
              >
                Destinar {selecao.length} material(is)
              </Button>
            </Stack>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
              O registro não é apagado: o material passa a constar como destinado e o histórico
              continua consultável.
            </Typography>
          </>
        )}

        {erro && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {erro}
          </Alert>
        )}
      </Card>

      <Card sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>
          Retidos por algum impedimento ({dados.bloqueados.length})
        </Typography>
        {dados.bloqueados.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Nenhum material retido.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {dados.bloqueados.map((o) => (
              <Box key={o.id}>
                <Typography sx={{ ...MONO, fontSize: 13 }}>{o.identificador}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{o.motivo}</Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

/** Arquivamento (secao 114). */
function DialogoArquivamento({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [tipo, setTipo] = useState<TipoObjetoBiologico>('bloco_parafina');
  const [descricao, setDescricao] = useState('');
  const [orgao, setOrgao] = useState('');
  const [localId, setLocalId] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [locais, setLocais] = useState<LocalFisicoAdmin[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    api
      .get<LocalFisicoAdmin[]>('/administracao/locais')
      .then((l) => setLocais(l.filter((x) => !x.inativadoEm)))
      .catch(() => undefined);
  }, [aberto]);

  return (
    <Dialog open={aberto} onClose={aoFechar} maxWidth="sm" fullWidth>
      <DialogTitle>Arquivar material no acervo</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            select
            size="small"
            label="Tipo de material"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoObjetoBiologico)}
          >
            {TIPO_OBJETO_BIOLOGICO.map((t) => (
              <MenuItem key={t} value={t}>
                {TIPO_OBJETO_BIOLOGICO_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <TextField
            size="small"
            label="Órgão"
            value={orgao}
            onChange={(e) => setOrgao(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Posição no acervo"
            value={localId}
            onChange={(e) => setLocalId(e.target.value)}
            helperText="Pode ficar em branco: material recém-produzido existe antes de ter gaveta."
          >
            <MenuItem value="">Sem posição definida</MenuItem>
            {locais.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.codigo} — {l.nome}
                {l.condicaoAmbiental ? ` (${l.condicaoAmbiental})` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label="Quantidade"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            helperText="Lâminas equivalentes contam como quantidade do mesmo objeto."
          />
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button
          variant="contained"
          onClick={async () => {
            try {
              await api.post('/bioteca', {
                tipo,
                descricao: descricao || null,
                orgao: orgao || null,
                localId: localId || null,
                quantidade: Number(quantidade) || 1,
              });
              setDescricao('');
              setOrgao('');
              setLocalId('');
              setQuantidade('1');
              setErro(null);
              aoSalvar();
            } catch (e) {
              setErro(e instanceof ErroApi ? e.detalhe : 'Falha ao arquivar.');
            }
          }}
        >
          Arquivar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Ficha do Objeto Biologico (secoes 80-81).
 *
 * A linha do tempo ocupa metade do dialogo porque a secao 81 diz que ela "sera
 * essencial": e ela que responde onde o material esteve, quem usou e quando
 * voltou - e o que separa um acervo rastreavel de um armario de gavetas.
 */
function DialogoFicha({
  objetoId,
  permissoes,
  aoFechar,
  aoMudar,
}: {
  objetoId: string | null;
  permissoes: string[];
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [ficha, setFicha] = useState<FichaObjetoBiologico | null>(null);
  const [locais, setLocais] = useState<LocalFisicoAdmin[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<'retirar' | 'devolver' | 'reservar' | 'restricoes' | null>(null);
  const [finalidade, setFinalidade] = useState<FinalidadeUso>('diagnostico');
  const [destino, setDestino] = useState('');
  const [condicao, setCondicao] = useState<CondicaoObjeto>('integro');
  const [restricoes, setRestricoes] = useState<RestricaoObjeto[]>([]);
  const [justificativa, setJustificativa] = useState('');

  const podeMovimentar = permissoes.includes('bioteca:movimentar');
  const podeReservar = permissoes.includes('bioteca:reservar');
  const podeAdministrar = permissoes.includes('bioteca:administrar');

  const carregar = useCallback(() => {
    if (!objetoId) return;
    api
      .get<FichaObjetoBiologico>(`/bioteca/${objetoId}`)
      .then((f) => {
        setFicha(f);
        setRestricoes(f.restricoes as RestricaoObjeto[]);
      })
      .catch(() => setErro('Não foi possível carregar a ficha.'));
    api
      .get<LocalFisicoAdmin[]>('/administracao/locais')
      .then((l) => setLocais(l.filter((x) => !x.inativadoEm)))
      .catch(() => undefined);
  }, [objetoId]);

  useEffect(() => {
    setFicha(null);
    setErro(null);
    setAcao(null);
    carregar();
  }, [carregar]);

  async function executar(fn: () => Promise<unknown>) {
    try {
      await fn();
      setErro(null);
      setAcao(null);
      setDestino('');
      setJustificativa('');
      carregar();
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível concluir a ação.');
    }
  }

  const reservaAtiva = ficha?.reservas.find((r) => r.ativa);

  return (
    <Dialog open={objetoId != null} onClose={aoFechar} maxWidth="md" fullWidth>
      <DialogTitle sx={{ ...MONO }}>{ficha?.identificador ?? 'Material'}</DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {erro}
          </Alert>
        )}
        {!ficha ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Chip
                size="small"
                color={COR_STATUS[ficha.status as StatusObjetoBiologico] ?? 'default'}
                label={
                  STATUS_OBJETO_BIOLOGICO_LABEL[ficha.status as StatusObjetoBiologico] ??
                  ficha.status
                }
              />
              <Chip
                size="small"
                variant="outlined"
                label={TIPO_OBJETO_BIOLOGICO_LABEL[ficha.tipo as TipoObjetoBiologico] ?? ficha.tipo}
              />
              <Chip
                size="small"
                variant="outlined"
                label={CONDICAO_OBJETO_LABEL[ficha.condicao as CondicaoObjeto] ?? ficha.condicao}
              />
              {ficha.restricoes.map((r) => (
                <Chip
                  key={r}
                  size="small"
                  color="error"
                  variant="outlined"
                  label={RESTRICAO_OBJETO_LABEL[r as RestricaoObjeto] ?? r}
                />
              ))}
            </Stack>

            <Box>
              <Typography sx={{ fontSize: 13 }}>{ficha.descricao ?? '—'}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {ficha.orgao ? `${ficha.orgao} · ` : ''}
                {ficha.quantidadeInicial > 1
                  ? `${ficha.quantidadeDisponivel} de ${ficha.quantidadeInicial} disponível(is) · `
                  : ''}
                guarda até {data(ficha.retencaoAte)}
                {ficha.preservacaoEspecial ? ' (preservação especial, sem prazo)' : ''}
              </Typography>
            </Box>

            {/* Secao 33: onde está agora e para onde volta são coisas distintas. */}
            <Card variant="outlined" sx={{ p: 1.5 }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Localização</Typography>
              <Typography sx={{ ...MONO, fontSize: 14 }}>
                {ficha.local
                  ? `${ficha.local.codigo} — ${ficha.local.nome}`
                  : (ficha.localizacaoDescritiva ?? 'Sem localização registrada')}
              </Typography>
              {!ficha.local && ficha.localOrigem && (
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  Volta para {ficha.localOrigem.codigo} — {ficha.localOrigem.nome}
                </Typography>
              )}
            </Card>

            {/* Secao 5: um bloco nunca é apenas "A3". */}
            {ficha.genealogia.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Origem</Typography>
                <Typography sx={{ ...MONO, fontSize: 13 }}>
                  {ficha.genealogia.map((g) => g.identificador).join(' ← ')}
                </Typography>
              </Box>
            )}

            {reservaAtiva && (
              <Alert severity="info">
                <AlertTitle>
                  Reservado para{' '}
                  {FINALIDADE_USO_LABEL[reservaAtiva.finalidade as FinalidadeUso] ??
                    reservaAtiva.finalidade}
                </AlertTitle>
                {reservaAtiva.projeto ? `${reservaAtiva.projeto}. ` : ''}
                {reservaAtiva.justificativa ??
                  'Retiradas de finalidade com menor precedência ficam bloqueadas.'}
              </Alert>
            )}

            {ficha.emprestimos.filter((e) => !e.devolvidoEm).length > 0 && (
              <Alert severity="warning">
                <AlertTitle>Fora do laboratório</AlertTitle>
                {ficha.emprestimos
                  .filter((e) => !e.devolvidoEm)
                  .map((e) => `${e.identificador} · ${e.destinatario} · prazo ${data(e.prazoDevolucao)}`)
                  .join(' | ')}
              </Alert>
            )}

            <Divider />

            {(podeMovimentar || podeReservar || podeAdministrar) && (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {podeMovimentar && ficha.local && (
                  <Button size="small" variant="outlined" onClick={() => setAcao('retirar')}>
                    Retirar
                  </Button>
                )}
                {podeMovimentar && !ficha.local && ficha.status !== 'descartado' && (
                  <Button size="small" variant="outlined" onClick={() => setAcao('devolver')}>
                    Devolver ao acervo
                  </Button>
                )}
                {podeReservar && !reservaAtiva && (
                  <Button size="small" variant="outlined" onClick={() => setAcao('reservar')}>
                    Reservar
                  </Button>
                )}
                {podeReservar && reservaAtiva && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() =>
                      executar(() =>
                        api.post(`/bioteca/reservas/${reservaAtiva.id}/encerramento`, {
                          motivo: 'Reserva encerrada pelo painel da Bioteca.',
                        }),
                      )
                    }
                  >
                    Encerrar reserva
                  </Button>
                )}
                {podeAdministrar && (
                  <Button size="small" variant="outlined" onClick={() => setAcao('restricoes')}>
                    Restrições
                  </Button>
                )}
              </Stack>
            )}

            {acao === 'retirar' && (
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1.5}>
                  <TextField
                    select
                    size="small"
                    label="Finalidade"
                    value={finalidade}
                    onChange={(e) => setFinalidade(e.target.value as FinalidadeUso)}
                  >
                    {FINALIDADE_USO.map((f) => (
                      <MenuItem key={f} value={f}>
                        {FINALIDADE_USO_LABEL[f]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    label="Destino"
                    placeholder="Histotécnica, microscopia, sala de aula…"
                    value={destino}
                    onChange={(e) => setDestino(e.target.value)}
                  />
                  <Button
                    variant="contained"
                    disabled={destino.trim().length < 2}
                    onClick={() =>
                      executar(() =>
                        api.post(`/bioteca/${objetoId}/retirada`, { finalidade, destino }),
                      )
                    }
                  >
                    Confirmar retirada
                  </Button>
                </Stack>
              </Card>
            )}

            {acao === 'devolver' && (
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1.5}>
                  {/* Sem posicao de origem nao ha para onde voltar sozinho - e
                      a API recusa. O campo aparece justamente nesse caso. */}
                  <TextField
                    select
                    size="small"
                    label="Posição de destino"
                    value={destino}
                    onChange={(e) => setDestino(e.target.value)}
                    helperText={
                      ficha.localOrigem
                        ? `Em branco, volta para ${ficha.localOrigem.codigo}.`
                        : 'Este material não tem posição de origem: informe onde ele será guardado.'
                    }
                  >
                    <MenuItem value="">
                      {ficha.localOrigem ? `${ficha.localOrigem.codigo} (origem)` : 'Selecione'}
                    </MenuItem>
                    {locais.map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.codigo} — {l.nome}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Condição na volta"
                    value={condicao}
                    onChange={(e) => setCondicao(e.target.value as CondicaoObjeto)}
                  >
                    {CONDICAO_OBJETO.map((c) => (
                      <MenuItem key={c} value={c}>
                        {CONDICAO_OBJETO_LABEL[c]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    disabled={!ficha.localOrigem && !destino}
                    onClick={() =>
                      executar(() =>
                        api.post(`/bioteca/${objetoId}/devolucao`, {
                          condicao,
                          localId: destino || null,
                        }),
                      )
                    }
                  >
                    Confirmar devolução
                  </Button>
                </Stack>
              </Card>
            )}

            {acao === 'reservar' && (
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1.5}>
                  <TextField
                    select
                    size="small"
                    label="Finalidade"
                    value={finalidade}
                    onChange={(e) => setFinalidade(e.target.value as FinalidadeUso)}
                    helperText="Diagnóstico e perícia têm precedência sobre ensino e pesquisa."
                  >
                    {FINALIDADE_USO.map((f) => (
                      <MenuItem key={f} value={f}>
                        {FINALIDADE_USO_LABEL[f]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    label="Justificativa"
                    value={justificativa}
                    onChange={(e) => setJustificativa(e.target.value)}
                  />
                  <Button
                    variant="contained"
                    onClick={() =>
                      executar(() =>
                        api.post(`/bioteca/${objetoId}/reserva`, {
                          finalidade,
                          justificativa: justificativa || null,
                        }),
                      )
                    }
                  >
                    Reservar
                  </Button>
                </Stack>
              </Card>
            )}

            {acao === 'restricoes' && (
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                    {RESTRICAO_OBJETO.map((r) => (
                      <Chip
                        key={r}
                        size="small"
                        color={restricoes.includes(r) ? 'error' : 'default'}
                        variant={restricoes.includes(r) ? 'filled' : 'outlined'}
                        label={RESTRICAO_OBJETO_LABEL[r]}
                        onClick={() =>
                          setRestricoes((s) =>
                            s.includes(r) ? s.filter((x) => x !== r) : [...s, r],
                          )
                        }
                      />
                    ))}
                  </Stack>
                  <Button
                    variant="contained"
                    onClick={() =>
                      executar(() => api.post(`/bioteca/${objetoId}/restricoes`, { restricoes }))
                    }
                  >
                    Salvar restrições
                  </Button>
                </Stack>
              </Card>
            )}

            <Divider />

            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Linha do tempo</Typography>
              <Stack spacing={1}>
                {ficha.movimentacoes.map((m) => (
                  <Stack key={m.id} direction="row" spacing={1.5}>
                    <Typography
                      sx={{ ...MONO, fontSize: 12, color: 'text.secondary', flexShrink: 0 }}
                    >
                      {dataHora(m.registradaEm)}
                    </Typography>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13 }}>
                        {TIPO_MOVIMENTACAO_OBJETO_LABEL[
                          m.tipo as keyof typeof TIPO_MOVIMENTACAO_OBJETO_LABEL
                        ] ?? m.tipo}
                        {m.destinoCodigo ? ` → ${m.destinoCodigo}` : ''}
                        {m.destinoDescritivo ? ` → ${m.destinoDescritivo}` : ''}
                        {m.finalidade
                          ? ` · ${FINALIDADE_USO_LABEL[m.finalidade as FinalidadeUso] ?? m.finalidade}`
                          : ''}
                      </Typography>
                      {(m.motivo || m.observacao) && (
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                          {m.motivo ?? m.observacao}
                        </Typography>
                      )}
                      {m.usuarioNome && (
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                          {m.usuarioNome}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
