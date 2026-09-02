import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import InventoryOutlined from '@mui/icons-material/Inventory2Outlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import BiotechOutlined from '@mui/icons-material/BiotechOutlined';
import { EVENTO_LABEL, type TipoEvento } from '@lapato/shared';
import { api, ErroApi, urlArquivo, type Dossie as DadosDossie } from '../api';
import { GaleriaDoCaso } from './imagens/GaleriaDoCaso';
import { OrdemDoCaso } from './ordens/OrdemDoCaso';

/**
 * Dossie unico do caso (DIRETRIZES secoes 13 e 14).
 *
 * "Ao clicar em Abrir Caso, o usuario devera acessar o mesmo dossie,
 * independentemente do modulo de origem." As abas mudam conforme tipo de exame,
 * perfil, permissoes e etapa - mas o dossie e um so.
 */

type Aba = 'visao' | 'amostras' | 'imagens' | 'os' | 'historico' | 'timeline';

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'visao', rotulo: 'Visão geral' },
  { id: 'amostras', rotulo: 'Amostras' },
  // M16 seção 57: todo caso tem sua aba de imagens - o acervo é um só.
  { id: 'imagens', rotulo: 'Imagens' },
  // M20 (review): a OS acompanha o caso; quem pode ver cobrança a vê aqui.
  { id: 'os', rotulo: 'Ordem de Serviço' },
  { id: 'historico', rotulo: 'Histórico' },
  { id: 'timeline', rotulo: 'Linha do tempo' },
];

/** Identificadores e quantidades em fonte tabular: alinham na vertical. */
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

/** M07: etapas em que o trabalho corrente é do M11 (da lâmina à liberação). */
const ETAPAS_LAUDO = new Set([
  'laminas_disponiveis',
  'aguardando_microscopia',
  'em_microscopia',
  'aguardando_complementar',
  'aguardando_revisao',
  'em_revisao',
  'aguardando_assinatura',
  'liberado',
]);

