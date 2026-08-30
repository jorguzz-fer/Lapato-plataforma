import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  CATEGORIAS_SUGERIDAS,
  STATUS_FATURA_LABEL,
  TIPO_LANCAMENTO_LABEL,
  formatarReais,
  type StatusFatura,
  type TipoLancamento,
} from '@lapato/shared';
import { api, ErroApi } from '../../api';

/**
 * M20 (parcial) - Financeiro padrao, o escopo combinado na review: fluxo de
 * caixa, faturas sobre as OSs despachadas e o livro de entrada e saida. O que
 * for especifico do setor entra quando a Roberta mandar a lista.
 */

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

interface Resumo {
  meses: Array<{ mes: string; entradas: number; saidas: number; saldo: number }>;
  aReceber: { quantidade: number; valor: number };
  aFaturar: { quantidade: number; valor: number };
}

interface LinhaFatura {
  id: string;
  identificador: string;
  status: StatusFatura;
  vencimento: string | null;
  criadoEm: string;
  valorPago: string | null;
  clienteNome: string;
  total: string;
}

interface Lancamento {
  id: string;
  tipo: TipoLancamento;
  categoria: string;
  descricao: string;
  valor: string;
  data: string;
  faturaId: string | null;
}

interface OrdemDespachada {
  id: string;
  identificador: string;
  casoIdentificador: string;
  clienteId: string;
  clienteNome: string;
  total: string;
}

export function Financeiro({ permissoes }: { permissoes: string[] }) {
  const [aba, setAba] = useState<'visao' | 'faturas' | 'lancamentos'>('visao');
  const podeLancar = permissoes.includes('financeiro:lancar');

  return (
    <Box>
      <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
        Financeiro
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5 }}>
        A cobrança nasce da Ordem de Serviço despachada; o livro registra o que entrou e saiu.
      </Typography>

      <Tabs value={aba} onChange={(_, v) => setAba(v)} sx={{ mb: 2, minHeight: 42 }}>
        <Tab value="visao" label="Visão" sx={{ fontSize: 13.5, minHeight: 42 }} />
        <Tab value="faturas" label="Faturas" sx={{ fontSize: 13.5, minHeight: 42 }} />
        <Tab value="lancamentos" label="Lançamentos" sx={{ fontSize: 13.5, minHeight: 42 }} />
      </Tabs>

      {aba === 'visao' && <Visao />}
      {aba === 'faturas' && <Faturas podeLancar={podeLancar} />}
      {aba === 'lancamentos' && <Lancamentos podeLancar={podeLancar} />}
    </Box>
  );
}

// --- Visão: fluxo de caixa ------------------------------------------------

