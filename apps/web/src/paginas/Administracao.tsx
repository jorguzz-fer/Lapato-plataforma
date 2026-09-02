import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
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
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { TIPO_UNIDADE, formatarReais } from '@lapato/shared';
import {
  api,
  ErroApi,
  type DiaNaoUtil,
  type ServicoAdmin,
  type TabelaAdmin,
  type TermoAdmin,
  type LocalFisicoAdmin,
  type UnidadeAdmin,
} from '../api';

/**
 * M01 - Administracao e Configuracoes.
 *
 * A tela que faz o sistema ser configuravel em DADOS (secao 2): servicos com as
 * flags que decidem o fluxo, tabelas mestres que alimentam os formularios,
 * unidades/setores e o calendario que move os prazos.
 *
 * Regras que moldam a tela:
 * - **Inativar, nunca excluir** (secao 21) - exceto o calendario, onde nada
 *   aponta para o feriado.
 * - **Alteracao nao retroage** (secao 22): mudar prazo vale para casos novos.
 * - **Codigos sao imutaveis**: identificam o registro em telas e integracoes.
 */

const MODALIDADES = [
  'histopatologia',
  'citopatologia',
  'necropsia',
  'revisao',
  'complementar',
] as const;

const TIPO_UNIDADE_LABEL: Record<string, string> = {
  sede: 'Sede',
  filial: 'Filial',
  posto_recebimento: 'Posto de recebimento',
  laboratorio_apoio: 'Laboratório de apoio',
  unidade_parceira: 'Unidade parceira',
};

const FLAGS_SERVICO = [
  ['exigeTriagem', 'Exige triagem'],
  ['exigeMacroscopia', 'Exige macroscopia'],
  ['exigeProcessamento', 'Exige processamento'],
  ['exigeMicroscopia', 'Exige microscopia'],
  ['geraLaudo', 'Gera laudo'],
  ['permiteComplementares', 'Permite complementares'],
] as const;

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

type Aba = 'servicos' | 'precos' | 'tabelas' | 'unidades' | 'locais' | 'etiquetas' | 'calendario';

export function Administracao({ permissoes }: { permissoes: string[] }) {
  const [aba, setAba] = useState<Aba>('servicos');

  const podeConfig = permissoes.includes('config:editar');
  const podePrecos = permissoes.includes('preco:gerenciar');
  const podeTabelas = permissoes.includes('tabela_mestre:gerenciar');
  const podeUnidades = permissoes.includes('unidade:gerenciar');

  return (
    <Box component="section" sx={{ maxWidth: 1080 }}>
      <Typography variant="h2">Administração</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5 }}>
        O fluxo é configurado em dados, não em código — e alteração não retroage: casos abertos
        seguem as regras da época.
      </Typography>

      <Tabs
        value={aba}
        onChange={(_, v) => setAba(v as Aba)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="servicos" label="Serviços" />
        {podePrecos && <Tab value="precos" label="Tabelas de preço" />}
        <Tab value="tabelas" label="Tabelas mestres" />
        <Tab value="unidades" label="Unidades e setores" />
        <Tab value="locais" label="Locais físicos" />
        <Tab value="etiquetas" label="Etiquetas" />
        <Tab value="calendario" label="Calendário" />
      </Tabs>

      {aba === 'servicos' && <AbaServicos podeEditar={podeConfig} />}
      {aba === 'tabelas' && <AbaTabelas podeEditar={podeTabelas} />}
      {aba === 'unidades' && <AbaUnidades podeEditar={podeUnidades} />}
      {aba === 'locais' && <AbaLocais podeEditar={podeUnidades} />}
      {aba === 'etiquetas' && <AbaEtiquetas podeEditar={podeConfig} />}
      {aba === 'precos' && podePrecos && <AbaTabelasPreco />}
      {aba === 'calendario' && <AbaCalendario podeEditar={podeConfig} />}
    </Box>
  );
}

// --- serviços ----------------------------------------------------------------

