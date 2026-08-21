import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import {
  api,
  ErroApi,
  type CassetePendente,
  type LoteDetalhe,
  type LoteResumo,
} from '../api';

/**
 * M09 - Processamento Histologico e Coloracoes.
 *
 * Nota do dono do produto no topo do modulo: **"Nos nao fazemos processamento.
 * Esse e um servico terceirizado."** Entao esta tela nao registra processamento:
 * ela gerencia a **saida e o retorno** do material.
 *
 * Decisoes que vem do modulo:
 *
 * - **O lote e do dia, nao do caso.** Ele atravessa varios casos, porque o que
 *   sai e uma remessa fisica. Por isso a tela vive fora do dossie e a listagem
 *   de cassetes pendentes cruza todos os casos.
 * - **As tres divergencias sao as do modulo**, literalmente: falta de cassetes,
 *   cassetes a mais nao listados, numeracoes erradas. Nao inventei categorias.
 * - **"Lamina disponivel" != "laudo liberado"** - sao eventos distintos, e esta
 *   tela emite apenas o primeiro.
 * - **Rastreabilidade total**: Cassete -> Bloco -> Lamina. O bloco nasce sozinho
 *   na primeira lamina do cassete e herda o identificador dele.
 *
 * **Limite conhecido desta versao:** a conferencia do parceiro e lancada aqui
 * dentro, por quem opera o laboratorio. O M09 preve que o laboratorio de apoio
 * faca isso ele mesmo, e o registro de quem apontou vai gravar o usuario interno
 * ate o portal externo existir. Esta escrito na tela para nao virar um dado que
 * parece do parceiro sem ser.
 */

const STATUS_LOTE: Record<string, { rotulo: string; cor: 'default' | 'info' | 'warning' | 'success' }> = {
  aberto: { rotulo: 'Aberto', cor: 'default' },
  enviado: { rotulo: 'Enviado', cor: 'info' },
  recebido: { rotulo: 'Recebido pelo parceiro', cor: 'info' },
  com_divergencia: { rotulo: 'Com divergência', cor: 'warning' },
  concluido: { rotulo: 'Concluído', cor: 'success' },
};

/** As três categorias vêm da nota do M09 — não são uma taxonomia minha. */
const TIPO_DIVERGENCIA = [
  { valor: 'cassete_faltante', rotulo: 'Cassete faltante' },
  { valor: 'cassete_excedente', rotulo: 'Cassete a mais, não listado' },
  { valor: 'numeracao_errada', rotulo: 'Numeração errada' },
] as const;

type TipoDivergencia = (typeof TIPO_DIVERGENCIA)[number]['valor'];

interface DivergenciaNova {
  tipo: TipoDivergencia | '';
  casseteId: string;
  codigoInformado: string;
  descricao: string;
}

