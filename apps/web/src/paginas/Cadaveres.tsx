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
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  CONSERVACAO_CADAVER,
  CONSERVACAO_CADAVER_LABEL,
  DESTINACAO_CADAVER,
  DESTINACAO_CADAVER_LABEL,
  EMBALAGEM_CADAVER,
  IDENTIFICACAO_EXTERNA,
  INTEGRIDADE_CADAVER,
  STATUS_CADAVER,
  STATUS_CADAVER_LABEL,
  TIPO_BLOQUEIO_CADAVER,
  TIPO_BLOQUEIO_CADAVER_LABEL,
  TIPO_MOVIMENTACAO_CADAVER_LABEL,
  type StatusCadaver,
} from '@lapato/shared';
import {
  api,
  ErroApi,
  type CadaverLista,
  type FichaCadaver,
  type LocalFisicoAdmin,
  type MapaArmazenamento,
} from '../api';

/**
 * M15 - Controle de Cadaveres.
 *
 * A tela existe para responder, sem consultar ninguem (secao 4): quem esta sob
 * responsabilidade do laboratorio, onde, ha quanto tempo e o que impede a
 * saida.
 *
 * Duas escolhas que vem direto da documentacao:
 *
 * - **O mapa mostra quem esta fora.** A secao 29 e explicita: nenhum cadaver
 *   desaparece do mapa quando e retirado. Um corpo na sala de necropsia que
 *   sumisse da tela seria um corpo que ninguem procura.
 * - **Liberado e retirado aparecem separados.** A secao 43 separa os dois
 *   estados porque juntar faz o laboratorio perder a conta de quem ainda esta
 *   no predio - e o painel mostra exatamente essa conta.
 */

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const COR_STATUS: Partial<Record<StatusCadaver, 'default' | 'primary' | 'success' | 'warning'>> = {
  recebido: 'warning',
  armazenado: 'primary',
  aguardando_necropsia: 'warning',
  em_necropsia: 'warning',
  aguardando_liberacao: 'warning',
  liberado: 'success',
  retirado: 'default',
  destinado: 'default',
};

function horasFora(desde: string | null): string | null {
  if (!desde) return null;
  const minutos = Math.floor((Date.now() - new Date(desde).getTime()) / 60_000);
  const h = Math.floor(minutos / 60);
  return `${String(h).padStart(2, '0')}h${String(minutos % 60).padStart(2, '0')}min`;
}