function AbaServicos({ podeEditar }: { podeEditar: boolean }) {
  const [servicos, setServicos] = useState<ServicoAdmin[] | null>(null);
  const [emEdicao, setEmEdicao] = useState<ServicoAdmin | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    api
      .get<ServicoAdmin[]>('/administracao/servicos')
      .then(setServicos)
      .catch(() => setErro('Não foi possível carregar os serviços.'));
  }, []);
  useEffect(recarregar, [recarregar]);

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!servicos) return <Skeleton variant="rounded" height={240} />;

  return (
    <Stack spacing={1.5}>
      {podeEditar && (
        <Button
          size="small"
          variant="contained"
          startIcon={<AddOutlined />}
          onClick={() => setCriando(true)}
          sx={{ alignSelf: 'flex-end' }}
        >
          Novo serviço
        </Button>
      )}

      {servicos.map((s) => (
        <Card key={s.id} sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ justifyContent: 'space-between', gap: 1 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'primary.main' }}>
                  {s.codigo}
                </Typography>
                <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{s.nome}</Typography>
                <Chip size="small" variant="outlined" label={s.modalidade} />
                {s.inativadoEm && <Chip size="small" label="Inativo" />}
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                Prazo: {s.prazoDiasUteis} dias úteis
                {s.prazoUrgenteDiasUteis ? ` (urgente: ${s.prazoUrgenteDiasUteis})` : ''}
                {s.valorPadrao != null ? ` · ${formatarReais(s.valorPadrao)}` : ' · sem preço'}
                {' · '}
                {FLAGS_SERVICO.filter(([f]) => s[f])
                  .map(([, rotulo]) => rotulo.toLowerCase())
                  .join(', ')}
              </Typography>
            </Box>

            {podeEditar && (
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignSelf: 'center' }}>
                <Button size="small" onClick={() => setEmEdicao(s)}>
                  Editar
                </Button>
                <BotaoAtivacao
                  inativo={s.inativadoEm !== null}
                  caminho={`/administracao/servicos/${s.id}`}
                  aoMudar={recarregar}
                />
              </Stack>
            )}
          </Stack>
        </Card>
      ))}

      <DialogoServico
        aberto={criando || emEdicao !== null}
        servico={emEdicao}
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
    </Stack>
  );
}