function Visao() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Resumo>('/financeiro/resumo')
      .then(setResumo)
      .catch(() => setErro('Não foi possível carregar o resumo.'));
  }, []);

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!resumo) return <Skeleton variant="rounded" height={220} />;

  const maior = Math.max(1, ...resumo.meses.map((m) => Math.max(m.entradas, m.saidas)));

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Card sx={{ p: 2, flex: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Contas a receber</Typography>
          <Typography sx={{ ...MONO, fontSize: 22, fontWeight: 700 }}>
            {formatarReais(resumo.aReceber.valor)}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {resumo.aReceber.quantidade} fatura(s) emitida(s) aguardando pagamento
          </Typography>
        </Card>
        <Card sx={{ p: 2, flex: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Pronto para faturar</Typography>
          <Typography sx={{ ...MONO, fontSize: 22, fontWeight: 700 }}>
            {formatarReais(resumo.aFaturar.valor)}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {resumo.aFaturar.quantidade} OS despachada(s) sem fatura
          </Typography>
        </Card>
      </Stack>

      <Card sx={{ p: 2.5 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1.5 }}>
          Fluxo de caixa — últimos 6 meses
        </Typography>
        {resumo.meses.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Nenhum lançamento ainda.
          </Typography>
        )}
        <Stack spacing={1.25}>
          {resumo.meses.map((m) => (
            <Box key={m.mes}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.25 }}>
                <Typography sx={{ ...MONO, fontSize: 12.5 }}>{m.mes}</Typography>
                <Typography
                  sx={{
                    ...MONO,
                    fontSize: 12.5,
                    color: m.saldo >= 0 ? 'success.main' : 'error.main',
                  }}
                >
                  saldo {formatarReais(m.saldo)}
                </Typography>
              </Stack>
              {/* Barras texto-livre: entrada em cima, saída embaixo. Não é só cor —
                  o rótulo diz qual é qual (M07: indicador não depende só de cor). */}
              <Stack spacing={0.25}>
                <Barra rotulo="entradas" valor={m.entradas} maior={maior} cor="success.main" />
                <Barra rotulo="saídas" valor={m.saidas} maior={maior} cor="error.main" />
              </Stack>
            </Box>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}

function Barra({
  rotulo,
  valor,
  maior,
  cor,
}: {
  rotulo: string;
  valor: number;
  maior: number;
  cor: string;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', width: 56, flexShrink: 0 }}>
        {rotulo}
      </Typography>
      <Box sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 0.5, height: 10 }}>
        <Box
          sx={{
            width: `${Math.round((valor / maior) * 100)}%`,
            bgcolor: cor,
            height: '100%',
            borderRadius: 0.5,
          }}
        />
      </Box>
      <Typography sx={{ ...MONO, fontSize: 11.5, width: 110, textAlign: 'right', flexShrink: 0 }}>
        {formatarReais(valor)}
      </Typography>
    </Stack>
  );
}

// --- Faturas ----------------------------------------------------------------

function Faturas({ podeLancar }: { podeLancar: boolean }) {
  const [faturas, setFaturas] = useState<LinhaFatura[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [aberta, setAberta] = useState<LinhaFatura | null>(null);

  const carregar = useCallback(() => {
    api
      .get<LinhaFatura[]>('/financeiro/faturas')
      .then(setFaturas)
      .catch(() => setErro('Não foi possível carregar as faturas.'))
      .finally(() => setCarregado(true));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <Stack spacing={1.5}>
      {erro && <Alert severity="error">{erro}</Alert>}

      {podeLancar && (
        <Button
          variant="contained"
          startIcon={<AddOutlined />}
          onClick={() => setCriando(true)}
          sx={{ alignSelf: 'flex-end' }}
        >
          Nova fatura
        </Button>
      )}

      {!carregado && <Skeleton variant="rounded" height={160} />}
      {carregado && faturas.length === 0 && (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Nenhuma fatura — crie a primeira a partir das OSs despachadas.
        </Typography>
      )}

      {faturas.map((f) => (
        <Card
          key={f.id}
          sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
          onClick={() => setAberta(f)}
        >
          <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ ...MONO, fontSize: 13.5, fontWeight: 700, color: 'primary.main' }}>
                  {f.identificador}
                </Typography>
                <Chip size="small" variant="outlined" label={STATUS_FATURA_LABEL[f.status]} />
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                {f.clienteNome}
                {f.vencimento
                  ? ` · vence ${new Date(`${f.vencimento}T12:00:00`).toLocaleDateString('pt-BR')}`
                  : ''}
              </Typography>
            </Box>
            <Typography sx={{ ...MONO, fontSize: 15, fontWeight: 700, alignSelf: 'center' }}>
              {formatarReais(f.total)}
            </Typography>
          </Stack>
        </Card>
      ))}

      {criando && (
        <DialogoNovaFatura
          aoFechar={() => setCriando(false)}
          aoSalvar={() => {
            setCriando(false);
            carregar();
          }}
        />
      )}

      {aberta && (
        <DialogoFatura
          faturaId={aberta.id}
          podeLancar={podeLancar}
          aoFechar={() => setAberta(null)}
          aoMudar={carregar}
        />
      )}
    </Stack>
  );
}

function DialogoNovaFatura({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const [ordens, setOrdens] = useState<OrdemDespachada[]>([]);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    api
      .get<OrdemDespachada[]>('/ordens?status=despachada')
      .then(setOrdens)
      .catch(() => setErro('Não foi possível carregar as ordens despachadas.'))
      .finally(() => setCarregado(true));
  }, []);

  function alternar(id: string) {
    setEscolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  const porCliente = new Map<string, OrdemDespachada[]>();
  for (const ordem of ordens) {
    porCliente.set(ordem.clienteNome, [...(porCliente.get(ordem.clienteNome) ?? []), ordem]);
  }

  // Todas as escolhidas precisam ser do mesmo cliente - a fatura é dele.
  const clientesEscolhidos = new Set(
    ordens.filter((o) => escolhidas.has(o.id)).map((o) => o.clienteNome),
  );

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      const selecionadas = ordens.filter((o) => escolhidas.has(o.id));
      const primeira = selecionadas[0];
      if (!primeira) return;
      await api.post('/financeiro/faturas', {
        clienteId: primeira.clienteId,
        ordemIds: selecionadas.map((o) => o.id),
      });
      aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar a fatura.');
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 16 }}>Nova fatura</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {erro && <Alert severity="error">{erro}</Alert>}
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            Só OS despachada entra — e todas da mesma fatura são do mesmo cliente.
          </Typography>
          {carregado && ordens.length === 0 && (
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
              Nenhuma OS despachada aguardando fatura.
            </Typography>
          )}
          {[...porCliente.entries()].map(([nomeCliente, doCliente]) => (
            <Box key={nomeCliente}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>
                {nomeCliente}
              </Typography>
              <Stack spacing={0.5}>
                {doCliente.map((o) => (
                  <Stack
                    key={o.id}
                    direction="row"
                    spacing={1}
                    onClick={() => alternar(o.id)}
                    sx={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1,
                      borderRadius: 1,
                      cursor: 'pointer',
                      bgcolor: escolhidas.has(o.id) ? 'action.selected' : 'action.hover',
                    }}
                  >
                    <Typography sx={{ ...MONO, fontSize: 12.5 }}>
                      {o.identificador} · caso {o.casoIdentificador}
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: 12.5 }}>
                      {formatarReais(o.total)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={ocupado || escolhidas.size === 0 || clientesEscolhidos.size !== 1}
          onClick={() => void criar()}
        >
          Criar fatura
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogoFatura({
  faturaId,
  podeLancar,
  aoFechar,
  aoMudar,
}: {
  faturaId: string;
  podeLancar: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  interface FaturaDetalhe {
    identificador: string;
    status: StatusFatura;
    vencimento: string | null;
    valorPago: string | null;
    motivoCancelamento: string | null;
    clienteNome: string;
    ordens: Array<{ id: string; identificador: string; casoId: string; total: number }>;
    total: number;
  }

  const [fatura, setFatura] = useState<FaturaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [vencimento, setVencimento] = useState('');
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const carregar = useCallback(() => {
    api
      .get<FaturaDetalhe>(`/financeiro/faturas/${faturaId}`)
      .then(setFatura)
      .catch(() => setErro('Não foi possível carregar a fatura.'));
  }, [faturaId]);

  useEffect(carregar, [carregar]);

  async function agir(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      carregar();
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagem);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      {!fatura ? (
        <DialogContent>
          <Skeleton variant="rounded" height={200} />
        </DialogContent>
      ) : (
        <>
          <DialogTitle sx={{ fontSize: 16 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Box component="span" sx={{ ...MONO, color: 'primary.main' }}>
                {fatura.identificador}
              </Box>
              <Chip size="small" label={STATUS_FATURA_LABEL[fatura.status]} />
              <Typography component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>
                {fatura.clienteNome}
              </Typography>
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Stack spacing={1.5}>
              {erro && <Alert severity="error">{erro}</Alert>}
              {fatura.motivoCancelamento && (
                <Alert severity="warning">Cancelada: {fatura.motivoCancelamento}</Alert>
              )}

              <Stack divider={<Divider flexItem />} spacing={0.75}>
                {fatura.ordens.map((o) => (
                  <Stack key={o.id} direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography sx={{ ...MONO, fontSize: 13 }}>{o.identificador}</Typography>
                    <Typography sx={{ ...MONO, fontSize: 13 }}>
                      {formatarReais(o.total)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
              <Divider />
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Total</Typography>
                <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
                  {formatarReais(fatura.total)}
                </Typography>
              </Stack>
              {fatura.valorPago && (
                <Typography sx={{ fontSize: 12.5, color: 'success.main' }}>
                  Pago: {formatarReais(fatura.valorPago)}
                </Typography>
              )}

              {podeLancar && fatura.status === 'aberta' && (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <TextField
                    size="small"
                    type="date"
                    label="Vencimento"
                    value={vencimento}
                    onChange={(e) => setVencimento(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    disabled={ocupado || !vencimento}
                    onClick={() =>
                      void agir(
                        () => api.post(`/financeiro/faturas/${faturaId}/emissao`, { vencimento }),
                        'Não foi possível emitir.',
                      )
                    }
                  >
                    Emitir
                  </Button>
                </Stack>
              )}

              {podeLancar && fatura.status === 'emitida' && (
                <Button
                  variant="contained"
                  size="small"
                  disabled={ocupado}
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() =>
                    void agir(
                      () => api.post(`/financeiro/faturas/${faturaId}/pagamento`, {}),
                      'Não foi possível registrar o pagamento.',
                    )
                  }
                >
                  Registrar pagamento
                </Button>
              )}

              {cancelando && (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="Motivo do cancelamento"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    color="error"
                    variant="contained"
                    size="small"
                    disabled={ocupado || !motivo.trim()}
                    onClick={() =>
                      void agir(async () => {
                        await api.post(`/financeiro/faturas/${faturaId}/cancelamento`, {
                          motivo: motivo.trim(),
                        });
                        setCancelando(false);
                      }, 'Não foi possível cancelar.')
                    }
                  >
                    Confirmar
                  </Button>
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            {podeLancar &&
              (fatura.status === 'aberta' || fatura.status === 'emitida') &&
              !cancelando && (
                <Button color="error" onClick={() => setCancelando(true)}>
                  Cancelar fatura
                </Button>
              )}
            <Button variant="contained" onClick={aoFechar}>
              Fechar
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

// --- Lançamentos ------------------------------------------------------------

function Lancamentos({ podeLancar }: { podeLancar: boolean }) {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api
      .get<Lancamento[]>('/financeiro/lancamentos')
      .then(setLancamentos)
      .catch(() => setErro('Não foi possível carregar os lançamentos.'))
      .finally(() => setCarregado(true));
  }, []);

  useEffect(carregar, [carregar]);

  async function remover(id: string) {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/financeiro/lancamentos/${id}/remocao`, {});
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível remover.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      {erro && <Alert severity="error">{erro}</Alert>}

      {podeLancar && (
        <Button
          variant="contained"
          startIcon={<AddOutlined />}
          onClick={() => setCriando(true)}
          sx={{ alignSelf: 'flex-end' }}
        >
          Novo lançamento
        </Button>
      )}

      {!carregado && <Skeleton variant="rounded" height={160} />}
      {carregado && lancamentos.length === 0 && (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Nenhum lançamento no livro.
        </Typography>
      )}

      <Stack spacing={0.75}>
        {lancamentos.map((l) => (
          <Card key={l.id} sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                color={l.tipo === 'entrada' ? 'success' : 'error'}
                label={TIPO_LANCAMENTO_LABEL[l.tipo]}
                sx={{ width: 74 }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 13.5 }}>{l.descricao}</Typography>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                  {l.categoria} · {new Date(`${l.data}T12:00:00`).toLocaleDateString('pt-BR')}
                  {l.faturaId ? ' · automático (fatura)' : ''}
                </Typography>
              </Box>
              <Typography
                sx={{
                  ...MONO,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: l.tipo === 'entrada' ? 'success.main' : 'error.main',
                }}
              >
                {l.tipo === 'entrada' ? '+' : '−'} {formatarReais(l.valor)}
              </Typography>
              {podeLancar && !l.faturaId && (
                <Button size="small" disabled={ocupado} onClick={() => void remover(l.id)}>
                  Remover
                </Button>
              )}
            </Stack>
          </Card>
        ))}
      </Stack>

      {criando && (
        <DialogoLancamento
          aoFechar={() => setCriando(false)}
          aoSalvar={() => {
            setCriando(false);
            carregar();
          }}
        />
      )}
    </Stack>
  );
}

function DialogoLancamento({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: () => void }) {
  const [tipo, setTipo] = useState<TipoLancamento>('saida');
  const [categoria, setCategoria] = useState('Outros');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/financeiro/lancamentos', {
        tipo,
        categoria,
        descricao: descricao.trim(),
        valor: Number(valor.replace(',', '.')),
        data,
      });
      aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível lançar.');
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16 }}>Novo lançamento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {erro && <Alert severity="error">{erro}</Alert>}
          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoLancamento)}
              sx={{ width: 130 }}
            >
              <MenuItem value="entrada">Entrada</MenuItem>
              <MenuItem value="saida">Saída</MenuItem>
            </TextField>
            <TextField
              select
              label="Categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              sx={{ flex: 1 }}
            >
              {CATEGORIAS_SUGERIDAS.filter((c) => c !== 'Recebimento de fatura').map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Valor (R$)"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              type="date"
              label="Data"
              value={data}
              onChange={(e) => setData(e.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={
            ocupado || !descricao.trim() || !Number.isFinite(Number(valor.replace(',', '.')))
          }
          onClick={() => void salvar()}
        >
          Lançar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
