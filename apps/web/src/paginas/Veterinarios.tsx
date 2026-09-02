import { useCallback, useEffect, useState } from 'react';
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
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  api,
  ErroApi,
  type ClienteResumo,
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
 * M03 - Cadastro de Veterinarios.
 *
 * Tela propria, e nao aba de Clientes, porque as duas coisas nao sao a mesma:
 * o cliente e a instituicao que envia material e cujo codigo compoe o registro
 * do exame; o veterinario e a **pessoa** que assina a solicitacao, e a secao 12
 * e explicita ao trata-lo como pessoa unica com N vinculos - o mesmo
 * profissional atende por varias clinicas sem virar varios cadastros.
 *
 * Duas regras do modulo moldam esta tela:
 *
 * - **Duplicidade de CRMV oferece VINCULAR, nunca recadastrar** (secao 13). O
 *   409 traz os candidatos, e o caminho de saida e abrir o existente.
 * - **Inativar, nunca excluir**: o historico dos casos que ele assinou
 *   continua intacto; inativo apenas some das opcoes de exame novo.
 *
 * O vinculo veterinario x cliente e editado na ficha do cliente, e nao aqui:
 * quem esta cadastrando a pessoa raramente sabe, naquele momento, por quais
 * clinicas ela atende.
 */

interface Props {
  permissoes: string[];
}

