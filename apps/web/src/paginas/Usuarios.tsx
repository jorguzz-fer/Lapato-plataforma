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
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import DrawOutlined from '@mui/icons-material/DrawOutlined';
import {
  api,
  ErroApi,
  type ClienteResumo,
  type PerfilResumo,
  type UnidadeAdmin,
  type UsuarioLista,
} from '../api';
import { DialogoAssinatura } from './DialogoAssinatura';

/**
 * M02 - gestao de usuarios (a autenticacao ja existe; aqui e o ciclo de vida
 * da conta).
 *
 * Regras que moldam a tela:
 * - **Senha provisoria aparece UMA vez** (secao 31): o dialogo mostra e avisa;
 *   o banco guarda so o hash. O primeiro login prende na troca obrigatoria.
 * - **Bloquear derruba as sessoes na hora** (secao 33) e nao apaga nada.
 * - **Troca de perfis vale na proxima sessao** - reduzir privilegio de sessao
 *   aberta exige bloquear.
 */

const STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  aguardando_ativacao: 'Aguardando ativação',
  suspenso: 'Suspenso',
  bloqueado: 'Bloqueado',
  afastado: 'Afastado',
  temporario: 'Temporário',
  acesso_expirado: 'Acesso expirado',
  desligado: 'Desligado',
};

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function Usuarios({ permissoes }: { permissoes: string[] }) {
  const [usuarios, setUsuarios] = useState<UsuarioLista[] | null>(null);
  const [perfis, setPerfis] = useState<PerfilResumo[]>([]);
  const [unidades, setUnidades] = useState<UnidadeAdmin[]>([]);
  const [criando, setCriando] = useState(false);
  const [emEdicao, setEmEdicao] = useState<UsuarioLista | null>(null);
  const [emAssinatura, setEmAssinatura] = useState<UsuarioLista | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ titulo: string; senha: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const podeCriar = permissoes.includes('usuario:criar');
  const podeEditar = permissoes.includes('usuario:editar');
  const podeBloquear = permissoes.includes('usuario:bloquear');

  const recarregar = useCallback(() => {
    api
      .get<UsuarioLista[]>('/usuarios')
      .then(setUsuarios)
      .catch(() => setErro('Não foi possível carregar os usuários.'));
  }, []);

  useEffect(() => {
    recarregar();
    api.get<PerfilResumo[]>('/usuarios/perfis').then(setPerfis).catch(() => setPerfis([]));
    // O select de unidade reaproveita a listagem administrativa quando houver acesso.
    api.get<UnidadeAdmin[]>('/administracao/unidades').then(setUnidades).catch(() => setUnidades([]));
  }, [recarregar]);

  async function agir(fn: () => Promise<unknown>, mensagemErro: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      recarregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagemErro);
    } finally {
      setOcupado(false);
    }
  }

  function redefinirSenha(u: UsuarioLista) {
    void agir(async () => {
      const r = await api.post<{ senhaProvisoria: string }>(`/usuarios/${u.id}/redefinicao-senha`);
      setSenhaGerada({ titulo: `Nova senha provisória de ${u.nomeCompleto}`, senha: r.senhaProvisoria });
    }, 'Não foi possível redefinir a senha.');
  }

  if (erro && !usuarios) return <Alert severity="error">{erro}</Alert>;

  return (
    <Box component="section" sx={{ maxWidth: 1080 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ mb: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1.5 }}
      >
        <Box>
          <Typography variant="h2">Usuários e Perfis</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Uma pessoa, uma conta — o que cada perfil pode fazer é decidido no servidor, a cada ação.
          </Typography>
        </Box>
        {podeCriar && (
          <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={() => setCriando(true)}>
            Novo usuário
          </Button>
        )}
      </Stack>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {!usuarios && (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={80} />
          ))}
        </Stack>
      )}

      <Stack spacing={1.5}>
        {usuarios?.map((u) => (
          <Card key={u.id} sx={{ p: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{ justifyContent: 'space-between', gap: 1 }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{u.nomeCompleto}</Typography>
                  {u.status !== 'ativo' && (
                    <Chip
                      size="small"
                      color={u.status === 'bloqueado' ? 'error' : 'warning'}
                      label={STATUS_LABEL[u.status] ?? u.status}
                    />
                  )}
                  {u.mfaAtivo && (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<ShieldOutlined sx={{ fontSize: 14 }} />}
                      label="MFA"
                    />
                  )}
                  {u.senhaTrocaObrigatoria && (
                    <Chip size="small" variant="outlined" color="warning" label="Senha provisória" />
                  )}
                  {/* So faz sentido cobrar de quem assina: conta externa nao assina laudo. */}
                  {u.categoria !== 'externo' && !u.assinaturaAtiva && (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="warning"
                      label="Sem assinatura"
                    />
                  )}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {u.email}
                  {u.perfis ? ` · ${u.perfis}` : ' · sem perfil'}
                  {u.unidadePrincipal ? ` · ${u.unidadePrincipal}` : ''}
                  {u.ultimoAcessoEm
                    ? ` · último acesso ${new Date(u.ultimoAcessoEm).toLocaleDateString('pt-BR')}`
                    : ' · nunca acessou'}
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignSelf: 'center', flexWrap: 'wrap' }}>
                {podeEditar && (
                  <>
                    <Button size="small" onClick={() => setEmEdicao(u)}>
                      Editar
                    </Button>
                    <Button
                      size="small"
                      startIcon={<KeyOutlined sx={{ fontSize: 15 }} />}
                      onClick={() => redefinirSenha(u)}
                      disabled={ocupado}
                    >
                      Redefinir senha
                    </Button>
                    {u.categoria !== 'externo' && (
                      <Button
                        size="small"
                        startIcon={<DrawOutlined sx={{ fontSize: 15 }} />}
                        onClick={() => setEmAssinatura(u)}
                      >
                        Assinatura
                      </Button>
                    )}
                  </>
                )}
                {podeBloquear &&
                  (u.status === 'bloqueado' ? (
                    <Button
                      size="small"
                      disabled={ocupado}
                      onClick={() =>
                        void agir(
                          () => api.post(`/usuarios/${u.id}/reativacao`),
                          'Não foi possível reativar.',
                        )
                      }
                    >
                      Reativar
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      color="inherit"
                      disabled={ocupado}
                      onClick={() =>
                        void agir(
                          () => api.post(`/usuarios/${u.id}/bloqueio`),
                          'Não foi possível bloquear.',
                        )
                      }
                    >
                      Bloquear
                    </Button>
                  ))}
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>

      <DialogoAssinatura
        usuario={emAssinatura}
        aoFechar={() => setEmAssinatura(null)}
        aoMudar={recarregar}
      />

      <DialogoUsuario
        aberto={criando || emEdicao !== null}
        usuario={emEdicao}
        perfis={perfis}
        unidades={unidades}
        aoFechar={() => {
          setCriando(false);
          setEmEdicao(null);
        }}
        aoSalvar={(senha) => {
          setCriando(false);
          setEmEdicao(null);
          if (senha) setSenhaGerada({ titulo: 'Senha provisória do novo usuário', senha });
          recarregar();
        }}
      />

      {/* Seção 31: a senha aparece UMA vez - o banco guarda só o hash. */}
      {senhaGerada && (
        <Dialog open onClose={() => setSenhaGerada(null)} fullWidth maxWidth="xs">
          <DialogTitle>{senhaGerada.titulo}</DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>Anote agora — não aparece de novo</AlertTitle>
              O sistema guarda só o hash. No primeiro acesso, a troca é obrigatória.
            </Alert>
            <Typography
              sx={{ ...MONO, fontSize: 20, fontWeight: 700, textAlign: 'center', userSelect: 'all' }}
            >
              {senhaGerada.senha}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={() => setSenhaGerada(null)}>
              Anotei
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

function DialogoUsuario({
  aberto,
  usuario,
  perfis,
  unidades,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  usuario: UsuarioLista | null;
  perfis: PerfilResumo[];
  unidades: UnidadeAdmin[];
  aoFechar: () => void;
  aoSalvar: (senhaProvisoria?: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfilIds, setPerfilIds] = useState<string[]>([]);
  const [unidadeId, setUnidadeId] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setNome(usuario?.nomeCompleto ?? '');
    setEmail(usuario?.email ?? '');
    // Na edição os perfis atuais chegam como nomes agregados; a seleção parte
    // deles marcando os que batem - o servidor substitui o conjunto inteiro.
    setPerfilIds(
      usuario ? perfis.filter((p) => usuario.perfis.includes(p.nome)).map((p) => p.id) : [],
    );
    setUnidadeId('');
    setClienteId('');
    setErro(null);
  }, [usuario, aberto, perfis]);

  /**
   * M04: conta do Portal pertence a um CLIENTE, e é dele que sai todo o escopo
   * externo. A lista só é buscada quando o perfil escolhido é do Portal — quem
   * cria uma conta interna não deveria nem ver o campo.
   */
  const chavesPortal = new Set(['cliente', 'veterinario_solicitante']);
  const contaDoPortal = perfis
    .filter((p) => perfilIds.includes(p.id))
    .some((p) => chavesPortal.has(p.chave));

  useEffect(() => {
    if (!contaDoPortal || clientes.length > 0) return;
    api
      .get<ClienteResumo[]>('/catalogo/clientes')
      .then(setClientes)
      .catch(() => setClientes([]));
  }, [contaDoPortal, clientes.length]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      if (usuario) {
        await api.post(`/usuarios/${usuario.id}`, {
          nomeCompleto: nome.trim(),
          perfilIds,
          ...(unidadeId ? { unidadePrincipalId: unidadeId } : {}),
        });
        aoSalvar();
      } else {
        const r = await api.post<{ senhaProvisoria: string }>('/usuarios', {
          nomeCompleto: nome.trim(),
          email: email.trim(),
          perfilIds,
          ...(unidadeId ? { unidadePrincipalId: unidadeId } : {}),
          ...(clienteId ? { clienteId } : {}),
        });
        aoSalvar(r.senhaProvisoria);
      }
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>{usuario ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome completo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          <TextField
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={usuario !== null}
            helperText={usuario ? 'O e-mail identifica a pessoa - não se troca (M02 seção 3).' : ' '}
          />

          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
              Perfis
              {usuario ? ' — a troca vale na próxima sessão' : ''}
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
              {perfis.map((p) => (
                <FormControlLabel
                  key={p.id}
                  control={
                    <Checkbox
                      checked={perfilIds.includes(p.id)}
                      onChange={(e) =>
                        setPerfilIds((a) =>
                          e.target.checked ? [...a, p.id] : a.filter((id) => id !== p.id),
                        )
                      }
                    />
                  }
                  label={p.nome + (p.exigeSupervisao ? ' (sob supervisão)' : '')}
                  slotProps={{ typography: { sx: { fontSize: 13 } } }}
                  sx={{ width: { xs: '100%', sm: '48%' } }}
                />
              ))}
            </Stack>
          </Box>

          {contaDoPortal && !usuario && (
            <TextField
              select
              label="Cliente do Portal"
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              required
              helperText="A conta verá somente os exames deste cliente (M04 seção 5)."
            >
              <MenuItem value="">—</MenuItem>
              {clientes.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.nomeFantasia}
                </MenuItem>
              ))}
            </TextField>
          )}

          {unidades.length > 0 && !contaDoPortal && (
            <TextField
              select
              label="Unidade principal"
              value={unidadeId}
              onChange={(e) => setUnidadeId(e.target.value)}
              helperText="Opcional."
            >
              <MenuItem value="">—</MenuItem>
              {unidades
                .filter((u) => !u.inativadoEm)
                .map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.nome}
                  </MenuItem>
                ))}
            </TextField>
          )}

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => void salvar()}
          disabled={
            ocupado ||
            !nome.trim() ||
            perfilIds.length === 0 ||
            (!usuario && !email.trim()) ||
            (contaDoPortal && !usuario && !clienteId)
          }
        >
          {ocupado ? 'Salvando…' : usuario ? 'Salvar' : 'Criar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