function DialogoServico({
  aberto,
  servico,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  servico: ServicoAdmin | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [categoria, setCategoria] = useState('anatomia_patologica');
  const [modalidade, setModalidade] = useState('histopatologia');
  const [prazo, setPrazo] = useState('5');
  const [prazoUrgente, setPrazoUrgente] = useState('');
  const [valorPadrao, setValorPadrao] = useState('');
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setNome(servico?.nome ?? '');
    setCodigo(servico?.codigo ?? '');
    setCategoria(servico?.categoria ?? 'anatomia_patologica');
    setModalidade(servico?.modalidade ?? 'histopatologia');
    setPrazo(String(servico?.prazoDiasUteis ?? 5));
    setPrazoUrgente(servico?.prazoUrgenteDiasUteis ? String(servico.prazoUrgenteDiasUteis) : '');
    setValorPadrao(servico?.valorPadrao != null ? String(servico.valorPadrao) : '');
    setFlags(
      Object.fromEntries(
        FLAGS_SERVICO.map(([f]) => [f, servico ? servico[f] : f === 'exigeMicroscopia' || f === 'geraLaudo' || f === 'permiteComplementares']),
      ),
    );
    setErro(null);
  }, [servico, aberto]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      const corpo = {
        nome: nome.trim(),
        categoria,
        modalidade,
        prazoDiasUteis: Number(prazo),
        prazoUrgenteDiasUteis: prazoUrgente.trim() ? Number(prazoUrgente) : null,
        // Vale para itens NOVOS de OS; os ja lancados guardam o retrato (M01).
        valorPadrao: valorPadrao.trim() ? Number(valorPadrao.replace(',', '.')) : null,
        ...flags,
      };
      if (servico) {
        await api.post(`/administracao/servicos/${servico.id}`, corpo);
      } else {
        await api.post('/administracao/servicos', { ...corpo, codigo: codigo.trim().toUpperCase() });
      }
      aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>{servico ? 'Editar serviço' : 'Novo serviço'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Código"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              required
              disabled={servico !== null}
              helperText={servico ? 'Imutável: identifica o serviço.' : ' '}
              sx={{ width: 140 }}
            />
            <TextField
              select
              label="Modalidade"
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value)}
              sx={{ flex: 1 }}
            >
              {MODALIDADES.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Prazo (dias úteis)"
              type="number"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              sx={{ flex: 1 }}
              helperText="Vale para casos novos (M01 seção 22)."
            />
            <TextField
              label="Prazo urgente"
              type="number"
              value={prazoUrgente}
              onChange={(e) => setPrazoUrgente(e.target.value)}
              sx={{ flex: 1 }}
              helperText="Opcional."
            />
            <TextField
              label="Valor padrão (R$)"
              value={valorPadrao}
              onChange={(e) => setValorPadrao(e.target.value)}
              sx={{ flex: 1 }}
              helperText="Tabela padrão; acordos por cliente ficam no cadastro do cliente."
            />
          </Stack>

          {/* Seção 11: as flags decidem por quais etapas o caso passa. */}
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
              Comportamento no fluxo
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
              {FLAGS_SERVICO.map(([f, rotulo]) => (
                <FormControlLabel
                  key={f}
                  control={
                    <Checkbox
                      checked={flags[f] ?? false}
                      onChange={(e) => setFlags((a) => ({ ...a, [f]: e.target.checked }))}
                    />
                  }
                  label={rotulo}
                  slotProps={{ typography: { sx: { fontSize: 13 } } }}
                  sx={{ width: { xs: '100%', sm: '48%' } }}
                />
              ))}
            </Stack>
          </Box>

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
          disabled={ocupado || !nome.trim() || (!servico && codigo.trim().length < 2)}
        >
          {ocupado ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- tabelas mestres -----------------------------------------------------------

function AbaTabelas({ podeEditar }: { podeEditar: boolean }) {
  const [tabelas, setTabelas] = useState<TabelaAdmin[] | null>(null);
  const [selecionada, setSelecionada] = useState<TabelaAdmin | null>(null);
  const [termos, setTermos] = useState<TermoAdmin[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<TabelaAdmin[]>('/administracao/tabelas')
      .then(setTabelas)
      .catch(() => setErro('Não foi possível carregar as tabelas.'));
  }, []);

  const carregarTermos = useCallback((tabela: TabelaAdmin) => {
    setSelecionada(tabela);
    setTermos(null);
    api
      .get<TermoAdmin[]>(`/administracao/tabelas/${tabela.id}/termos`)
      .then(setTermos)
      .catch(() => setErro('Não foi possível carregar os termos.'));
  }, []);

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!tabelas) return <Skeleton variant="rounded" height={240} />;

  if (!selecionada) {
    return (
      <Stack spacing={1.5}>
        {tabelas.map((t) => (
          <Card
            key={t.id}
            sx={{ p: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
            onClick={() => carregarTermos(t)}
          >
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{t.nome}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  <Box component="span" sx={MONO}>
                    {t.chave}
                  </Box>
                  {' · '}
                  {t.totalTermos} {t.totalTermos === 1 ? 'termo ativo' : 'termos ativos'}
                </Typography>
              </Box>
              <ChevronRight sx={{ color: 'text.disabled' }} />
            </Stack>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Button size="small" onClick={() => setSelecionada(null)}>
          ← Tabelas
        </Button>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{selecionada.nome}</Typography>
        {podeEditar ? (
          <Button size="small" variant="contained" startIcon={<AddOutlined />} onClick={() => setCriando(true)}>
            Novo termo
          </Button>
        ) : (
          <span />
        )}
      </Stack>

      {!termos && <Skeleton variant="rounded" height={200} />}

      {termos?.map((t) => (
        <Card key={t.id} sx={{ p: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{t.valor}</Typography>
                <Typography sx={{ ...MONO, fontSize: 11.5, color: 'text.secondary' }}>{t.codigo}</Typography>
                {t.abreviacao && <Chip size="small" variant="outlined" label={t.abreviacao} />}
                {t.inativadoEm && <Chip size="small" label="Inativo" />}
              </Stack>
              {t.sinonimos.length > 0 && (
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                  Sinônimos: {t.sinonimos.join(', ')}
                </Typography>
              )}
            </Box>
            {podeEditar && (
              <BotaoAtivacao
                inativo={t.inativadoEm !== null}
                caminho={`/administracao/termos/${t.id}`}
                aoMudar={() => carregarTermos(selecionada)}
              />
            )}
          </Stack>
        </Card>
      ))}

      {criando && (
        <DialogoTermo
          tabela={selecionada}
          aoFechar={() => setCriando(false)}
          aoCriar={() => {
            setCriando(false);
            carregarTermos(selecionada);
          }}
        />
      )}
    </Stack>
  );
}

function DialogoTermo({
  tabela,
  aoFechar,
  aoCriar,
}: {
  tabela: TabelaAdmin;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [valor, setValor] = useState('');
  const [codigo, setCodigo] = useState('');
  const [abreviacao, setAbreviacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/administracao/tabelas/${tabela.id}/termos`, {
        valor: valor.trim(),
        codigo: (codigo.trim() || valor.trim()).toLowerCase().replace(/\s+/g, '_'),
        ...(abreviacao.trim() ? { abreviacao: abreviacao.trim() } : {}),
      });
      aoCriar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar o termo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle>Novo termo — {tabela.nome}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Valor" value={valor} onChange={(e) => setValor(e.target.value)} required autoFocus />
          <TextField
            label="Código"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            helperText="Opcional — derivado do valor se vazio. Imutável depois."
          />
          <TextField label="Abreviação" value={abreviacao} onChange={(e) => setAbreviacao(e.target.value)} />
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void criar()} disabled={ocupado || !valor.trim()}>
          Criar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- unidades e setores ---------------------------------------------------------

function AbaUnidades({ podeEditar }: { podeEditar: boolean }) {
  const [unidades, setUnidades] = useState<UnidadeAdmin[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [setorEm, setSetorEm] = useState<UnidadeAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    api
      .get<UnidadeAdmin[]>('/administracao/unidades')
      .then(setUnidades)
      .catch(() => setErro('Não foi possível carregar as unidades.'));
  }, []);
  useEffect(recarregar, [recarregar]);

  if (erro) return <Alert severity="error">{erro}</Alert>;
  if (!unidades) return <Skeleton variant="rounded" height={240} />;

  return (
    <Stack spacing={1.5}>
      {podeEditar && (
        <Button
          size="small"
          variant="contained"
          startIcon={<AddOutlined />}
          onClick={() => setCriando(true)}
          sx={{ alignSelf: 'flex-end' }}
        >
          Nova unidade
        </Button>
      )}

      {unidades.map((u) => (
        <Card key={u.id} sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ justifyContent: 'space-between', gap: 1 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'primary.main' }}>
                  {u.codigo}
                </Typography>
                <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{u.nome}</Typography>
                <Chip size="small" variant="outlined" label={TIPO_UNIDADE_LABEL[u.tipo] ?? u.tipo} />
                {u.inativadoEm && <Chip size="small" label="Inativa" />}
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                {u.setores.filter((s) => !s.inativadoEm).length > 0
                  ? `Setores: ${u.setores
                      .filter((s) => !s.inativadoEm)
                      .map((s) => s.nome)
                      .join(', ')}`
                  : 'Sem setores cadastrados'}
              </Typography>
            </Box>

            {podeEditar && (
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignSelf: 'center' }}>
                <Button size="small" onClick={() => setSetorEm(u)}>
                  + Setor
                </Button>
                <BotaoAtivacao
                  inativo={u.inativadoEm !== null}
                  caminho={`/administracao/unidades/${u.id}`}
                  aoMudar={recarregar}
                />
              </Stack>
            )}
          </Stack>
        </Card>
      ))}

      {criando && (
        <DialogoUnidade
          aoFechar={() => setCriando(false)}
          aoCriar={() => {
            setCriando(false);
            recarregar();
          }}
        />
      )}

      {setorEm && (
        <DialogoSetor
          unidade={setorEm}
          aoFechar={() => setSetorEm(null)}
          aoCriar={() => {
            setSetorEm(null);
            recarregar();
          }}
        />
      )}
    </Stack>
  );
}

function DialogoUnidade({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: () => void }) {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState('filial');
  const [responsavel, setResponsavel] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/administracao/unidades', {
        nome: nome.trim(),
        codigo: codigo.trim().toUpperCase(),
        tipo,
        ...(responsavel.trim() ? { responsavel: responsavel.trim() } : {}),
      });
      aoCriar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar a unidade.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle>Nova unidade</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Código"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              required
              sx={{ width: 130 }}
            />
            <TextField
              select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              sx={{ flex: 1 }}
              helperText="Imutável: do tipo deriva o isolamento de acesso (M09)."
            >
              {TIPO_UNIDADE.map((t) => (
                <MenuItem key={t} value={t}>
                  {TIPO_UNIDADE_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField label="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
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
          disabled={ocupado || !nome.trim() || codigo.trim().length < 2}
        >
          Criar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogoSetor({
  unidade,
  aoFechar,
  aoCriar,
}: {
  unidade: UnidadeAdmin;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState('recepcao');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/administracao/unidades/${unidade.id}/setores`, {
        nome: nome.trim(),
        codigo: codigo.trim().toUpperCase(),
        tipo,
      });
      aoCriar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar o setor.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle>Novo setor — {unidade.nome}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Código"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              required
              sx={{ width: 130 }}
            />
            <TextField
              select
              label="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              sx={{ flex: 1 }}
            >
              {['recepcao', 'triagem', 'macroscopia', 'histotecnica', 'microscopia', 'administrativo'].map(
                (t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ),
              )}
            </TextField>
          </Stack>
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
          disabled={ocupado || !nome.trim() || codigo.trim().length < 2}
        >
          Criar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- calendário ------------------------------------------------------------------

function AbaCalendario({ podeEditar }: { podeEditar: boolean }) {
  const [dias, setDias] = useState<DiaNaoUtil[] | null>(null);
  const [data, setData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(() => {
    api
      .get<DiaNaoUtil[]>('/administracao/calendario')
      .then(setDias)
      .catch(() => setErro('Não foi possível carregar o calendário.'));
  }, []);
  useEffect(recarregar, [recarregar]);

  async function adicionar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/administracao/calendario', { data, descricao: descricao.trim() });
      setData('');
      setDescricao('');
      recarregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível adicionar.');
    } finally {
      setOcupado(false);
    }
  }

  async function remover(id: string) {
    setOcupado(true);
    try {
      await api.post(`/administracao/calendario/${id}/remocao`);
      recarregar();
    } finally {
      setOcupado(false);
    }
  }

  if (erro && !dias) return <Alert severity="error">{erro}</Alert>;
  if (!dias) return <Skeleton variant="rounded" height={200} />;

  return (
    <Stack spacing={2}>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
        Os dias abaixo saem da contagem de prazo em dias úteis (M01 seção 14) — a previsão dos
        casos é recalculada automaticamente.
      </Typography>

      {podeEditar && (
        <Card sx={{ p: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              label="Data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { sm: 180 } }}
            />
            <TextField
              label="Descrição"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained"
              onClick={() => void adicionar()}
              disabled={ocupado || !data || !descricao.trim()}
            >
              Adicionar
            </Button>
          </Stack>
          {erro && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {erro}
            </Alert>
          )}
        </Card>
      )}

      <Stack spacing={1}>
        {dias.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center', py: 4 }}>
            Nenhum dia não útil cadastrado.
          </Typography>
        )}
        {dias.map((d) => (
          <Card key={d.id} sx={{ p: 1.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 13.5 }}>
                <Box component="span" sx={{ ...MONO, fontWeight: 600 }}>
                  {new Date(`${d.data}T12:00:00`).toLocaleDateString('pt-BR')}
                </Box>
                {' — '}
                {d.descricao}
                <Chip size="small" variant="outlined" label={d.tipo} sx={{ ml: 1 }} />
              </Typography>
              {podeEditar && (
                <Button size="small" color="inherit" onClick={() => void remover(d.id)} disabled={ocupado}>
                  Remover
                </Button>
              )}
            </Stack>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}

// --- apoio -----------------------------------------------------------------------

function BotaoAtivacao({
  inativo,
  caminho,
  aoMudar,
}: {
  inativo: boolean;
  caminho: string;
  aoMudar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function alternar() {
    setOcupado(true);
    try {
      await api.post(`${caminho}/${inativo ? 'reativacao' : 'inativacao'}`);
      aoMudar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Button size="small" color={inativo ? 'primary' : 'inherit'} onClick={() => void alternar()} disabled={ocupado}>
      {inativo ? 'Reativar' : 'Inativar'}
    </Button>
  );
}

// --- locais físicos ----------------------------------------------------------

/**
 * M01 secao 7.3: a arvore de locais - unidade, sala, equipamento, compartimento,
 * posicao. O M15 secao 18 usa exatamente essa hierarquia para dizer onde cada
 * cadaver esta, e o M18 usara para a bioteca.
 *
 * A tabela existia desde o inicio sem nenhuma tela. Um modulo que depende dela
 * nasceria inutilizavel - foi o que quase aconteceu com o Controle de Cadaveres.
 */
function AbaLocais({ podeEditar }: { podeEditar: boolean }) {
  const [locais, setLocais] = useState<LocalFisicoAdmin[] | null>(null);
  const [unidades, setUnidades] = useState<UnidadeAdmin[]>([]);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [unidadeId, setUnidadeId] = useState('');
  const [paiId, setPaiId] = useState('');
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [categoria, setCategoria] = useState('posicao');
  const [condicao, setCondicao] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(() => {
    api
      .get<LocalFisicoAdmin[]>('/administracao/locais')
      .then(setLocais)
      .catch(() => setErro('Não foi possível carregar os locais.'));
    api
      .get<UnidadeAdmin[]>('/administracao/unidades')
      .then(setUnidades)
      .catch(() => undefined);
  }, []);

  useEffect(recarregar, [recarregar]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/administracao/locais', {
        unidadeId,
        paiId: paiId || null,
        nome: nome.trim(),
        codigo: codigo.trim(),
        categoria,
        condicaoAmbiental: condicao || null,
      });
      setCriando(false);
      setNome('');
      setCodigo('');
      setPaiId('');
      recarregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível criar o local.');
    } finally {
      setOcupado(false);
    }
  }

  const nomePorId = new Map((locais ?? []).map((l) => [l.id, `${l.codigo} — ${l.nome}`]));

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', maxWidth: 640 }}>
          Câmaras, freezers, prateleiras e posições. É onde o Controle de Cadáveres registra a
          localização de cada corpo — sem local cadastrado, não há onde armazenar.
        </Typography>
        {podeEditar && (
          <Button
            variant="contained"
            size="small"
            onClick={() => {
              setUnidadeId(unidades[0]?.id ?? '');
              setCriando(true);
            }}
          >
            Novo local
          </Button>
        )}
      </Stack>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {locais === null ? (
        <Skeleton variant="rounded" height={140} />
      ) : locais.length === 0 ? (
        <Alert severity="info">
          Nenhum local cadastrado. Comece pelo equipamento (a câmara) e depois crie as posições
          dentro dele.
        </Alert>
      ) : (
        <Stack spacing={1}>
          {locais.map((l) => (
            <Card key={l.id} sx={{ p: 1.5 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {l.codigo} — {l.nome}
                    </Typography>
                    <Chip size="small" variant="outlined" label={l.categoria} />
                    {l.condicaoAmbiental && (
                      <Chip size="small" variant="outlined" label={l.condicaoAmbiental} />
                    )}
                    {l.inativadoEm && <Chip size="small" label="Inativo" />}
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {l.unidadeNome}
                    {l.paiId ? ` · dentro de ${nomePorId.get(l.paiId) ?? '—'}` : ''}
                  </Typography>
                </Box>
                {podeEditar && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() =>
                      void api
                        .post(
                          `/administracao/locais/${l.id}/${l.inativadoEm ? 'reativacao' : 'inativacao'}`,
                        )
                        .then(recarregar)
                    }
                  >
                    {l.inativadoEm ? 'Reativar' : 'Inativar'}
                  </Button>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog open={criando} onClose={() => setCriando(false)} fullWidth maxWidth="sm">
        <DialogTitle>Novo local físico</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Unidade"
              value={unidadeId}
              onChange={(e) => setUnidadeId(e.target.value)}
            >
              {unidades.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.nome}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Dentro de"
              value={paiId}
              onChange={(e) => setPaiId(e.target.value)}
              helperText="Vazio cria o equipamento; escolher um pai cria a posição dentro dele."
            >
              <MenuItem value="">Nenhum (é o equipamento)</MenuItem>
              {(locais ?? [])
                .filter((l) => !l.inativadoEm)
                .map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.codigo} — {l.nome}
                  </MenuItem>
                ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Código"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                helperText="Único na instituição."
                sx={{ flex: 1 }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                sx={{ flex: 1 }}
              >
                <MenuItem value="camara_refrigerada">Câmara refrigerada</MenuItem>
                <MenuItem value="freezer">Freezer</MenuItem>
                <MenuItem value="sala">Sala</MenuItem>
                <MenuItem value="prateleira">Prateleira</MenuItem>
                <MenuItem value="posicao">Posição</MenuItem>
                <MenuItem value="area_temporaria">Área temporária</MenuItem>
              </TextField>
              <TextField
                select
                label="Condição ambiental"
                value={condicao}
                onChange={(e) => setCondicao(e.target.value)}
                sx={{ flex: 1 }}
              >
                <MenuItem value="">Não se aplica</MenuItem>
                <MenuItem value="refrigerado">Refrigerado</MenuItem>
                <MenuItem value="congelado">Congelado</MenuItem>
                <MenuItem value="ambiente">Ambiente</MenuItem>
              </TextField>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCriando(false)}>Cancelar</Button>
          <Button
            variant="contained"
            disabled={ocupado || !unidadeId || !nome.trim() || !codigo.trim()}
            onClick={() => void salvar()}
          >
            Criar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// --- etiquetas -----------------------------------------------------------------

interface ModeloEtiqueta {
  id: string;
  nome: string;
  alvo: string;
  larguraMm: number;
  alturaMm: number;
  copiasPadrao: number;
}

/**
 * M01 §19 — modelos de etiqueta. Só as DIMENSÕES são editáveis: o layout
 * (campos, código de barras) tem contrato com o código que imprime. O caso de
 * uso real é o da review do M09: o laboratório de apoio informa as medidas da
 * etiqueta dele, alguém ajusta aqui, e a impressão sai no tamanho certo — sem
 * deploy.
 */
function AbaEtiquetas({ podeEditar }: { podeEditar: boolean }) {
  const [modelos, setModelos] = useState<ModeloEtiqueta[]>([]);
  const [edicao, setEdicao] = useState<Record<string, { largura: string; altura: string }>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(() => {
    api
      .get<ModeloEtiqueta[]>('/administracao/etiquetas')
      .then((r) => {
        setModelos(r);
        setEdicao(
          Object.fromEntries(
            r.map((m) => [m.id, { largura: String(m.larguraMm), altura: String(m.alturaMm) }]),
          ),
        );
      })
      .catch(() => setErro('Não foi possível carregar os modelos.'))
      .finally(() => setCarregado(true));
  }, []);

  useEffect(carregar, [carregar]);

  async function salvar(modelo: ModeloEtiqueta) {
    const atual = edicao[modelo.id];
    if (!atual) return;
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/administracao/etiquetas/${modelo.id}`, {
        larguraMm: Number(atual.largura),
        alturaMm: Number(atual.altura),
      });
      setAviso(`"${modelo.nome}" agora imprime em ${atual.largura} × ${atual.altura} mm.`);
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  if (!carregado) return <Skeleton variant="rounded" height={200} />;

  return (
    <Stack spacing={1.5}>
      {erro && <Alert severity="error">{erro}</Alert>}
      {aviso && <Alert severity="success">{aviso}</Alert>}
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
        As dimensões valem para a próxima impressão. O conteúdo da etiqueta (campos e código de
        barras) faz parte do sistema e não se edita por aqui.
      </Typography>

      {modelos.map((m) => (
        <Card key={m.id} sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{m.nome}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Alvo: {m.alvo} · hoje {m.larguraMm} × {m.alturaMm} mm
              </Typography>
            </Box>
            {podeEditar && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                <TextField
                  size="small"
                  label="Largura (mm)"
                  value={edicao[m.id]?.largura ?? ''}
                  onChange={(e) =>
                    setEdicao((a) => ({
                      ...a,
                      [m.id]: { largura: e.target.value, altura: a[m.id]?.altura ?? '' },
                    }))
                  }
                  sx={{ width: 110 }}
                />
                <TextField
                  size="small"
                  label="Altura (mm)"
                  value={edicao[m.id]?.altura ?? ''}
                  onChange={(e) =>
                    setEdicao((a) => ({
                      ...a,
                      [m.id]: { largura: a[m.id]?.largura ?? '', altura: e.target.value },
                    }))
                  }
                  sx={{ width: 110 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  disabled={
                    ocupado ||
                    !Number.isInteger(Number(edicao[m.id]?.largura)) ||
                    !Number.isInteger(Number(edicao[m.id]?.altura)) ||
                    Number(edicao[m.id]?.largura) < 10 ||
                    Number(edicao[m.id]?.altura) < 5
                  }
                  onClick={() => void salvar(m)}
                >
                  Salvar
                </Button>
              </Stack>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

// --- tabelas de preco (M20, segunda review) ------------------------------------

interface TabelaPreco {
  id: string;
  nome: string;
  descricao: string | null;
  inativadoEm: string | null;
  clientes: number;
}

interface ItemTabela {
  servicoId: string;
  nome: string;
  codigo: string;
  valorPadrao: string | null;
  valorTabela: string | null;
}

/**
 * "Se ele for laboratorio, e um valor; clinica, outro; hospital, outro" - os
 * servicos sao os mesmos, so o valor muda. Aqui a instituicao mantem essas
 * poucas tabelas; o cliente escolhe a dele no cadastro. Inativar nao apaga
 * (M01): a tabela some da escolha, nao do historico.
 */
function AbaTabelasPreco() {
  const [tabelas, setTabelas] = useState<TabelaPreco[]>([]);
  const [aberta, setAberta] = useState<TabelaPreco | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(() => {
    api
      .get<TabelaPreco[]>('/precos/tabelas')
      .then(setTabelas)
      .catch(() => setErro('Não foi possível carregar as tabelas de preço.'))
      .finally(() => setCarregado(true));
  }, []);

  useEffect(carregar, [carregar]);

  async function agir(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagem);
    } finally {
      setOcupado(false);
    }
  }

  if (!carregado) return <Skeleton variant="rounded" height={200} />;

  return (
    <Stack spacing={1.5}>
      {erro && <Alert severity="error">{erro}</Alert>}
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
        Os serviços são os mesmos para todo cliente; o que muda é o valor. Crie uma tabela por
        perfil (laboratório, clínica, hospital…) e escolha a tabela no cadastro do cliente. O
        acordo individual, quando existe, vence a tabela; sem tabela vale o valor padrão do serviço.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <TextField
          size="small"
          label="Nova tabela"
          placeholder="Ex.: Clínica"
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          sx={{ width: 260 }}
        />
        <Button
          size="small"
          variant="contained"
          startIcon={<AddOutlined />}
          disabled={ocupado || novoNome.trim().length < 2}
          onClick={() =>
            void agir(async () => {
              await api.post('/precos/tabelas', { nome: novoNome.trim() });
              setNovoNome('');
            }, 'Não foi possível criar a tabela.')
          }
        >
          Criar
        </Button>
      </Stack>

      {tabelas.length === 0 && (
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Nenhuma tabela ainda. Comece por uma — os valores entram serviço a serviço.
        </Typography>
      )}

      {tabelas.map((t) => (
        <Card key={t.id} sx={{ p: 2, opacity: t.inativadoEm ? 0.6 : 1 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{t.nome}</Typography>
                {t.inativadoEm && <Chip size="small" label="Inativa" />}
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {t.clientes === 0
                  ? 'Nenhum cliente usa esta tabela'
                  : `${t.clientes} cliente(s) seguem esta tabela`}
                {t.descricao ? ` · ${t.descricao}` : ''}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button size="small" variant="outlined" onClick={() => setAberta(t)}>
                Valores
              </Button>
              <Button
                size="small"
                color={t.inativadoEm ? 'primary' : 'inherit'}
                disabled={ocupado}
                onClick={() =>
                  void agir(
                    () => api.post(`/precos/tabelas/${t.id}`, { ativa: Boolean(t.inativadoEm) }),
                    'Não foi possível alterar a tabela.',
                  )
                }
              >
                {t.inativadoEm ? 'Reativar' : 'Inativar'}
              </Button>
            </Stack>
          </Stack>
        </Card>
      ))}

      {aberta && (
        <DialogoValoresTabela
          tabela={aberta}
          aoFechar={() => {
            setAberta(null);
            carregar();
          }}
        />
      )}
    </Stack>
  );
}

function DialogoValoresTabela({ tabela, aoFechar }: { tabela: TabelaPreco; aoFechar: () => void }) {
  const [itens, setItens] = useState<ItemTabela[]>([]);
  const [edicao, setEdicao] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    api
      .get<ItemTabela[]>(`/precos/tabelas/${tabela.id}/itens`)
      .then((r) => {
        setItens(r);
        setEdicao(Object.fromEntries(r.map((i) => [i.servicoId, i.valorTabela ?? ''])));
      })
      .catch(() => setErro('Não foi possível carregar os valores.'))
      .finally(() => setCarregado(true));
  }, [tabela.id]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      for (const item of itens) {
        const texto = (edicao[item.servicoId] ?? '').trim().replace(',', '.');
        const valor = texto === '' ? null : Number(texto);
        if (valor !== null && (!Number.isFinite(valor) || valor < 0)) {
          throw new Error(`Valor inválido para ${item.nome}.`);
        }
        const original = item.valorTabela === null ? null : Number(item.valorTabela);
        if (valor === original) continue;
        await api.post(`/precos/tabelas/${tabela.id}/itens`, { servicoId: item.servicoId, valor });
      }
      aoFechar();
    } catch (err) {
      setErro(
        err instanceof ErroApi ? err.detalhe : err instanceof Error ? err.message : 'Não foi possível salvar.',
      );
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 16 }}>Valores — {tabela.nome}</DialogTitle>
      <DialogContent>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {erro}
          </Alert>
        )}
        {!carregado ? (
          <Skeleton variant="rounded" height={200} />
        ) : (
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              Campo vazio = o serviço não tem preço nesta tabela e cai no valor padrão. Vale para
              ordens novas; itens já lançados não mudam.
            </Typography>
            {itens.map((i) => (
              <Stack
                key={i.servicoId}
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{i.nome}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Padrão: {i.valorPadrao != null ? formatarReais(i.valorPadrao) : 'sem preço'}
                  </Typography>
                </Box>
                <TextField
                  size="small"
                  label="Valor (R$)"
                  value={edicao[i.servicoId] ?? ''}
                  onChange={(e) => setEdicao((a) => ({ ...a, [i.servicoId]: e.target.value }))}
                  sx={{ width: 140, flexShrink: 0 }}
                />
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void salvar()} disabled={ocupado}>
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