export function Veterinarios({ permissoes }: Props) {
  const [busca, setBusca] = useState('');
  const [veterinarios, setVeterinarios] = useState<VeterinarioLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [emEdicao, setEmEdicao] = useState<VeterinarioLista | null>(null);

  const podeCriar = permissoes.includes('veterinario:criar');
  const podeEditar = permissoes.includes('veterinario:editar');

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    const q = busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : '';
    api
      .get<VeterinarioLista[]>(`/veterinarios${q}`)
      .then(setVeterinarios)
      .catch(() => setErro('Não foi possível carregar os veterinários.'))
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
        titulo="Veterinários"
        descricao="A mesma pessoa atende por várias clínicas — um cadastro, vários vínculos."
        acao={
          podeCriar ? (
            <Button
              size="small"
              variant="contained"
              startIcon={<AddOutlined />}
              onClick={() => setCriando(true)}
            >
              Novo veterinário
            </Button>
          ) : undefined
        }
      />

      <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Nome, CRMV ou e-mail…" />

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
          {veterinarios.length === 0 && <Vazio texto="Nenhum veterinário encontrado." />}
          {veterinarios.map((v) => (
            <Card key={v.id} sx={{ p: 2 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ justifyContent: 'space-between', gap: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{v.nome}</Typography>
                    {v.crmv && (
                      <Typography sx={{ ...MONO, fontSize: 12.5, color: 'text.secondary' }}>
                        CRMV-{v.crmvUf} {v.crmv}
                      </Typography>
                    )}
                    {v.especialidade && (
                      <Chip size="small" variant="outlined" label={v.especialidade} />
                    )}
                    {v.inativadoEm && <Chip size="small" label="Inativo" />}
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                    {v.vinculos ? `Vinculado a: ${v.vinculos}` : 'Sem vínculo vigente'}
                    {v.email ? ` · ${v.email}` : ''}
                  </Typography>
                </Box>

                {podeEditar && (
                  <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignSelf: 'center' }}>
                    <Button size="small" onClick={() => setEmEdicao(v)}>
                      Editar
                    </Button>
                    <BotaoAtivacao
                      inativo={v.inativadoEm !== null}
                      caminho={`/veterinarios/${v.id}`}
                      aoMudar={recarregar}
                    />
                  </Stack>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <DialogoVeterinario
        aberto={criando || emEdicao !== null}
        veterinario={emEdicao}
        aoFechar={() => {
          setCriando(false);
          setEmEdicao(null);
        }}
        aoSalvar={() => {
          setCriando(false);
          setEmEdicao(null);
          recarregar();
        }}
      />
    </Box>
  );
}

// --- criação/edição de veterinário -------------------------------------------

function DialogoVeterinario({
  aberto,
  veterinario,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  veterinario: VeterinarioLista | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [crmv, setCrmv] = useState('');
  const [crmvUf, setCrmvUf] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [duplicidades, setDuplicidades] = useState<DuplicidadeCadastral[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /**
   * M03 secoes 12-13: o veterinario e pessoa unica com N vinculos, e e o
   * VINCULO que o habilita como solicitante de um cliente. Cadastrar sem
   * vincular produz um veterinario que existe e nao serve para nada - foi
   * exatamente o que aconteceu no primeiro uso real. O vinculo entra aqui
   * porque e aqui que quem cadastra esta pensando "o fulano atende a clinica
   * tal"; a ficha do cliente continua sendo o lugar de gerir os vinculos
   * depois.
   */
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [clienteVinculo, setClienteVinculo] = useState('');

  useEffect(() => {
    setNome(veterinario?.nome ?? '');
    setCrmv(veterinario?.crmv ?? '');
    setCrmvUf(veterinario?.crmvUf ?? '');
    setEmail(veterinario?.email ?? '');
    setTelefone(veterinario?.telefone ?? '');
    setEspecialidade(veterinario?.especialidade ?? '');
    setClienteVinculo('');
    setDuplicidades(null);
    setErro(null);
  }, [veterinario, aberto]);

  useEffect(() => {
    if (!aberto || veterinario) return;
    api
      .get<ClienteResumo[]>('/catalogo/clientes')
      .then(setClientes)
      .catch(() => setClientes([]));
  }, [aberto, veterinario]);

  async function salvar(ignorarDuplicidade = false) {
    setOcupado(true);
    setErro(null);
    try {
      const corpo = {
        nome: nome.trim(),
        crmv: crmv.trim(),
        crmvUf: crmvUf.trim().toUpperCase(),
        email: email.trim(),
        telefone: telefone.trim(),
        especialidade: especialidade.trim(),
      };
      if (veterinario) {
        await api.post(`/veterinarios/${veterinario.id}`, corpo);
      } else {
        const novo = await api.post<{ id: string }>('/veterinarios', {
          ...corpo,
          ...(ignorarDuplicidade ? { ignorarDuplicidade: true } : {}),
        });

        if (clienteVinculo) {
          await api.post(`/veterinarios/${novo.id}/vinculos`, {
            clienteId: clienteVinculo,
            principal: true,
          });
        }
      }
      aoSalvar();
    } catch (err) {
      if (err instanceof ErroApi && err.possivelDuplicidade) {
        setDuplicidades(err.duplicidades!);
      } else {
        setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar.');
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>{veterinario ? 'Editar veterinário' : 'Novo veterinário'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome completo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="CRMV"
              value={crmv}
              onChange={(e) => setCrmv(e.target.value)}
              required
              sx={{ flex: 1 }}
            />
            <TextField
              label="UF"
              value={crmvUf}
              onChange={(e) => setCrmvUf(e.target.value.toUpperCase())}
              required
              slotProps={{ htmlInput: { maxLength: 2, style: { textTransform: 'uppercase' } } }}
              sx={{ width: 90 }}
            />
            <TextField
              label="Especialidade"
              value={especialidade}
              onChange={(e) => setEspecialidade(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sx={{ flex: 1.4 }}
            />
            <TextField
              label="Telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          {/* Só na criação: depois, os vínculos se gerem na ficha do cliente,
              onde a história completa (vigentes e encerrados) fica visível. */}
          {!veterinario && (
            <TextField
              select
              label="Vincular ao cliente"
              value={clienteVinculo}
              onChange={(e) => setClienteVinculo(e.target.value)}
              helperText="Sem vínculo, ele não aparece como solicitante de nenhum cliente ao abrir um caso. Dá para vincular depois, na ficha do cliente."
            >
              <MenuItem value="">— vincular depois —</MenuItem>
              {clientes.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.nomeFantasia}
                </MenuItem>
              ))}
            </TextField>
          )}

          {duplicidades && (
            <Alert severity="warning">
              <AlertTitle>Possível duplicidade</AlertTitle>
              <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                {duplicidades.map((d) => (
                  <li key={d.id}>
                    <Typography sx={{ fontSize: 13 }}>
                      {d.nome}
                      {d.crmv ? ` · CRMV-${d.crmvUf} ${d.crmv}` : ''} ·{' '}
                      {STATUS_LABEL[d.status] ?? d.status}
                    </Typography>
                  </li>
                ))}
              </Stack>
              <Typography sx={{ fontSize: 12.5, mt: 1 }}>
                O veterinário é pessoa única com N vínculos — se é o mesmo profissional, feche e
                vincule o existente ao cliente em vez de recadastrar.
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
          <Button variant="contained" color="warning" onClick={() => void salvar(true)} disabled={ocupado}>
            É outro profissional — criar mesmo assim
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void salvar()}
            disabled={ocupado || !nome.trim() || Boolean(crmv.trim()) !== Boolean(crmvUf.trim())}
          >
            {ocupado ? 'Salvando…' : 'Salvar'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

