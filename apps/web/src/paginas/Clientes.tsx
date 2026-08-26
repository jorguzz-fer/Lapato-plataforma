import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import { TIPO_CLIENTE } from '@lapato/shared';
import {
  api,
  ErroApi,
  type ClienteFicha,
  type ClienteLista,
  type DuplicidadeCadastral,
  type VeterinarioLista,
} from '../api';
import {
  BotaoAtivacao,
  CabecalhoCadastro,
  CampoBusca,
  MONO,
  STATUS_LABEL,
  Vazio,
} from './cadastro/comum';

/**
 * M03 - Cadastro de Clientes.
 *
 * Fonte unica de verdade cadastral (secao 1): o cliente e cadastrado uma vez e
 * reutilizado por todos os modulos. As regras que moldam a tela:
 *
 * - **Inativar, nunca excluir**: a ficha historica continua acessivel; inativo
 *   apenas some das opcoes de exame novo.
 * - **Duplicidade e conversa, nao muro** (secao 20): o 409 traz os candidatos;
 *   o usuario abre o existente ou confirma que e outro - e a confirmacao fica
 *   na auditoria.
 * - **O codigo compoe o registro do exame** (secao 6.2, `CV-000342/26`): por
 *   isso e exigido na criacao e nao aparece na edicao.
 *
 * O veterinario tem tela propria: e uma pessoa com N vinculos (secao 12), nao
 * um atributo do cliente. O que pertence as duas telas e o **vinculo**, e ele
 * mora aqui, na ficha do cliente - quem abre a ficha de uma clinica quer ver
 * quem atende por ela.
 */

const TIPO_LABEL: Record<string, string> = {
  clinica: 'Clínica',
  hospital: 'Hospital',
  veterinario_autonomo: 'Veterinário autônomo',
  laboratorio_parceiro: 'Laboratório parceiro',
  universidade: 'Universidade',
  instituicao_publica: 'Instituição pública',
  ong: 'ONG',
  centro_pesquisa: 'Centro de pesquisa',
  empresa: 'Empresa',
  tutor_particular: 'Tutor particular',
  outro: 'Outro',
};

interface Props {
  permissoes: string[];
}