interface LaminaNova {
  casseteId: string;
  coloracao: string;
  nivel: string;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function Processamento() {
  const [aba, setAba] = useState<'montar' | 'lotes'>('montar');
  const [loteAberto, setLoteAberto] = useState<string | null>(null);

  return (
    <Box sx={{ maxWidth: 980 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Processamento
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        O processamento é terceirizado. Aqui o material sai em lote, o parceiro confere e as
        lâminas voltam.
      </Typography>

      {loteAberto ? (
        <DetalheLote id={loteAberto} aoVoltar={() => setLoteAberto(null)} />
      ) : (
        <>
          <Tabs
            value={aba}
            onChange={(_, v: 'montar' | 'lotes') => setAba(v)}
            sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Tab value="montar" label="Montar lote" sx={{ fontSize: 13.5, minHeight: 42 }} />
            <Tab value="lotes" label="Lotes enviados" sx={{ fontSize: 13.5, minHeight: 42 }} />
          </Tabs>

          {aba === 'montar' ? (
            <MontarLote aoEnviar={() => setAba('lotes')} />
          ) : (
            <ListaLotes aoAbrir={setLoteAberto} />
          )}
        </>
      )}
    </Box>
  );
}

// --- montar o lote do dia ----------------------------------------------------

function MontarLote({ aoEnviar }: { aoEnviar: () => void }) {
  const [pendentes, setPendentes] = useState<CassetePendente[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .get<CassetePendente[]>('/processamento/cassetes-pendentes')
      .then(setPendentes)
      .catch(() => setErro('Não foi possível carregar os cassetes pendentes.'));
  }, []);

  /** Agrupado por caso: o lote é uma remessa, mas quem confere lê por caso. */
  const porCaso = useMemo(() => {
    const mapa = new Map<string, { paciente: string; itens: CassetePendente[] }>();
    for (const c of pendentes ?? []) {
      const atual = mapa.get(c.caso) ?? { paciente: c.paciente, itens: [] };
      atual.itens.push(c);
      mapa.set(c.caso, atual);
    }
    return [...mapa.entries()];
  }, [pendentes]);

  function alternar(id: string) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarCaso(itens: CassetePendente[]) {
    const todosMarcados = itens.every((c) => marcados.has(c.id));
    setMarcados((atual) => {
      const novo = new Set(atual);
      for (const c of itens) {
        if (todosMarcados) novo.delete(c.id);
        else novo.add(c.id);
      }
      return novo;
    });
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      await api.post('/processamento/lotes', { casseteIds: [...marcados] });
      aoEnviar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar o lote.');
      setEnviando(false);
    }
  }

  if (!pendentes) {
    return erro ? <Alert severity="error">{erro}</Alert> : <Skeleton variant="rounded" height={260} />;
  }

  if (pendentes.length === 0) {
    return (
      <Card sx={{ p: 5, textAlign: 'center' }}>
        <InboxOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
        <Typography sx={{ fontWeight: 600 }}>Nenhum cassete aguardando envio</Typography>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
          Os cassetes aparecem aqui assim que uma macroscopia for concluída.
        </Typography>
      </Card>
    );
  }

  return (
    <>
      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Cassetes aguardando envio
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          O lote é identificado pela data de envio e pode atravessar vários casos.
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        <Stack spacing={2.5} divider={<Divider flexItem />}>
          {porCaso.map(([caso, { paciente, itens }]) => {
            const todos = itens.every((c) => marcados.has(c.id));
            const alguns = itens.some((c) => marcados.has(c.id));

            return (
              <Box key={caso}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <Checkbox
                    size="small"
                    checked={todos}
                    indeterminate={alguns && !todos}
                    onChange={() => alternarCaso(itens)}
                    slotProps={{ input: { 'aria-label': `Selecionar todos os cassetes de ${caso}` } }}
                    sx={{ p: 0.5 }}
                  />
                  <Typography sx={{ ...MONO, fontSize: 13.5, fontWeight: 700 }}>{caso}</Typography>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{paciente}</Typography>
                </Stack>

                <Stack sx={{ pl: { xs: 0, sm: 4 } }}>
                  {itens.map((c) => (
                    <Stack
                      key={c.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Checkbox
                        size="small"
                        checked={marcados.has(c.id)}
                        onChange={() => alternar(c.id)}
                        slotProps={{ input: { 'aria-label': `Selecionar cassete ${c.identificador}` } }}
                        sx={{ p: 0.5 }}
                      />
                      <Typography sx={{ ...MONO, fontSize: 12.5 }}>{c.identificador}</Typography>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                        {c.tecidoOrigem}
                      </Typography>
                      {c.exigeDescalcificacao && (
                        // M09: o parceiro precisa saber antes de processar.
                        <Chip size="small" color="warning" variant="outlined" label="descalcificação" />
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Card>

      {erro && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {erro}
        </Alert>
      )}

      <Stack
        direction="row"
        spacing={2}
        sx={{ mt: 3, alignItems: 'center', justifyContent: 'flex-end' }}
      >
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          {marcados.size} de {pendentes.length} selecionados
        </Typography>
        <Button
          variant="contained"
          startIcon={<LocalShippingOutlined />}
          onClick={() => void enviar()}
          disabled={enviando || marcados.size === 0}
        >
          {enviando ? 'Enviando…' : 'Enviar lote'}
        </Button>
      </Stack>
    </>
  );
}

// --- lista de lotes ----------------------------------------------------------

function ListaLotes({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const [lotes, setLotes] = useState<LoteResumo[] | null>(null);

  useEffect(() => {
    api.get<LoteResumo[]>('/processamento/lotes').then(setLotes).catch(() => setLotes([]));
  }, []);

  if (!lotes) return <Skeleton variant="rounded" height={220} />;

  if (lotes.length === 0) {
    return (
      <Card sx={{ p: 5, textAlign: 'center' }}>
        <InboxOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
        <Typography sx={{ fontWeight: 600 }}>Nenhum lote enviado</Typography>
      </Card>
    );
  }

  return (
    <Stack spacing={1.5}>
      {lotes.map((l) => {
        const status = STATUS_LOTE[l.status] ?? { rotulo: l.status, cor: 'default' as const };
        return (
          <Card key={l.id}>
            <Box
              component="button"
              onClick={() => aoAbrir(l.id)}
              sx={{
                width: '100%',
                p: 2,
                textAlign: 'left',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0.75, sm: 2 }}
                sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
              >
                <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 700 }}>
                  {l.identificador}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  {new Date(`${l.dataEnvio}T00:00:00`).toLocaleDateString('pt-BR')} ·{' '}
                  {l.totalCassetes} {l.totalCassetes === 1 ? 'cassete' : 'cassetes'}
                </Typography>

                <Stack direction="row" spacing={1} sx={{ ml: { sm: 'auto' }, alignItems: 'center' }}>
                  {l.divergencias > 0 && (
                    <Chip
                      size="small"
                      color="warning"
                      label={`▲ ${l.divergencias} ${l.divergencias === 1 ? 'divergência' : 'divergências'}`}
                    />
                  )}
                  <Chip size="small" color={status.cor} variant="outlined" label={status.rotulo} />
                </Stack>
              </Stack>
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
}

// --- detalhe do lote: conferência e lâminas ----------------------------------

function DetalheLote({ id, aoVoltar }: { id: string; aoVoltar: () => void }) {
  const [lote, setLote] = useState<LoteDetalhe | null>(null);
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [divergencias, setDivergencias] = useState<DivergenciaNova[]>([]);
  const [laminas, setLaminas] = useState<LaminaNova[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    const dados = await api.get<LoteDetalhe>(`/processamento/lotes/${id}`);
    setLote(dados);
    setConfirmados(
      new Set(dados.cassetes.filter((c) => c.confirmadoRecebimento).map((c) => c.id)),
    );
    setDivergencias([]);
    setLaminas([]);
  }, [id]);

  useEffect(() => {
    recarregar().catch(() => setErro('Não foi possível carregar o lote.'));
  }, [recarregar]);

  if (!lote) {
    return erro ? <Alert severity="error">{erro}</Alert> : <Skeleton variant="rounded" height={280} />;
  }

  const conferido = lote.recebidoParceiroEm != null;
  const divergenciasValidas = divergencias.filter(
    (d) => d.tipo !== '' && d.descricao.trim() !== '',
  );
  const laminasValidas = laminas.filter((l) => l.casseteId !== '' && l.coloracao.trim() !== '');

  async function conferir() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/processamento/lotes/${id}/conferencia`, {
        confirmados: [...confirmados],
        ...(divergenciasValidas.length > 0
          ? {
              divergencias: divergenciasValidas.map((d) => ({
                tipo: d.tipo,
                ...(d.casseteId ? { casseteId: d.casseteId } : {}),
                ...(d.codigoInformado.trim() ? { codigoInformado: d.codigoInformado.trim() } : {}),
                descricao: d.descricao.trim(),
              })),
            }
          : {}),
      });
      await recarregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível registrar a conferência.');
    } finally {
      setOcupado(false);
    }
  }

  async function registrarLaminas() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/processamento/lotes/${id}/laminas`, {
        laminas: laminasValidas.map((l) => ({
          casseteId: l.casseteId,
          coloracao: l.coloracao.trim(),
          ...(Number(l.nivel) > 0 ? { nivel: Number(l.nivel) } : {}),
        })),
      });
      await recarregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível registrar as lâminas.');
    } finally {
      setOcupado(false);
    }
  }

  const status = STATUS_LOTE[lote.status] ?? { rotulo: lote.status, cor: 'default' as const };

  return (
    <>
      <Button startIcon={<ArrowBackOutlined />} onClick={aoVoltar} sx={{ mb: 2 }}>
        Todos os lotes
      </Button>

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
            {lote.identificador}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Enviado em {new Date(`${lote.dataEnvio}T00:00:00`).toLocaleDateString('pt-BR')}
          </Typography>
          <Chip
            size="small"
            color={status.cor}
            variant="outlined"
            label={status.rotulo}
            sx={{ ml: { sm: 'auto' } }}
          />
        </Stack>
      </Card>

      {/**
        * O M09 prevê que o parceiro confira dentro do sistema. Enquanto o portal
        * externo não existe, quem lança é o laboratório — e o registro grava o
        * usuário interno. Dizer isso evita que o dado pareça vir do parceiro.
        */}
      {!conferido && (
        <Alert severity="info" sx={{ mb: 2.5 }}>
          A conferência abaixo está sendo lançada por você, em nome do laboratório de apoio. Quando
          o acesso externo existir, o parceiro fará isso diretamente e o registro passará a ser dele.
        </Alert>
      )}

      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Conferência do parceiro
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {conferido
            ? `Confirmada em ${new Date(lote.recebidoParceiroEm!).toLocaleString('pt-BR')}.`
            : 'Marque o que chegou e aponte o que estiver errado.'}
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        <Stack spacing={0.5}>
          {lote.cassetes.map((c) => (
            <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Checkbox
                size="small"
                checked={confirmados.has(c.id)}
                disabled={conferido}
                onChange={() =>
                  setConfirmados((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(c.id)) novo.delete(c.id);
                    else novo.add(c.id);
                    return novo;
                  })
                }
                slotProps={{ input: { 'aria-label': `Confirmar recebimento de ${c.identificador}` } }}
                sx={{ p: 0.5 }}
              />
              <Typography sx={{ ...MONO, fontSize: 12.5 }}>{c.identificador}</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{c.tecidoOrigem}</Typography>
              {c.exigeDescalcificacao && (
                <Chip size="small" variant="outlined" color="warning" label="descalcificação" />
              )}
            </Stack>
          ))}
        </Stack>

        {lote.divergencias.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2.5 }}>
            <AlertTitle>
              {lote.divergencias.length === 1
                ? '1 divergência apontada'
                : `${lote.divergencias.length} divergências apontadas`}
            </AlertTitle>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
              {lote.divergencias.map((d) => (
                <Typography component="li" key={d.id} sx={{ fontSize: 13 }}>
                  <strong>{TIPO_DIVERGENCIA.find((t) => t.valor === d.tipo)?.rotulo ?? d.tipo}</strong>
                  {' — '}
                  {d.descricao}
                  {d.codigoInformado ? ` (código informado: ${d.codigoInformado})` : ''}
                </Typography>
              ))}
            </Stack>
          </Alert>
        )}

        {!conferido && (
          <>
            <Stack
              direction="row"
              sx={{ mt: 3, mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Divergências</Typography>
              <Button
                size="small"
                startIcon={<AddOutlined />}
                onClick={() =>
                  setDivergencias((a) => [
                    ...a,
                    { tipo: '', casseteId: '', codigoInformado: '', descricao: '' },
                  ])
                }
              >
                Apontar
              </Button>
            </Stack>

            <Stack spacing={2}>
              {divergencias.map((d, i) => (
                <Stack
                  key={i}
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <TextField
                    select
                    label="Tipo"
                    value={d.tipo}
                    onChange={(e) =>
                      setDivergencias((a) =>
                        a.map((x, j) =>
                          i === j ? { ...x, tipo: e.target.value as TipoDivergencia } : x,
                        ),
                      )
                    }
                    sx={{ minWidth: 215, width: { xs: '100%', md: 'auto' } }}
                  >
                    {TIPO_DIVERGENCIA.map((t) => (
                      <MenuItem key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    label="Cassete"
                    value={d.casseteId}
                    onChange={(e) =>
                      setDivergencias((a) =>
                        a.map((x, j) => (i === j ? { ...x, casseteId: e.target.value } : x)),
                      )
                    }
                    // Um cassete a mais não está na lista — por isso "nenhum".
                    helperText="Vazio: não consta do lote"
                    sx={{ minWidth: 165, width: { xs: '100%', md: 'auto' } }}
                  >
                    <MenuItem value="">Nenhum</MenuItem>
                    {lote.cassetes.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.identificador}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    label="Código informado"
                    value={d.codigoInformado}
                    onChange={(e) =>
                      setDivergencias((a) =>
                        a.map((x, j) => (i === j ? { ...x, codigoInformado: e.target.value } : x)),
                      )
                    }
                    helperText="Como veio rotulado"
                    sx={{ width: { xs: '100%', md: 160 } }}
                  />

                  <TextField
                    label="Descrição"
                    value={d.descricao}
                    onChange={(e) =>
                      setDivergencias((a) =>
                        a.map((x, j) => (i === j ? { ...x, descricao: e.target.value } : x)),
                      )
                    }
                    helperText=" "
                    sx={{ flex: 1, width: { xs: '100%', md: 'auto' } }}
                  />

                  <Tooltip title="Remover divergência">
                    <IconButton
                      onClick={() => setDivergencias((a) => a.filter((_, j) => j !== i))}
                      aria-label="Remover divergência"
                      sx={{ mt: 0.5 }}
                    >
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>

            <Stack direction="row" sx={{ mt: 3, justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={() => void conferir()} disabled={ocupado}>
                {ocupado ? 'Registrando…' : 'Registrar conferência'}
              </Button>
            </Stack>
          </>
        )}
      </Card>

      {/* Lâminas só depois da conferência: registrar produção de material que o
          parceiro ainda não confirmou ter recebido inverteria a ordem real. */}
      {conferido && (
        <Card sx={{ p: 2.5, mt: 2.5 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}
          >
            <Box>
              <Typography variant="h4">Lâminas produzidas</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                Cada lâmina nasce de um bloco, e o bloco de um cassete. Lâmina disponível não é
                laudo liberado — são coisas diferentes.
              </Typography>
            </Box>
            <Button
              size="small"
              startIcon={<AddOutlined />}
              onClick={() =>
                setLaminas((a) => [...a, { casseteId: '', coloracao: 'HE', nivel: '1' }])
              }
            >
              Adicionar
            </Button>
          </Stack>

          <Divider sx={{ my: 2.5 }} />

          {lote.laminas.length > 0 && (
            <Stack spacing={0.5} sx={{ mb: laminas.length > 0 ? 2.5 : 0 }}>
              {lote.laminas.map((l) => (
                <Stack key={l.id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ ...MONO, fontSize: 12.5, fontWeight: 600 }}>
                    {l.identificador}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    {l.coloracaoSigla} · nível {l.nivel}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}

          {lote.laminas.length === 0 && laminas.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              Nenhuma lâmina registrada.
            </Typography>
          )}

          <Stack spacing={2}>
            {laminas.map((l, i) => (
              <Stack
                key={i}
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                sx={{ alignItems: 'flex-start' }}
              >
                <TextField
                  select
                  label="Cassete"
                  value={l.casseteId}
                  onChange={(e) =>
                    setLaminas((a) =>
                      a.map((x, j) => (i === j ? { ...x, casseteId: e.target.value } : x)),
                    )
                  }
                  required
                  sx={{ minWidth: 185, width: { xs: '100%', md: 'auto' } }}
                >
                  {lote.cassetes.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.identificador}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  label="Coloração"
                  value={l.coloracao}
                  onChange={(e) =>
                    setLaminas((a) =>
                      a.map((x, j) => (i === j ? { ...x, coloracao: e.target.value } : x)),
                    )
                  }
                  required
                  helperText="Sigla, ex.: HE, PAS, TM"
                  sx={{ width: { xs: '100%', md: 150 } }}
                />

                <TextField
                  label="Nível"
                  type="number"
                  value={l.nivel}
                  onChange={(e) =>
                    setLaminas((a) => a.map((x, j) => (i === j ? { ...x, nivel: e.target.value } : x)))
                  }
                  slotProps={{ htmlInput: { min: 1 } }}
                  helperText=" "
                  sx={{ width: { xs: '100%', md: 100 } }}
                />

                <Tooltip title="Remover lâmina">
                  <IconButton
                    onClick={() => setLaminas((a) => a.filter((_, j) => j !== i))}
                    aria-label="Remover lâmina"
                    sx={{ mt: 0.5 }}
                  >
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>

          {laminas.length > 0 && (
            <Stack direction="row" sx={{ mt: 3, justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                onClick={() => void registrarLaminas()}
                disabled={ocupado || laminasValidas.length === 0}
              >
                {ocupado ? 'Registrando…' : 'Registrar lâminas'}
              </Button>
            </Stack>
          )}
        </Card>
      )}

      {erro && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {erro}
        </Alert>
      )}
    </>
  );
}