export function Cadaveres({ permissoes }: { permissoes: string[] }) {
  const [aba, setAba] = useState<'painel' | 'mapa'>('painel');
  const [lista, setLista] = useState<CadaverLista[] | null>(null);
  const [mapa, setMapa] = useState<MapaArmazenamento | null>(null);
  const [filtro, setFiltro] = useState<StatusCadaver | 'todos'>('todos');
  const [busca, setBusca] = useState('');
  const [recebendo, setRecebendo] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const podeReceber = permissoes.includes('cadaver:receber');

  const recarregar = useCallback(() => {
    const q = new URLSearchParams();
    if (filtro !== 'todos') q.set('status', filtro);
    if (busca.trim()) q.set('q', busca.trim());

    api
      .get<CadaverLista[]>(`/cadaveres?${q.toString()}`)
      .then(setLista)
      .catch(() => setErro('Não foi possível carregar os cadáveres.'));
    api
      .get<MapaArmazenamento>('/cadaveres/mapa')
      .then(setMapa)
      .catch(() => undefined);
  }, [filtro, busca]);

  useEffect(recarregar, [recarregar]);

  // Secao 37: o painel conta o que importa para a operacao do dia.
  const indicadores = useMemo(() => {
    const todos = lista ?? [];
    return [
      { rotulo: 'Armazenados', valor: todos.filter((c) => c.status === 'armazenado').length },
      { rotulo: 'Em necropsia', valor: todos.filter((c) => c.status === 'em_necropsia').length },
      {
        // Secao 36: "cadaver liberado, porem ainda armazenado" e um alerta.
        rotulo: 'Liberados aguardando retirada',
        valor: todos.filter((c) => c.status === 'liberado').length,
      },
      { rotulo: 'Com bloqueio', valor: todos.filter((c) => c.bloqueios > 0).length },
    ];
  }, [lista]);

  return (
    <Box sx={{ maxWidth: 1080 }}>
      <Stack
        direction="row"
        sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h2">Controle de Cadáveres</Typography>
        {podeReceber && (
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setRecebendo(true)}
          >
            Registrar entrada
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Quem está sob responsabilidade do laboratório, onde está e o que impede a saída.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ mb: 3, flexWrap: 'wrap' }}>
        {indicadores.map((i) => (
          <Card key={i.rotulo} sx={{ px: 2, py: 1.5, minWidth: 150 }}>
            <Typography sx={{ fontSize: 24, fontWeight: 600 }}>{i.valor}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{i.rotulo}</Typography>
          </Card>
        ))}
      </Stack>

      <Tabs value={aba} onChange={(_, v: 'painel' | 'mapa') => setAba(v)} sx={{ mb: 2 }}>
        <Tab value="painel" label="Painel" />
        <Tab value="mapa" label="Mapa de armazenamento" />
      </Tabs>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {aba === 'painel' && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField
              size="small"
              label="Buscar"
              placeholder="Identificador, nome ou microchip"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              select
              label="Situação"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as StatusCadaver | 'todos')}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="todos">Todas</MenuItem>
              {STATUS_CADAVER.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_CADAVER_LABEL[s]}
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
            <Alert severity="info">Nenhum cadáver com esses critérios.</Alert>
          ) : (
            <Stack spacing={1}>
              {lista.map((c) => (
                <Card
                  key={c.id}
                  sx={{ p: 2, cursor: 'pointer' }}
                  onClick={() => setFichaId(c.id)}
                >
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
                          {c.identificador}
                        </Typography>
                        <Typography sx={{ fontSize: 14 }}>{c.nomeAnimal ?? '—'}</Typography>
                        <Chip
                          size="small"
                          color={COR_STATUS[c.status as StatusCadaver] ?? 'default'}
                          label={STATUS_CADAVER_LABEL[c.status as StatusCadaver] ?? c.status}
                        />
                        {c.bloqueios > 0 && (
                          <Chip
                            size="small"
                            color="error"
                            variant="outlined"
                            label={`${c.bloqueios} bloqueio(s)`}
                          />
                        )}
                        {/* Secao 6: enquanto nao houver caso, a ficha grita. */}
                        {!c.casoId && (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label="Cadastro incompleto"
                          />
                        )}
                      </Stack>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                        {c.especie}
                        {c.casoIdentificador ? ` · ${c.casoIdentificador}` : ''}
                        {c.conservacaoAtual
                          ? ` · ${CONSERVACAO_CADAVER_LABEL[c.conservacaoAtual as keyof typeof CONSERVACAO_CADAVER_LABEL]}`
                          : ''}
                      </Typography>
                    </Box>

                    <Box sx={{ flexShrink: 0, textAlign: { md: 'right' } }}>
                      <Typography sx={{ ...MONO, fontSize: 13 }}>
                        {c.localCodigo ?? (c.foraDesde ? 'Fora do armazenamento' : '—')}
                      </Typography>
                      {/* Secao 30: quanto tempo fora da refrigeracao. */}
                      {c.foraDesde && (
                        <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
                          há {horasFora(c.foraDesde)}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </>
      )}

      {aba === 'mapa' && <Mapa mapa={mapa} aoAbrir={setFichaId} />}

      <DialogoRecebimento
        aberto={recebendo}
        aoFechar={() => setRecebendo(false)}
        aoSalvar={() => {
          setRecebendo(false);
          recarregar();
        }}
      />

      <DialogoFicha
        cadaverId={fichaId}
        permissoes={permissoes}
        aoFechar={() => setFichaId(null)}
        aoMudar={recarregar}
      />
    </Box>
  );
}

/**
 * Mapa visual (secao 19).
 *
 * As posicoes vem em arvore (`paiId`); aqui elas sao agrupadas pelo pai, que na
 * pratica e o equipamento - a camara, o freezer. Posicao sem pai aparece
 * sozinha, porque um deposito pode nao ter subdivisao.
 */
function Mapa({
  mapa,
  aoAbrir,
}: {
  mapa: MapaArmazenamento | null;
  aoAbrir: (id: string) => void;
}) {
  if (!mapa) return <Skeleton variant="rounded" height={200} />;

  const porPai = new Map<string, typeof mapa.posicoes>();
  // Codigo junto do nome: duas camaras podem se chamar igual, e o cabecalho
  // precisa distinguir uma da outra.
  const nomes = new Map(mapa.posicoes.map((p) => [p.id, `${p.codigo} — ${p.nome}`]));
  const filhos = new Set(mapa.posicoes.flatMap((p) => (p.paiId ? [p.paiId] : [])));

  for (const p of mapa.posicoes) {
    // Um equipamento que tem filhos e cabecalho, nao posicao.
    if (filhos.has(p.id)) continue;
    const chave = p.paiId ?? 'sem-equipamento';
    porPai.set(chave, [...(porPai.get(chave) ?? []), p]);
  }

  if (porPai.size === 0) {
    return (
      <Alert severity="info">
        <AlertTitle>Nenhum local de armazenamento cadastrado</AlertTitle>
        As câmaras, prateleiras e posições são cadastradas em{' '}
        <strong>Administração → Locais físicos</strong>. Sem elas não há onde armazenar.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      {[...porPai.entries()].map(([paiId, posicoes]) => (
        <Card key={paiId} sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5 }}>
            {nomes.get(paiId) ?? 'Sem equipamento'}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {posicoes.map((p) => (
              <Box
                key={p.id}
                onClick={() => p.ocupanteId && aoAbrir(p.ocupanteId)}
                sx={{
                  minWidth: 132,
                  p: 1.25,
                  borderRadius: 1,
                  border: 1,
                  borderColor: p.ocupanteId ? 'primary.main' : 'divider',
                  bgcolor: p.ocupanteId ? 'action.hover' : 'transparent',
                  cursor: p.ocupanteId ? 'pointer' : 'default',
                }}
              >
                <Typography sx={{ ...MONO, fontSize: 12, color: 'text.secondary' }}>
                  {p.codigo}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: p.ocupanteId ? 600 : 400 }}>
                  {p.ocupanteIdentificador ?? 'Livre'}
                </Typography>
                {p.ocupanteNome && (
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                    {p.ocupanteNome}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Card>
      ))}

      {/* Secao 29: nenhum cadaver desaparece do mapa quando e retirado. */}
      {mapa.foraDoArmazenamento.length > 0 && (
        <Card sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Fora do armazenamento</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
            Continuam sob responsabilidade do laboratório, só não estão numa posição.
          </Typography>
          <Stack spacing={0.75}>
            {mapa.foraDoArmazenamento.map((c) => (
              <Stack
                key={c.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', cursor: 'pointer' }}
                onClick={() => aoAbrir(c.id)}
              >
                <Typography sx={{ ...MONO, fontSize: 13 }}>{c.identificador}</Typography>
                <Typography sx={{ fontSize: 13 }}>{c.nomeAnimal ?? '—'}</Typography>
                <Chip size="small" color="warning" label={`saiu de ${c.origemCodigo ?? '—'}`} />
                {c.foraDesde && (
                  <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
                    há {horasFora(c.foraDesde)}
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

function DialogoRecebimento({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [especie, setEspecie] = useState('');
  const [nomeAnimal, setNomeAnimal] = useState('');
  const [sexo, setSexo] = useState('');
  const [microchip, setMicrochip] = useState('');
  const [origem, setOrigem] = useState('');
  const [conservacao, setConservacao] = useState('refrigerado');
  const [embalagem, setEmbalagem] = useState('');
  const [integridade, setIntegridade] = useState('');
  const [identificacao, setIdentificacao] = useState('');
  const [prazo, setPrazo] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setEspecie('');
    setNomeAnimal('');
    setSexo('');
    setMicrochip('');
    setOrigem('');
    setConservacao('refrigerado');
    setEmbalagem('');
    setIntegridade('');
    setIdentificacao('');
    setPrazo('');
    setObservacoes('');
    setErro(null);
  }, [aberto]);

  if (!aberto) return null;

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/cadaveres', {
        especie: especie.trim(),
        nomeAnimal: nomeAnimal.trim() || null,
        sexo: sexo || null,
        microchip: microchip.trim() || null,
        origemResponsavel: origem.trim() || null,
        conservacaoRecebimento: conservacao || null,
        embalagem: embalagem || null,
        integridade: integridade || null,
        identificacaoExterna: identificacao || null,
        prazoGuardaDias: prazo ? Number(prazo) : null,
        observacoesRecebimento: observacoes.trim() || null,
      });
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível registrar a entrada.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>Registrar entrada de cadáver</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          O caso pode vir depois. Um corpo que chega antes do cadastro administrativo entra
          assim mesmo, marcado como cadastro incompleto — recusá-lo aqui significaria um corpo
          sem registro nenhum na câmara.
        </Typography>

        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Espécie"
              value={especie}
              onChange={(e) => setEspecie(e.target.value)}
              required
              autoFocus
              sx={{ flex: 1 }}
            />
            <TextField
              label="Nome do animal"
              value={nomeAnimal}
              onChange={(e) => setNomeAnimal(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Sexo"
              value={sexo}
              onChange={(e) => setSexo(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">Não informado</MenuItem>
              <MenuItem value="macho">Macho</MenuItem>
              <MenuItem value="femea">Fêmea</MenuItem>
            </TextField>
            <TextField
              label="Microchip"
              value={microchip}
              onChange={(e) => setMicrochip(e.target.value)}
              helperText="Conferido de novo antes da necropsia e da liberação."
              sx={{ flex: 1 }}
            />
          </Stack>

          <TextField
            label="Origem / responsável pela entrega"
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
          />

          <Divider textAlign="left" sx={{ fontSize: 12 }}>
            Condições de recebimento
          </Divider>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Conservação"
              value={conservacao}
              onChange={(e) => setConservacao(e.target.value)}
              sx={{ flex: 1 }}
            >
              {CONSERVACAO_CADAVER.map((c) => (
                <MenuItem key={c} value={c}>
                  {CONSERVACAO_CADAVER_LABEL[c]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Embalagem"
              value={embalagem}
              onChange={(e) => setEmbalagem(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">Não informada</MenuItem>
              {EMBALAGEM_CADAVER.map((e) => (
                <MenuItem key={e} value={e}>
                  {e.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Integridade"
              value={integridade}
              onChange={(e) => setIntegridade(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">Não informada</MenuItem>
              {INTEGRIDADE_CADAVER.map((i) => (
                <MenuItem key={i} value={i}>
                  {i.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Identificação externa"
              value={identificacao}
              onChange={(e) => setIdentificacao(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">Não informada</MenuItem>
              {IDENTIFICACAO_EXTERNA.map((i) => (
                <MenuItem key={i} value={i}>
                  {i}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            label="Prazo de guarda (dias)"
            type="number"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            helperText="Vira a data prevista para retirada ou destinação."
          />

          <TextField
            label="Observações"
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            multiline
            minRows={2}
          />

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button variant="contained" disabled={ocupado || !especie.trim()} onClick={() => void salvar()}>
          Registrar entrada
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Ficha operacional (secao 10): o que o QR Code abriria. */
function DialogoFicha({
  cadaverId,
  permissoes,
  aoFechar,
  aoMudar,
}: {
  cadaverId: string | null;
  permissoes: string[];
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [ficha, setFicha] = useState<FichaCadaver | null>(null);
  const [locais, setLocais] = useState<LocalFisicoAdmin[]>([]);
  const [destino, setDestino] = useState('');
  const [motivoBloqueio, setMotivoBloqueio] = useState('');
  const [tipoBloqueio, setTipoBloqueio] = useState('nao_liberar');
  const [destinacao, setDestinacao] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [entregaNome, setEntregaNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const podeMovimentar = permissoes.includes('cadaver:movimentar');
  const podeBloquear = permissoes.includes('cadaver:bloquear');
  const podeLiberar = permissoes.includes('cadaver:liberar');
  const podeEntregar = permissoes.includes('cadaver:entregar');

  const recarregar = useCallback(() => {
    if (!cadaverId) return;
    api
      .get<FichaCadaver>(`/cadaveres/${cadaverId}`)
      .then(setFicha)
      .catch(() => setErro('Não foi possível carregar a ficha.'));
  }, [cadaverId]);

  useEffect(() => {
    setFicha(null);
    setErro(null);
    setDestino('');
    setMotivoBloqueio('');
    setDestinacao('');
    setJustificativa('');
    setEntregaNome('');
    recarregar();
    if (cadaverId) {
      api
        .get<LocalFisicoAdmin[]>('/administracao/locais')
        .then((ls) => setLocais(ls.filter((l) => !l.inativadoEm)))
        .catch(() => setLocais([]));
    }
  }, [cadaverId, recarregar]);

  if (!cadaverId) return null;

  async function agir(acao: () => Promise<unknown>, padrao: string) {
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      recarregar();
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : padrao);
    } finally {
      setOcupado(false);
    }
  }

  const c = ficha?.cadaver;
  const bloqueiosAtivos = (ficha?.bloqueios ?? []).filter((b) => !b.resolvidoEm);
  const noLaboratorio = c && c.status !== 'retirado' && c.status !== 'destinado';

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="md">
      <DialogTitle sx={MONO}>{c?.identificador ?? 'Ficha'}</DialogTitle>
      <DialogContent>
        {!ficha ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
                {c!.nomeAnimal ?? 'Sem nome'}
              </Typography>
              <Chip
                size="small"
                color={COR_STATUS[c!.status as StatusCadaver] ?? 'default'}
                label={STATUS_CADAVER_LABEL[c!.status as StatusCadaver] ?? c!.status}
              />
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                {c!.especie}
                {c!.microchip ? ` · microchip ${c!.microchip}` : ''}
                {ficha.local ? ` · ${ficha.local.codigo}` : ''}
              </Typography>
            </Stack>

            {ficha.cadastroIncompleto && (
              <Alert severity="warning">
                <AlertTitle>Cadastro incompleto</AlertTitle>
                Entrada provisória: este cadáver ainda não está vinculado a um caso.
              </Alert>
            )}

            {bloqueiosAtivos.length > 0 && (
              <Alert severity="error">
                <AlertTitle>
                  {bloqueiosAtivos.length} bloqueio(s) impedindo a saída
                </AlertTitle>
                <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {bloqueiosAtivos.map((b) => (
                    <Box component="li" key={b.id}>
                      <Typography sx={{ fontSize: 13 }}>
                        {TIPO_BLOQUEIO_CADAVER_LABEL[
                          b.tipo as keyof typeof TIPO_BLOQUEIO_CADAVER_LABEL
                        ] ?? b.tipo}
                        : {b.motivo}
                      </Typography>
                      {podeLiberar && (
                        <Button
                          size="small"
                          disabled={ocupado}
                          onClick={() => {
                            const j = window.prompt('Como o bloqueio foi resolvido?');
                            if (j && j.trim().length >= 5) {
                              void agir(
                                () =>
                                  api.post(`/cadaveres/bloqueios/${b.id}/resolucao`, {
                                    justificativa: j.trim(),
                                  }),
                                'Não foi possível resolver o bloqueio.',
                              );
                            }
                          }}
                        >
                          Resolver
                        </Button>
                      )}
                    </Box>
                  ))}
                </Stack>
              </Alert>
            )}

            {c!.foraDesde && (
              <Alert severity="warning">
                Fora do armazenamento há {horasFora(c!.foraDesde)}.
              </Alert>
            )}

            {noLaboratorio && (
              <Card sx={{ p: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1.5 }}>Ações</Typography>
                <Stack spacing={1.5}>
                  {podeMovimentar && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        size="small"
                        select
                        label="Posição"
                        value={destino}
                        onChange={(e) => setDestino(e.target.value)}
                        sx={{ flex: 1 }}
                      >
                        {locais.map((l) => (
                          <MenuItem key={l.id} value={l.id}>
                            {l.codigo} — {l.nome}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button
                        disabled={ocupado || !destino}
                        onClick={() =>
                          void agir(
                            () =>
                              api.post(`/cadaveres/${cadaverId}/armazenamento`, {
                                localId: destino,
                              }),
                            'Não foi possível armazenar.',
                          )
                        }
                      >
                        {c!.status === 'em_necropsia' ? 'Retornar ao armazenamento' : 'Armazenar'}
                      </Button>
                    </Stack>
                  )}

                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {podeMovimentar && c!.status !== 'em_necropsia' && (
                      <Button
                        size="small"
                        disabled={ocupado}
                        onClick={() =>
                          void agir(
                            () => api.post(`/cadaveres/${cadaverId}/retirada-necropsia`, {}),
                            'Não foi possível retirar para necropsia.',
                          )
                        }
                      >
                        Retirar para necropsia
                      </Button>
                    )}
                    {podeLiberar && c!.status !== 'liberado' && (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={ocupado}
                        onClick={() =>
                          void agir(
                            () => api.post(`/cadaveres/${cadaverId}/liberacao`),
                            'Não foi possível liberar.',
                          )
                        }
                      >
                        Liberar
                      </Button>
                    )}
                  </Stack>

                  {podeBloquear && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        size="small"
                        select
                        label="Bloqueio"
                        value={tipoBloqueio}
                        onChange={(e) => setTipoBloqueio(e.target.value)}
                        sx={{ minWidth: 210 }}
                      >
                        {TIPO_BLOQUEIO_CADAVER.map((t) => (
                          <MenuItem key={t} value={t}>
                            {TIPO_BLOQUEIO_CADAVER_LABEL[t]}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        size="small"
                        label="Motivo"
                        value={motivoBloqueio}
                        onChange={(e) => setMotivoBloqueio(e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <Button
                        disabled={ocupado || motivoBloqueio.trim().length < 5}
                        onClick={() =>
                          void agir(
                            () =>
                              api.post(`/cadaveres/${cadaverId}/bloqueios`, {
                                tipo: tipoBloqueio,
                                motivo: motivoBloqueio.trim(),
                              }),
                            'Não foi possível bloquear.',
                          ).then(() => setMotivoBloqueio(''))
                        }
                      >
                        Bloquear
                      </Button>
                    </Stack>
                  )}

                  {podeLiberar && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        size="small"
                        select
                        label="Destinação"
                        value={destinacao}
                        onChange={(e) => setDestinacao(e.target.value)}
                        sx={{ minWidth: 230 }}
                      >
                        {DESTINACAO_CADAVER.map((d) => (
                          <MenuItem key={d} value={d}>
                            {DESTINACAO_CADAVER_LABEL[d]}
                          </MenuItem>
                        ))}
                      </TextField>
                      {/* Secao 41: alterar a escolha anterior exige justificativa. */}
                      {c!.destinacao && (
                        <TextField
                          size="small"
                          label="Justificativa da mudança"
                          value={justificativa}
                          onChange={(e) => setJustificativa(e.target.value)}
                          sx={{ flex: 1 }}
                        />
                      )}
                      <Button
                        disabled={ocupado || !destinacao}
                        onClick={() =>
                          void agir(
                            () =>
                              api.post(`/cadaveres/${cadaverId}/destinacao`, {
                                destinacao,
                                justificativa: justificativa.trim() || null,
                              }),
                            'Não foi possível definir a destinação.',
                          )
                        }
                      >
                        Definir destinação
                      </Button>
                    </Stack>
                  )}

                  {podeEntregar && c!.status === 'liberado' && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        size="small"
                        label="Quem está retirando"
                        value={entregaNome}
                        onChange={(e) => setEntregaNome(e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <Button
                        variant="contained"
                        disabled={ocupado || entregaNome.trim().length < 3}
                        onClick={() =>
                          void agir(
                            () =>
                              api.post(`/cadaveres/${cadaverId}/entrega`, {
                                nome: entregaNome.trim(),
                              }),
                            'Não foi possível registrar a entrega.',
                          )
                        }
                      >
                        Registrar saída física
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Card>
            )}

            {/* Secao 66: a linha do tempo do cadaver. */}
            <Card sx={{ p: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Histórico</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
                Reconstrói onde o corpo esteve e como foi conservado. Nada é apagado.
              </Typography>
              <Stack spacing={1}>
                {ficha.movimentacoes.map((m) => (
                  <Stack key={m.id} direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', minWidth: 128 }}>
                      {new Date(m.ocorridoEm).toLocaleString('pt-BR')}
                    </Typography>
                    <Typography sx={{ fontSize: 13 }}>
                      {TIPO_MOVIMENTACAO_CADAVER_LABEL[
                        m.tipo as keyof typeof TIPO_MOVIMENTACAO_CADAVER_LABEL
                      ] ?? m.tipo}
                      {m.origem || m.destino || m.destinoDescricao ? ' · ' : ''}
                      <Typography component="span" sx={{ ...MONO, fontSize: 12 }}>
                        {m.origem ?? ''}
                        {m.origem && (m.destino || m.destinoDescricao) ? ' → ' : ''}
                        {m.destino ?? m.destinoDescricao ?? ''}
                      </Typography>
                      {m.conservacao
                        ? ` · ${CONSERVACAO_CADAVER_LABEL[m.conservacao as keyof typeof CONSERVACAO_CADAVER_LABEL]}`
                        : ''}
                      {m.usuario ? ` · ${m.usuario}` : ''}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Card>

            {ficha.destinacoes.length > 0 && (
              <Card sx={{ p: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Destinação</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
                  A escolha anterior é preservada — alterar não sobrescreve.
                </Typography>
                {ficha.destinacoes.map((d) => (
                  <Typography key={d.id} sx={{ fontSize: 13 }}>
                    {d.anterior
                      ? `${DESTINACAO_CADAVER_LABEL[d.anterior as keyof typeof DESTINACAO_CADAVER_LABEL]} → `
                      : ''}
                    {DESTINACAO_CADAVER_LABEL[d.nova as keyof typeof DESTINACAO_CADAVER_LABEL]}
                    {d.justificativa ? ` · ${d.justificativa}` : ''}
                  </Typography>
                ))}
              </Card>
            )}

            {erro && <Alert severity="error">{erro}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