export function Dossie({ permissoes }: { permissoes: string[] }) {
  const { id } = useParams<{ id: string }>();
  const [parametros] = useSearchParams();
  const [dados, setDados] = useState<DadosDossie | null>(null);
  const abaInicial = parametros.get('aba');
  const [aba, setAba] = useState<Aba>(
    ABAS.some((a) => a.id === abaInicial) ? (abaInicial as Aba) : 'visao',
  );

  useEffect(() => {
    if (id) api.get<DadosDossie>(`/casos/${id}`).then(setDados);
  }, [id]);

  if (!dados) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={78} />
        <Skeleton variant="rounded" height={340} />
      </Stack>
    );
  }

  return (
    <Box component="section">
      {/* DIRETRIZES seção 15: cabeçalho persistente do caso. */}
      <Card component="header" sx={{ mb: 2.5, p: 2.5 }}>
        <Stack
          direction="row"
          sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1 }}
        >
          <Box>
            <Typography sx={{ ...MONO, fontSize: 17, fontWeight: 700 }}>
              {dados.caso.identificador}
            </Typography>
            {/* Documento do Hugo: etiqueta da requisição e uma por pote, logo na entrada. */}
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.25, flexWrap: 'wrap' }}>
              <Button
                size="small"
                component="a"
                href={urlArquivo(`/casos/${dados.caso.id}/etiquetas?alvo=requisicao`)}
                target="_blank"
                rel="noreferrer"
                sx={{ fontSize: 11, minWidth: 0, px: 0.75 }}
              >
                Etiqueta da requisição
              </Button>
              {dados.recipientes.map((r) => (
                <Button
                  key={r.id}
                  size="small"
                  component="a"
                  href={urlArquivo(`/casos/${dados.caso.id}/etiquetas?alvo=${r.id}`)}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ fontSize: 11, minWidth: 0, px: 0.75, ...MONO }}
                >
                  {r.identificador.slice(r.identificador.lastIndexOf('-') + 1)}
                </Button>
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Paciente</Typography>
            <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{dados.paciente.nome}</Typography>
          </Box>

          {/* Particular: quem paga e recebe o laudo é o responsável, não um cliente. */}
          {dados.caso.modalidade === 'particular' ? (
            <Box>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                Particular · responsável
              </Typography>
              <Typography sx={{ fontSize: 13.5 }}>{dados.responsavel?.nome ?? '—'}</Typography>
            </Box>
          ) : (
            <Box>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Cliente</Typography>
              <Typography sx={{ fontSize: 13.5 }}>{dados.cliente.nomeFantasia}</Typography>
            </Box>
          )}

          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Serviço</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.servico.nome}</Typography>
          </Box>

          {/* Segunda review: para qual patologista foi a lâmina. */}
          <DestinoDaLamina
            casoId={dados.caso.id}
            atual={dados.patologistaResponsavel}
            podeAtribuir={permissoes.includes('fluxo:atribuir_responsavel')}
            aoMudar={() => api.get<DadosDossie>(`/casos/${dados.caso.id}`).then(setDados)}
          />

          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              // Em tela estreita a ação desce e ocupa a linha; `ml: auto` só
              // faz sentido quando há espaço horizontal sobrando.
              ml: { md: 'auto' },
              width: { xs: '100%', md: 'auto' },
              alignItems: 'center',
              mt: { xs: 1, md: 0 },
            }}
          >
            {dados.estado && (
              <Chip
                size="small"
                label={dados.estado.etapa.replaceAll('_', ' ')}
                color="primary"
                variant="outlined"
              />
            )}

            {/**
             * DIRETRIZES seção 15: navegação POR CONTEXTO. A próxima ação do
             * caso aparece no próprio caso, em vez de exigir que o usuário
             * volte à central e procure outra tela.
             */}
            {!dados.caso.recebidoEm && permissoes.includes('material:receber') && (
              <Button
                component={Link}
                to={`/casos/${id}/recebimento`}
                variant="contained"
                size="small"
                startIcon={<InventoryOutlined />}
                sx={{ flex: { xs: 1, md: 'none' } }}
              >
                Registrar recebimento
              </Button>
            )}

            {/* Recebido e ainda não triado: a triagem é a próxima ação. As duas
                condições são excludentes, então nunca aparecem as duas. */}
            {dados.caso.recebidoEm &&
              !dados.caso.triadoEm &&
              permissoes.includes('triagem:executar') && (
                <Button
                  component={Link}
                  to={`/casos/${id}/triagem`}
                  variant="contained"
                  size="small"
                  startIcon={<FactCheckOutlined />}
                  sx={{ flex: { xs: 1, md: 'none' } }}
                >
                  Registrar triagem
                </Button>
              )}

            {/**
             * M14: a necropsia é uma modalidade própria, não uma etapa da
             * histopatologia — por isso o atalho não depende da triagem como o
             * da macroscopia. Quem recebe um cadáver examina o cadáver.
             */}
            {permissoes.includes('necropsia:executar') && (
              <Button
                component={Link}
                to={`/casos/${id}/necropsia`}
                variant="outlined"
                size="small"
                startIcon={<BiotechOutlined />}
                sx={{ flex: { xs: 1, md: 'none' } }}
              >
                Necropsia
              </Button>
            )}

            {/**
             * Triado e liberado pela triagem: a bancada é a próxima ação. Uma
             * triagem bloqueada ou recusada não chega aqui — é o M06 segurando
             * o caso, e oferecer o atalho contradiria isso.
             */}
            {dados.caso.triadoEm &&
              dados.caso.resultadoTriagem !== 'bloqueado' &&
              dados.caso.resultadoTriagem !== 'recusado' &&
              permissoes.includes('macroscopia:executar') && (
                <Button
                  component={Link}
                  to={`/casos/${id}/macroscopia`}
                  // Enquanto a bancada é o trabalho corrente, é a ação primária;
                  // da lâmina em diante vira consulta, e o laudo assume o papel.
                  variant={ETAPAS_LAUDO.has(dados.estado?.etapa ?? '') ? 'outlined' : 'contained'}
                  size="small"
                  startIcon={<ScienceOutlined />}
                  sx={{ flex: { xs: 1, md: 'none' } }}
                >
                  Macroscopia
                </Button>
              )}

            {/**
             * Da lâmina em diante o trabalho é do M11: microscopia, laudo,
             * revisão, assinatura. Depois de liberado o botão continua — o
             * laudo é consulta, não só elaboração.
             */}
            {ETAPAS_LAUDO.has(dados.estado?.etapa ?? '') &&
              permissoes.includes('laudo:visualizar') && (
                <Button
                  component={Link}
                  to={`/casos/${id}/laudo`}
                  variant="contained"
                  size="small"
                  startIcon={<BiotechOutlined />}
                  sx={{ flex: { xs: 1, md: 'none' } }}
                >
                  Microscopia e laudo
                </Button>
              )}
          </Stack>
        </Stack>
      </Card>

      <Tabs
        value={aba}
        onChange={(_, v: Aba) => setAba(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {ABAS.filter((a) => a.id !== 'os' || permissoes.includes('os:visualizar')).map((a) => (
          <Tab key={a.id} value={a.id} label={a.rotulo} sx={{ fontSize: 13.5, minHeight: 42 }} />
        ))}
      </Tabs>

      {aba === 'visao' && (
        <Card sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Campo rotulo="Prioridade" valor={dados.caso.prioridade} />
            <EntradaDoMaterial
              casoId={dados.caso.id}
              entradaEm={dados.caso.entradaEm}
              previsao={dados.estado?.previsaoLiberacao ?? null}
              podeEditar={permissoes.includes('caso:editar')}
              aoMudar={() => api.get<DadosDossie>(`/casos/${dados.caso.id}`).then(setDados)}
            />
            <Campo
              rotulo="Recebido em"
              valor={
                dados.caso.recebidoEm
                  ? new Date(dados.caso.recebidoEm).toLocaleString('pt-BR')
                  : 'Ainda não recebido'
              }
            />
            <Campo
              rotulo="Resultado da triagem"
              valor={dados.caso.resultadoTriagem?.replaceAll('_', ' ') ?? 'Ainda não triado'}
            />
            <Divider />

            <IdentificacaoDoAnimal
              dados={dados}
              podeEditar={permissoes.includes('caso:editar')}
              aoMudar={() => api.get<DadosDossie>(`/casos/${dados.caso.id}`).then(setDados)}
            />

            <Divider />

            <Box>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
                Recipientes
              </Typography>
              <Stack spacing={0.75}>
                {dados.recipientes.map((r) => {
                  /**
                   * M05: declarado e recebido ficam lado a lado. A divergência é
                   * dado do caso, e por isso aparece em vez de ser "corrigida".
                   */
                  const divergente =
                    r.quantidadeRecebida !== null &&
                    r.quantidadeDeclarada !== null &&
                    r.quantidadeRecebida !== r.quantidadeDeclarada;

                  return (
                    <Stack
                      key={r.id}
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'center', fontSize: 12.5 }}
                    >
                      <Typography sx={{ ...MONO, fontSize: 12.5 }}>{r.identificador}</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                        declarado {r.quantidadeDeclarada ?? '—'} · recebido{' '}
                        {r.quantidadeRecebida ?? '—'}
                      </Typography>
                      {divergente && (
                        <Chip size="small" color="warning" label="divergência" />
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          </Stack>
        </Card>
      )}

      {aba === 'amostras' && (
        <Card sx={{ p: 2.5 }}>
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {dados.amostras.map((a) => (
              <Stack
                key={a.id}
                direction="row"
                spacing={2}
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Typography sx={{ ...MONO, fontSize: 12.5 }}>{a.identificador}</Typography>
                <Typography sx={{ fontSize: 13.5 }}>{a.descricao ?? '—'}</Typography>
                {a.lateralidade !== 'nao_aplicavel' && (
                  <Chip size="small" variant="outlined" label={`lateralidade: ${a.lateralidade}`} />
                )}
                {a.resultadoTriagem && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`triagem: ${a.resultadoTriagem.replaceAll('_', ' ')}`}
                  />
                )}
                {a.macroscopiaConcluidaEm && (
                  <Chip size="small" variant="outlined" color="success" label="macroscopia concluída" />
                )}
                {/* Review: "em cada uma das amostras tem recorte" - so depois da macro concluida. */}
                {a.macroscopiaConcluidaEm && permissoes.includes('solicitacao:criar') && id && (
                  <BotaoRecorte
                    amostraId={a.id}
                    identificador={a.identificador}
                    aoConcluir={() => api.get<DadosDossie>(`/casos/${id}`).then(setDados)}
                  />
                )}
              </Stack>
            ))}
          </Stack>
        </Card>
      )}

      {aba === 'imagens' && id && (
        <GaleriaDoCaso casoId={id} permissoes={permissoes} moduloContexto="M05_RECEBIMENTO" />
      )}

      {aba === 'os' && id && permissoes.includes('os:visualizar') && (
        <OrdemDoCaso casoId={id} permissoes={permissoes} />
      )}

      {aba === 'historico' && (
        <Card sx={{ p: 2.5 }}>
          {dados.historicos.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Sem histórico clínico.
            </Typography>
          )}
          <Stack spacing={2} divider={<Divider flexItem />}>
            {dados.historicos.map((h) => (
              <Box key={h.id} component="article">
                {/* M05/M11: o texto original do solicitante nunca é substituído. */}
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  Origem: {h.origem}
                </Typography>
                <Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-wrap', mt: 0.5 }}>
                  {h.texto}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Card>
      )}

      {aba === 'timeline' && (
        <Card sx={{ p: 2.5 }}>
          <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {dados.linhaDoTempo.map((e) => (
              <Stack key={e.id} component="li" direction="row" spacing={2}>
                <Typography
                  component="time"
                  sx={{ ...MONO, fontSize: 11.5, color: 'text.secondary', flexShrink: 0, pt: 0.25 }}
                >
                  {new Date(e.ocorridoEm).toLocaleString('pt-BR')}
                </Typography>
                <Box>
                  <Typography sx={{ fontSize: 13.5 }}>
                    {EVENTO_LABEL[e.tipo as TipoEvento] ?? e.tipo}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {/* Documento do Hugo: o nome de quem executou cada etapa. */}
                    {[e.usuarioNome, e.moduloOrigem].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Card>
      )}
    </Box>
  );
}

/**
 * Identificacao do animal e do responsavel, editavel depois do cadastro
 * (documento do Hugo: "quem inseriu pode errar ou nao entender a informacao -
 * e bem comum"). Cada correcao fica na auditoria; o Guardian continua
 * comparando identidade antes da assinatura.
 */
function IdentificacaoDoAnimal({
  dados,
  podeEditar,
  aoMudar,
}: {
  dados: DadosDossie;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [especies, setEspecies] = useState<Array<{ id: string; valor: string }>>([]);
  const [nome, setNome] = useState(dados.paciente.nome);
  const [especieId, setEspecieId] = useState(dados.paciente.especieId ?? '');
  const [raca, setRaca] = useState(dados.paciente.raca ?? '');
  const [sexo, setSexo] = useState(dados.paciente.sexo ?? '');
  const [dataNascimento, setDataNascimento] = useState(dados.paciente.dataNascimento ?? '');
  const [idadeInformada, setIdadeInformada] = useState(dados.paciente.idadeInformada ?? '');
  const [microchip, setMicrochip] = useState(dados.paciente.microchip ?? '');
  const [tutorNome, setTutorNome] = useState(dados.responsavel?.nome ?? '');
  const [tutorTelefone, setTutorTelefone] = useState(dados.responsavel?.telefone ?? '');
  const [tutorEmail, setTutorEmail] = useState(dados.responsavel?.email ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!editando) return;
    api
      .get<Array<{ id: string; valor: string }>>('/catalogo/tabelas/especie')
      .then(setEspecies)
      .catch(() => setEspecies([]));
  }, [editando]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/pacientes/${dados.paciente.id}`, {
        nome: nome.trim(),
        especieId: especieId || '',
        raca,
        sexo,
        dataNascimento,
        idadeInformada,
        microchip,
        tutorNome,
        tutorTelefone,
        tutorEmail,
      });
      setEditando(false);
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Identificação do animal</Typography>
        {podeEditar && (
          <Button size="small" onClick={() => setEditando(true)}>
            Corrigir identificação
          </Button>
        )}
      </Stack>
      <Campo rotulo="Raça" valor={dados.paciente.raca ?? '—'} />
      <Campo
        rotulo="Idade"
        valor={
          dados.paciente.idadeInformada ??
          (dados.paciente.dataNascimento
            ? `nascido em ${new Date(`${dados.paciente.dataNascimento}T12:00:00`).toLocaleDateString('pt-BR')}`
            : '—')
        }
      />
      <Campo rotulo="Microchip" valor={dados.paciente.microchip ?? '—'} />
      <Campo
        rotulo="Responsável"
        valor={
          dados.responsavel
            ? [dados.responsavel.nome, dados.responsavel.telefone, dados.responsavel.email]
                .filter(Boolean)
                .join(' · ')
            : '—'
        }
      />
      {dados.caso.modalidade === 'particular' && (
        <>
          <Campo rotulo="Clínica de origem" valor={dados.caso.clinicaOrigem ?? '—'} />
          <Campo rotulo="Veterinário solicitante" valor={dados.caso.veterinarioInformado ?? '—'} />
        </>
      )}

      <Dialog open={editando} onClose={() => setEditando(false)} fullWidth maxWidth="sm">
        <DialogTitle>Corrigir identificação do animal</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              A correção fica registrada na auditoria, campo a campo.
            </Typography>
            <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Espécie"
                value={especieId}
                onChange={(e) => setEspecieId(e.target.value)}
                sx={{ flex: 1 }}
              >
                <MenuItem value="">—</MenuItem>
                {especies.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.valor}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Raça" value={raca} onChange={(e) => setRaca(e.target.value)} sx={{ flex: 1 }} />
              <TextField
                select
                label="Sexo"
                value={sexo}
                onChange={(e) => setSexo(e.target.value)}
                sx={{ flex: 1 }}
              >
                <MenuItem value="">—</MenuItem>
                <MenuItem value="macho">Macho</MenuItem>
                <MenuItem value="femea">Fêmea</MenuItem>
                <MenuItem value="indeterminado">Indeterminado</MenuItem>
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Idade"
                value={idadeInformada}
                onChange={(e) => setIdadeInformada(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                type="date"
                label="Nascimento"
                value={dataNascimento}
                onChange={(e) => setDataNascimento(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Microchip"
                value={microchip}
                onChange={(e) => setMicrochip(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Responsável"
                value={tutorNome}
                onChange={(e) => setTutorNome(e.target.value)}
                sx={{ flex: 1.4 }}
              />
              <TextField
                label="Telefone"
                value={tutorTelefone}
                onChange={(e) => setTutorTelefone(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="E-mail"
                type="email"
                value={tutorEmail}
                onChange={(e) => setTutorEmail(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Stack>
            {erro && <Alert severity="error">{erro}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditando(false)} disabled={ocupado}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void salvar()} disabled={ocupado || !nome.trim()}>
            {ocupado ? 'Salvando…' : 'Salvar correção'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 13.5 }}>{valor}</Typography>
    </Box>
  );
}

/**
 * Data de entrada do material (segunda review, Hugo): "se entrou hoje mas
 * ela cadastrou so amanha, a gente ja vai liberar com atraso". Quem edita o
 * caso corrige aqui; o prazo e recontado pelo M07 e a mudanca fica na linha
 * do tempo.
 */
function EntradaDoMaterial({
  casoId,
  entradaEm,
  previsao,
  podeEditar,
  aoMudar,
}: {
  casoId: string;
  entradaEm: string;
  previsao: string | null;
  podeEditar: boolean;
  aoMudar: () => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function abrir() {
    const d = new Date(entradaEm);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    setValor(local.toISOString().slice(0, 16));
    setErro(null);
    setEditando(true);
  }

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/casos/${casoId}/entrada`, { entradaEm: new Date(valor).toISOString() });
      setEditando(false);
      await aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível corrigir a entrada.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Entrada do material</Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 13.5 }}>
          {new Date(entradaEm).toLocaleString('pt-BR')}
          {previsao && (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {' '}
              · previsão de liberação {new Date(previsao).toLocaleDateString('pt-BR')}
            </Box>
          )}
        </Typography>
        {podeEditar && (
          <Button size="small" onClick={abrir}>
            Corrigir
          </Button>
        )}
      </Stack>
      <Dialog open={editando} onClose={() => setEditando(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 16 }}>Corrigir a entrada do material</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {erro && <Alert severity="error">{erro}</Alert>}
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              O prazo do laudo passa a contar da nova data. A correção fica na auditoria e na
              linha do tempo.
            </Typography>
            <TextField
              type="datetime-local"
              label="Entrada"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditando(false)} disabled={ocupado}>
            Voltar
          </Button>
          <Button variant="contained" disabled={ocupado || !valor} onClick={() => void salvar()}>
            Salvar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/**
 * "Para quem foi a lamina" (segunda review). Mostra o patologista responsavel
 * e, para quem despacha, deixa escolher ou trocar - "as vezes um patologista
 * passa um caso pro outro" (Hugo). O seletor so lista usuarios com perfil de
 * patologista: laudador nao e um cadastro a parte, e um usuario do M02.
 */
function DestinoDaLamina({
  casoId,
  atual,
  podeAtribuir,
  aoMudar,
}: {
  casoId: string;
  atual: { id: string; nome: string } | null;
  podeAtribuir: boolean;
  aoMudar: () => Promise<unknown>;
}) {
  const [opcoes, setOpcoes] = useState<Array<{ id: string; nome: string }>>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (podeAtribuir) {
      api
        .get<Array<{ id: string; nome: string }>>('/usuarios/patologistas')
        .then(setOpcoes)
        .catch(() => setOpcoes([]));
    }
  }, [podeAtribuir]);

  async function atribuir(usuarioId: string) {
    if (!usuarioId || usuarioId === atual?.id) return;
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/casos/${casoId}/patologista`, { usuarioId });
      await aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível atribuir.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Box sx={{ minWidth: 180 }}>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Patologista</Typography>
      {podeAtribuir ? (
        <TextField
          select
          size="small"
          variant="standard"
          value={atual?.id ?? ''}
          disabled={ocupado}
          onChange={(e) => void atribuir(e.target.value)}
          error={Boolean(erro)}
          helperText={erro ?? undefined}
          sx={{ minWidth: 180, '& .MuiInputBase-input': { fontSize: 13.5, py: 0.25 } }}
        >
          <MenuItem value="" disabled>
            {atual ? atual.nome : 'Escolher…'}
          </MenuItem>
          {opcoes.map((o) => (
            <MenuItem key={o.id} value={o.id}>
              {o.nome}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Typography sx={{ fontSize: 13.5, color: atual ? 'text.primary' : 'text.secondary' }}>
          {atual?.nome ?? 'Ainda não destinada'}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Recorte (M08, segunda review): o patologista leu a lamina e a amostragem
 * nao foi representativa. Reabre a macroscopia da amostra, registra a
 * solicitacao e lanca o retrabalho na OS sem cobranca; o prazo do laudo nao
 * reinicia. O motivo e obrigatorio porque e ele que explica o custo no
 * fechamento do mes.
 */
function BotaoRecorte({
  amostraId,
  identificador,
  aoConcluir,
}: {
  amostraId: string;
  identificador: string;
  aoConcluir: () => Promise<unknown>;
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function solicitar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/macroscopia/amostras/${amostraId}/recorte`, { motivo: motivo.trim() });
      setAberto(false);
      setMotivo('');
      await aoConcluir();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível solicitar o recorte.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Button size="small" color="warning" onClick={() => setAberto(true)}>
        Recorte
      </Button>
      <Dialog open={aberto} onClose={() => setAberto(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 16 }}>Recorte da amostra {identificador}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {erro && <Alert severity="error">{erro}</Alert>}
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              Reabre a macroscopia para nova amostragem. Não é cobrado do cliente — entra na OS
              como retrabalho, com valor zero — e o prazo do laudo continua o mesmo.
            </Typography>
            <TextField
              label="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              multiline
              minRows={2}
              fullWidth
              helperText="Ex.: amostra não representativa da lesão descrita."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAberto(false)} disabled={ocupado}>
            Voltar
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={ocupado || motivo.trim().length < 3}
            onClick={() => void solicitar()}
          >
            Solicitar recorte
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