export function Clientes({ permissoes }: Props) {
  const [busca, setBusca] = useState('');
  const [clientes, setClientes] = useState<ClienteLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);

  const podeCriar = permissoes.includes('cliente:criar');
  const podeEditar = permissoes.includes('cliente:editar');
  /** Editar vínculos na ficha exige a permissão do outro cadastro. */
  const podeEditarVinculos = permissoes.includes('veterinario:editar');

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    const q = busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : '';
    api
      .get<ClienteLista[]>(`/clientes${q}`)
      .then(setClientes)
      .catch(() => setErro('Não foi possível carregar os clientes.'))
      .finally(() => setCarregando(false));
  }, [busca]);

  /** Busca com pausa curta: cada tecla não vira uma consulta. */
  useEffect(() => {
    const timer = setTimeout(recarregar, busca ? 300 : 0);
    return () => clearTimeout(timer);
  }, [recarregar, busca]);

  return (
    <Box component="section" sx={{ maxWidth: 1080 }}>
      <CabecalhoCadastro
        titulo="Clientes"
        descricao="Cadastrado uma vez, reutilizado em todos os módulos — nunca excluído, apenas inativado."
        acao={
          podeCriar ? (
            <Button
              size="small"
              variant="contained"
              startIcon={<AddOutlined />}
              onClick={() => setCriando(true)}
            >
              Novo cliente
            </Button>
          ) : undefined
        }
      />

      <CampoBusca
        valor={busca}
        aoMudar={setBusca}
        placeholder="Nome, razão social, CNPJ/CPF ou código…"
      />

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {carregando && (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Stack>
      )}

      {!carregando && (
        <Stack spacing={1.5}>
          {clientes.length === 0 && <Vazio texto="Nenhum cliente encontrado." />}
          {clientes.map((c) => (
            <Card
              key={c.id}
              sx={{ p: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
              onClick={() => setFichaId(c.id)}
            >
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography
                      sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'primary.main' }}
                    >
                      {c.codigo}
                    </Typography>
                    <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>
                      {c.nomeFantasia}
                    </Typography>
                    <Chip size="small" variant="outlined" label={TIPO_LABEL[c.tipo] ?? c.tipo} />
                    {c.status !== 'ativo' && (
                      <Chip
                        size="small"
                        color={c.status === 'inativo' ? 'default' : 'warning'}
                        label={STATUS_LABEL[c.status] ?? c.status}
                      />
                    )}
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                    {c.documento ? `${c.documento} · ` : ''}
                    {c.totalCasos} {c.totalCasos === 1 ? 'caso' : 'casos'}
                  </Typography>
                </Box>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <DialogoNovoCliente
        aberto={criando}
        aoFechar={() => setCriando(false)}
        aoCriar={() => {
          setCriando(false);
          recarregar();
        }}
      />

      {fichaId && (
        <FichaCliente
          id={fichaId}
          podeEditar={podeEditar}
          podeEditarVinculos={podeEditarVinculos}
          aoFechar={() => setFichaId(null)}
          aoMudar={recarregar}
        />
      )}
    </Box>
  );
}

// --- criação de cliente, com o fluxo de duplicidade -------------------------

function DialogoNovoCliente({
  aberto,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [tipo, setTipo] = useState('clinica');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [duplicidades, setDuplicidades] = useState<DuplicidadeCadastral[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar(ignorarDuplicidade = false) {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/clientes', {
        nomeFantasia: nomeFantasia.trim(),
        ...(razaoSocial.trim() ? { razaoSocial: razaoSocial.trim() } : {}),
        ...(documento.trim() ? { documento: documento.trim() } : {}),
        tipo,
        codigo: codigo.trim().toUpperCase(),
        ...(ignorarDuplicidade ? { ignorarDuplicidade: true } : {}),
      });
      setNomeFantasia('');
      setRazaoSocial('');
      setDocumento('');
      setCodigo('');
      setDuplicidades(null);
      aoCriar();
    } catch (err) {
      if (err instanceof ErroApi && err.possivelDuplicidade) {
        setDuplicidades(err.duplicidades!);
      } else {
        setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar o cliente.');
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>Novo cliente</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome fantasia"
            value={nomeFantasia}
            onChange={(e) => setNomeFantasia(e.target.value)}
            required
            autoFocus
          />
          <TextField
            label="Razão social"
            value={razaoSocial}
            onChange={(e) => setRazaoSocial(e.target.value)}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="CNPJ ou CPF"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              sx={{ flex: 1 }}
            >
              {TIPO_CLIENTE.map((t) => (
                <MenuItem key={t} value={t}>
                  {TIPO_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Código"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            required
            slotProps={{ htmlInput: { maxLength: 6, style: { textTransform: 'uppercase' } } }}
            helperText='Compõe o registro dos exames (ex.: "CV" em CV-000342/26) — único e definitivo.'
            sx={{ maxWidth: 220 }}
          />

          {/* M03 seção 20: candidatos junto do 409 - decidir sem recomeçar. */}
          {duplicidades && (
            <Alert severity="warning">
              <AlertTitle>Possível duplicidade</AlertTitle>
              <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                {duplicidades.map((d) => (
                  <li key={d.id}>
                    <Typography sx={{ fontSize: 13 }}>
                      {d.nomeFantasia} {d.codigo ? `(${d.codigo})` : ''}
                      {d.documento ? ` · ${d.documento}` : ''} · {STATUS_LABEL[d.status] ?? d.status}
                    </Typography>
                  </li>
                ))}
              </Stack>
              <Typography sx={{ fontSize: 12.5, mt: 1 }}>
                Se é o mesmo cliente, feche e use o cadastro existente. Se é outro, confirme abaixo —
                a confirmação fica na auditoria.
              </Typography>
            </Alert>
          )}

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        {duplicidades ? (
          <Button variant="contained" color="warning" onClick={() => void criar(true)} disabled={ocupado}>
            É outro cliente — criar mesmo assim
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void criar()}
            disabled={ocupado || !nomeFantasia.trim() || codigo.trim().length < 2}
          >
            {ocupado ? 'Criando…' : 'Criar'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// --- ficha do cliente ---------------------------------------------------------

function FichaCliente({
  id,
  podeEditar,
  podeEditarVinculos,
  aoFechar,
  aoMudar,
}: {
  id: string;
  podeEditar: boolean;
  podeEditarVinculos: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [ficha, setFicha] = useState<ClienteFicha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [observacoes, setObservacoes] = useState('');

  const recarregarFicha = useCallback(() => {
    api
      .get<ClienteFicha>(`/clientes/${id}`)
      .then((f) => {
        setFicha(f);
        setNomeFantasia(f.nomeFantasia);
        setRazaoSocial(f.razaoSocial ?? '');
        setDocumento(f.documento ?? '');
        setObservacoes(f.observacoes ?? '');
      })
      .catch(() => setErro('Não foi possível carregar a ficha.'));
  }, [id]);

  useEffect(recarregarFicha, [recarregarFicha]);

  async function agir(fn: () => Promise<unknown>, mensagemErro: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      recarregarFicha();
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagemErro);
    } finally {
      setOcupado(false);
    }
  }

  function salvarEdicao() {
    void agir(async () => {
      await api.post(`/clientes/${id}`, {
        nomeFantasia: nomeFantasia.trim(),
        razaoSocial: razaoSocial.trim(),
        documento: documento.trim(),
        observacoes: observacoes.trim(),
      });
      setEditando(false);
    }, 'Não foi possível salvar.');
  }

  const inativo = ficha?.inativadoEm !== null && ficha !== null;
  const vinculosVigentes = ficha?.vinculos.filter((v) => !v.terminoEm) ?? [];
  const vinculosEncerrados = ficha?.vinculos.filter((v) => v.terminoEm) ?? [];

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="md">
      {!ficha ? (
        <DialogContent>
          <Skeleton variant="rounded" height={280} />
        </DialogContent>
      ) : (
        <>
          <DialogTitle>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Box component="span" sx={{ ...MONO, color: 'primary.main' }}>
                {ficha.codigo}
              </Box>
              {ficha.nomeFantasia}
              <Chip size="small" variant="outlined" label={TIPO_LABEL[ficha.tipo] ?? ficha.tipo} />
              {inativo && <Chip size="small" label="Inativo" />}
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2.5}>
              {editando ? (
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <TextField
                    label="Nome fantasia"
                    value={nomeFantasia}
                    onChange={(e) => setNomeFantasia(e.target.value)}
                    required
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="Razão social"
                      value={razaoSocial}
                      onChange={(e) => setRazaoSocial(e.target.value)}
                      sx={{ flex: 1.4 }}
                    />
                    <TextField
                      label="CNPJ ou CPF"
                      value={documento}
                      onChange={(e) => setDocumento(e.target.value)}
                      sx={{ flex: 1 }}
                    />
                  </Stack>
                  <TextField
                    label="Observações administrativas"
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    multiline
                    minRows={2}
                  />
                </Stack>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 0.5 }}>
                  <Detalhe rotulo="Razão social" valor={ficha.razaoSocial ?? '—'} />
                  <Detalhe rotulo="CNPJ / CPF" valor={ficha.documento ?? '—'} />
                  <Detalhe
                    rotulo="Cadastrado em"
                    valor={new Date(ficha.criadoEm).toLocaleDateString('pt-BR')}
                  />
                </Stack>
              )}

              {!editando && ficha.observacoes && (
                <Detalhe rotulo="Observações" valor={ficha.observacoes} />
              )}

              <Divider />

              {/* Seções 13-15: vínculos vigentes e encerrados, sem apagar história. */}
              <Box>
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="h4">Veterinários vinculados</Typography>
                  {podeEditarVinculos && !inativo && (
                    <Button size="small" startIcon={<AddOutlined />} onClick={() => setVinculando(true)}>
                      Vincular
                    </Button>
                  )}
                </Stack>

                {vinculosVigentes.length === 0 && (
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1 }}>
                    Nenhum vínculo vigente.
                  </Typography>
                )}

                <Stack spacing={1} sx={{ mt: 1 }}>
                  {vinculosVigentes.map((v) => (
                    <Stack
                      key={v.id}
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                    >
                      <Typography sx={{ fontSize: 13.5 }}>
                        {v.nome}
                        {v.crmv && (
                          <Box component="span" sx={{ color: 'text.secondary', fontSize: 12.5 }}>
                            {' '}
                            · CRMV-{v.crmvUf} {v.crmv}
                          </Box>
                        )}
                        {v.principal && <Chip size="small" sx={{ ml: 1 }} label="Principal" />}
                      </Typography>
                      {podeEditarVinculos && (
                        <Button
                          size="small"
                          color="inherit"
                          disabled={ocupado}
                          onClick={() =>
                            void agir(
                              () => api.post(`/veterinarios/vinculos/${v.id}/encerramento`),
                              'Não foi possível encerrar o vínculo.',
                            )
                          }
                        >
                          Encerrar vínculo
                        </Button>
                      )}
                    </Stack>
                  ))}

                  {vinculosEncerrados.map((v) => (
                    <Typography key={v.id} sx={{ fontSize: 12.5, color: 'text.disabled' }}>
                      {v.nome} — encerrado em {new Date(v.terminoEm!).toLocaleDateString('pt-BR')}
                    </Typography>
                  ))}
                </Stack>
              </Box>

              <Divider />

              {/* Seção 30: consulta aos casos - o M03 não guarda cópia. */}
              <Box>
                <Typography variant="h4">Últimos exames</Typography>
                {ficha.casos.length === 0 && (
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1 }}>
                    Nenhum exame cadastrado para este cliente.
                  </Typography>
                )}
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  {ficha.casos.map((c) => (
                    <Typography key={c.id} sx={{ fontSize: 13 }}>
                      <Box
                        component={Link}
                        to={`/casos/${c.id}`}
                        sx={{ ...MONO, fontSize: 12.5, color: 'primary.main', fontWeight: 600 }}
                      >
                        {c.identificador}
                      </Box>
                      {c.paciente ? ` · ${c.paciente}` : ''}
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        {' · '}
                        {new Date(c.criadoEm).toLocaleDateString('pt-BR')}
                      </Box>
                    </Typography>
                  ))}
                </Stack>
              </Box>

              {erro && <Alert severity="error">{erro}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            {podeEditar && !editando && (
              <>
                <BotaoAtivacao
                  inativo={inativo}
                  caminho={`/clientes/${id}`}
                  aoMudar={() => {
                    recarregarFicha();
                    aoMudar();
                  }}
                />
                <Button onClick={() => setEditando(true)}>Editar</Button>
              </>
            )}
            {editando && (
              <>
                <Button onClick={() => setEditando(false)} disabled={ocupado}>
                  Descartar
                </Button>
                <Button variant="contained" onClick={salvarEdicao} disabled={ocupado || !nomeFantasia.trim()}>
                  Salvar
                </Button>
              </>
            )}
            {!editando && (
              <Button variant="contained" onClick={aoFechar}>
                Fechar
              </Button>
            )}
          </DialogActions>

          {vinculando && (
            <DialogoVincular
              clienteId={id}
              aoFechar={() => setVinculando(false)}
              aoVincular={() => {
                setVinculando(false);
                recarregarFicha();
                aoMudar();
              }}
            />
          )}
        </>
      )}
    </Dialog>
  );
}

/** Seleciona um veterinário da base e cria o vínculo (M03 seção 18). */
function DialogoVincular({
  clienteId,
  aoFechar,
  aoVincular,
}: {
  clienteId: string;
  aoFechar: () => void;
  aoVincular: () => void;
}) {
  const [veterinarios, setVeterinarios] = useState<VeterinarioLista[]>([]);
  const [veterinarioId, setVeterinarioId] = useState('');
  const [principal, setPrincipal] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api
      .get<VeterinarioLista[]>('/veterinarios')
      .then((lista) => setVeterinarios(lista.filter((v) => !v.inativadoEm)))
      .catch(() => setVeterinarios([]));
  }, []);

  async function vincular() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/veterinarios/${veterinarioId}/vinculos`, { clienteId, principal });
      aoVincular();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível vincular.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle>Vincular veterinário</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Veterinário"
            value={veterinarioId}
            onChange={(e) => setVeterinarioId(e.target.value)}
            required
            helperText="Busca em toda a base — a pessoa é única; o vínculo é que é novo."
          >
            {veterinarios.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.nome}
                {v.crmv ? ` (CRMV-${v.crmvUf} ${v.crmv})` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Referência do cliente?"
            value={principal ? 'sim' : 'nao'}
            onChange={(e) => setPrincipal(e.target.value === 'sim')}
          >
            <MenuItem value="nao">Não</MenuItem>
            <MenuItem value="sim">Sim — veterinário principal</MenuItem>
          </TextField>
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void vincular()} disabled={ocupado || !veterinarioId}>
          Vincular
        </Button>
      </DialogActions>
    </Dialog>
  );
}


function Detalhe({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 13.5 }}>{valor}</Typography>
    </Box>
  );
}

