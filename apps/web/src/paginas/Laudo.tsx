import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BiotechOutlined from '@mui/icons-material/BiotechOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import {
  LATERALIDADE,
  RESULTADO_MARGEM,
  type Lateralidade,
  type ResultadoMargem,
} from '@lapato/shared';
import {
  api,
  ErroApi,
  type Dossie as DadosDossie,
  type LaudoDoCaso,
} from '../api';

/**
 * M11 + M13 - Microscopia e laudo. Parte 1: elaboracao.
 *
 * Regras do modulo que moldam a tela, e nao apenas aparecem nela:
 *
 * - **O laudo e o dado estruturado e versionado; o PDF e representacao**
 *   (M11 secoes 118-119). Por isso o diagnostico tem componentes - processo,
 *   entidade, comportamento, severidade, lateralidade - e nao um campo de texto
 *   unico. Guardar so o texto inviabilizaria pesquisa, indicadores e a Memoria
 *   Anatomopatologica.
 * - **O texto exibido pode diferir da composicao estruturada.** O patologista
 *   escreve o que o laudo deve dizer; os componentes alimentam o resto do
 *   sistema. Um nao substitui o outro.
 * - **"Nao avaliavel" e resposta valida** para margem (M13): o sistema nao
 *   obriga preenchimento inventado.
 * - **A lateralidade do diagnostico e comparada com a do cadastro** pelo
 *   Guardian antes da assinatura - por isso a do cadastro fica visivel aqui,
 *   ao lado de cada amostra.
 * - **Nota interna nunca aparece no documento externo** e tem permissao
 *   propria. Quem nao a tem nem recebe o campo do servidor.
 * - **Depois de assinada, a versao nao se edita.** Mudanca e adendo ou
 *   correcao, que criam versao nova - fica para a parte 2, junto com revisao,
 *   assinatura e liberacao.
 */

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  aguardando_revisao: 'Aguardando revisão',
  em_revisao: 'Em revisão',
  retornado_para_correcao: 'Retornado para correção',
  aguardando_assinatura: 'Aguardando assinatura',
  assinado: 'Assinado',
  liberado: 'Liberado',
  substituido: 'Substituído',
};

const MARGEM_LABEL: Record<ResultadoMargem, string> = {
  livre: 'Livre',
  comprometida: 'Comprometida',
  proxima: 'Próxima',
  nao_avaliavel: 'Não avaliável',
  indeterminada: 'Indeterminada',
};

const LATERALIDADE_LABEL: Record<Lateralidade, string> = {
  direito: 'Direito',
  esquerdo: 'Esquerdo',
  bilateral: 'Bilateral',
  nao_aplicavel: 'Não se aplica',
};

const COMPORTAMENTO = [
  { valor: 'benigno', rotulo: 'Benigno' },
  { valor: 'maligno', rotulo: 'Maligno' },
  { valor: 'indeterminado', rotulo: 'Indeterminado' },
  { valor: 'nao_neoplasico', rotulo: 'Não neoplásico' },
] as const;

const HIERARQUIA = [
  { valor: 'principal', rotulo: 'Principal' },
  { valor: 'secundario', rotulo: 'Secundário' },
  { valor: 'incidental', rotulo: 'Incidental' },
  { valor: 'associado', rotulo: 'Associado' },
] as const;

interface Diagnostico {
  amostraId: string;
  hierarquia: string;
  textoExibido: string;
  processo: string;
  entidade: string;
  comportamento: string;
  severidade: string;
  lateralidade: Lateralidade;
  grau: string;
  provisorio: boolean;
}

interface Margem {
  nome: string;
  resultado: ResultadoMargem | '';
  distanciaMm: string;
  observacoes: string;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

interface Props {
  permissoes: string[];
  exigeSupervisao: boolean;
}

export function Laudo({ permissoes, exigeSupervisao }: Props) {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();

  const [dossie, setDossie] = useState<DadosDossie | null>(null);
  const [laudo, setLaudo] = useState<LaudoDoCaso | null>(null);
  const [carregado, setCarregado] = useState(false);

  const [descricao, setDescricao] = useState('');
  const [diagnosticos, setDiagnosticos] = useState<Diagnostico[]>([]);
  const [margens, setMargens] = useState<Margem[]>([]);
  const [comentarios, setComentarios] = useState('');
  const [conclusao, setConclusao] = useState('');
  const [notaInterna, setNotaInterna] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bloqueioGuardian, setBloqueioGuardian] = useState<ErroApi | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const veNotaInterna = permissoes.includes('laudo:ver_nota_interna');
  const podeEditar = permissoes.includes('laudo:editar');

  const carregar = useCallback((dados: LaudoDoCaso | null) => {
    setLaudo(dados);
    setDescricao(dados?.versaoCorrente.descricaoMicroscopica ?? '');
    setComentarios(dados?.versaoCorrente.comentarios ?? '');
    setConclusao(dados?.versaoCorrente.conclusao ?? '');
    setNotaInterna(dados?.versaoCorrente.notaInterna ?? '');
    setDiagnosticos(
      (dados?.diagnosticos ?? []).map((d) => ({
        amostraId: d.amostraId ?? '',
        hierarquia: d.hierarquia,
        textoExibido: d.textoExibido,
        processo: d.processo ?? '',
        entidade: d.entidade ?? '',
        comportamento: d.comportamento ?? '',
        severidade: d.severidade ?? '',
        lateralidade: (d.lateralidade as Lateralidade) ?? 'nao_aplicavel',
        grau: d.grau ?? '',
        provisorio: d.provisorio,
      })),
    );
    setMargens(
      (dados?.margens ?? []).map((m) => ({
        nome: m.nome,
        resultado: (m.resultado as ResultadoMargem) ?? '',
        distanciaMm: m.distanciaMm ?? '',
        observacoes: m.observacoes ?? '',
      })),
    );
  }, []);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<DadosDossie>(`/casos/${id}`).then(setDossie),
      api.get<LaudoDoCaso | null>(`/laudos/casos/${id}`).then(carregar),
    ])
      .catch(() => setErro('Não foi possível carregar o caso.'))
      .finally(() => setCarregado(true));
  }, [id, carregar]);

  const versao = laudo?.versaoCorrente;
  const assinada = versao?.assinadaEm != null;
  /** Editável enquanto não assinada — inclusive retornada para correção. */
  const editavel = podeEditar && laudo !== null && !assinada;

  const diagnosticosValidos = useMemo(
    () => diagnosticos.every((d) => d.textoExibido.trim() !== ''),
    [diagnosticos],
  );
  const margensValidas = useMemo(
    () => margens.every((m) => m.nome.trim() !== '' && m.resultado !== ''),
    [margens],
  );

  async function iniciar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/laudos/casos/${id}`);
      carregar(await api.get<LaudoDoCaso | null>(`/laudos/casos/${id}`));
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível iniciar a microscopia.');
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(): Promise<boolean> {
    if (!versao) return false;
    setOcupado(true);
    setErro(null);
    setAviso(null);

    try {
      await api.post(`/laudos/versoes/${versao.id}`, {
        ...(descricao.trim() ? { descricaoMicroscopica: descricao.trim() } : {}),
        ...(comentarios.trim() ? { comentarios: comentarios.trim() } : {}),
        ...(conclusao.trim() ? { conclusao: conclusao.trim() } : {}),
        ...(veNotaInterna && notaInterna.trim() ? { notaInterna: notaInterna.trim() } : {}),
        diagnosticos: diagnosticos.map((d) => ({
          ...(d.amostraId ? { amostraId: d.amostraId } : {}),
          hierarquia: d.hierarquia,
          textoExibido: d.textoExibido.trim(),
          ...(d.processo.trim() ? { processo: d.processo.trim() } : {}),
          ...(d.entidade.trim() ? { entidade: d.entidade.trim() } : {}),
          ...(d.comportamento ? { comportamento: d.comportamento } : {}),
          ...(d.severidade.trim() ? { severidade: d.severidade.trim() } : {}),
          lateralidade: d.lateralidade,
          ...(d.grau.trim() ? { grau: d.grau.trim() } : {}),
          provisorio: d.provisorio,
        })),
        margens: margens.map((m) => ({
          nome: m.nome.trim(),
          resultado: m.resultado,
          ...(m.distanciaMm.trim() ? { distanciaMm: Number(m.distanciaMm) } : {}),
          ...(m.observacoes.trim() ? { observacoes: m.observacoes.trim() } : {}),
        })),
      });

      carregar(await api.get<LaudoDoCaso | null>(`/laudos/casos/${id}`));
      setAviso('Rascunho salvo.');
      return true;
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar o laudo.');
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function enviarParaRevisao() {
    // O servidor avalia a versão gravada; enviar sem salvar mandaria à revisão
    // um laudo diferente do que está na tela.
    if (!(await salvar())) return;
    if (!versao) return;

    setOcupado(true);
    setErro(null);
    setBloqueioGuardian(null);

    try {
      await api.post(`/laudos/versoes/${versao.id}/revisao`);
      carregar(await api.get<LaudoDoCaso | null>(`/laudos/casos/${id}`));
      setAviso(null);
    } catch (err) {
      if (err instanceof ErroApi && err.bloqueadoPeloGuardian) {
        setBloqueioGuardian(err);
      } else {
        setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar para revisão.');
      }
    } finally {
      setOcupado(false);
    }
  }

  if (!carregado || !dossie) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <Stack spacing={2} sx={{ maxWidth: 940 }}>
        <Skeleton variant="rounded" height={70} />
        <Skeleton variant="rounded" height={340} />
      </Stack>
    );
  }

  return (
    <Box sx={{ maxWidth: 940 }}>
      <Stack
        direction="row"
        sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h2">Microscopia e laudo</Typography>
        {laudo && (
          <Chip
            size="small"
            variant="outlined"
            color={laudo.status === 'retornado_para_correcao' ? 'warning' : 'primary'}
            label={`${STATUS_LABEL[laudo.status] ?? laudo.status} · v${versao?.versao}`}
          />
        )}
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        O laudo é o dado estruturado e versionado — o PDF é só a representação documental.
      </Typography>

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
            {dossie.caso.identificador}
          </Typography>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Paciente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dossie.paciente.nome}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Serviço</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dossie.servico.nome}</Typography>
          </Box>
        </Stack>
      </Card>

      {!laudo ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <BiotechOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography sx={{ fontWeight: 600 }}>Microscopia ainda não iniciada</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2.5 }}>
            Iniciar cria a versão 1 do laudo, registra o evento e fica na linha do tempo.
          </Typography>
          <Button variant="contained" onClick={iniciar} disabled={ocupado || !podeEditar}>
            {ocupado ? 'Iniciando…' : 'Iniciar microscopia'}
          </Button>
          {!podeEditar && (
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 1 }}>
              Seu perfil não elabora laudo.
            </Typography>
          )}
        </Card>
      ) : (
        <>
          {assinada && (
            <Alert severity="info" icon={<LockOutlined />} sx={{ mb: 2.5 }}>
              <AlertTitle>Versão {versao?.versao} assinada</AlertTitle>
              Assinada em {new Date(versao!.assinadaEm!).toLocaleString('pt-BR')}
              {versao?.assinaturaIdentificacao ? ` por ${versao.assinaturaIdentificacao}` : ''}.
              O conteúdo não é mais editável — mudança exige adendo ou correção, que criam nova
              versão.
            </Alert>
          )}

          {laudo.status === 'retornado_para_correcao' && (
            /* M11: o retorno da revisão precisa ser visto ANTES de continuar
               editando — os comentários do revisor são o motivo do retorno. */
            <Alert severity="warning" sx={{ mb: 2.5 }}>
              <AlertTitle>Retornado para correção</AlertTitle>
              {laudo.revisoes[0]?.comentarios ?? 'O revisor solicitou ajustes.'}
            </Alert>
          )}

          {!assinada && exigeSupervisao && (
            <Alert severity="info" sx={{ mb: 2.5 }}>
              Perfil sob supervisão: você elabora o laudo e envia para revisão; assinatura e
              liberação são do responsável.
            </Alert>
          )}

          <Stack spacing={2.5}>
            <Secao
              titulo="Descrição microscópica"
              descricao="O que foi visto nas lâminas, com as palavras do patologista."
            >
              <TextField
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                multiline
                minRows={6}
                fullWidth
                disabled={!editavel}
              />
            </Secao>

            <Secao
              titulo="Diagnósticos"
              descricao="Componentes estruturados e texto exibido convivem: o texto é o que o laudo diz; os componentes alimentam pesquisa, indicadores e a memória anatomopatológica."
              acao={
                editavel && (
                  <Button
                    size="small"
                    startIcon={<AddOutlined />}
                    onClick={() =>
                      setDiagnosticos((a) => [
                        ...a,
                        {
                          amostraId: dossie.amostras.length === 1 ? dossie.amostras[0]!.id : '',
                          hierarquia: a.length === 0 ? 'principal' : 'secundario',
                          textoExibido: '',
                          processo: '',
                          entidade: '',
                          comportamento: '',
                          severidade: '',
                          lateralidade: 'nao_aplicavel',
                          grau: '',
                          provisorio: false,
                        },
                      ])
                    }
                  >
                    Adicionar
                  </Button>
                )
              }
            >
              {diagnosticos.length === 0 && (
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  Nenhum diagnóstico registrado.
                </Typography>
              )}

              <Stack spacing={3} divider={<Divider flexItem />}>
                {diagnosticos.map((d, i) => {
                  const amostra = dossie.amostras.find((a) => a.id === d.amostraId);
                  const lateralidadeCadastro = amostra?.lateralidade;
                  const diverge =
                    lateralidadeCadastro &&
                    lateralidadeCadastro !== 'nao_aplicavel' &&
                    d.lateralidade !== 'nao_aplicavel' &&
                    d.lateralidade !== lateralidadeCadastro;

                  return (
                    <Box key={i}>
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={2}
                        sx={{ mb: 2, alignItems: 'flex-start' }}
                      >
                        <TextField
                          select
                          label="Amostra"
                          value={d.amostraId}
                          onChange={(e) => alterarDiagnostico(i, 'amostraId', e.target.value)}
                          disabled={!editavel}
                          sx={{ minWidth: 150, width: { xs: '100%', md: 'auto' }, ...MONO }}
                        >
                          <MenuItem value="">Caso todo</MenuItem>
                          {dossie.amostras.map((a) => (
                            <MenuItem key={a.id} value={a.id}>
                              {a.identificador}
                            </MenuItem>
                          ))}
                        </TextField>

                        <TextField
                          select
                          label="Hierarquia"
                          value={d.hierarquia}
                          onChange={(e) => alterarDiagnostico(i, 'hierarquia', e.target.value)}
                          disabled={!editavel}
                          sx={{ minWidth: 140, width: { xs: '100%', md: 'auto' } }}
                        >
                          {HIERARQUIA.map((h) => (
                            <MenuItem key={h.valor} value={h.valor}>
                              {h.rotulo}
                            </MenuItem>
                          ))}
                        </TextField>

                        <TextField
                          label="Texto exibido no laudo"
                          value={d.textoExibido}
                          onChange={(e) => alterarDiagnostico(i, 'textoExibido', e.target.value)}
                          required
                          error={d.textoExibido.trim() === ''}
                          disabled={!editavel}
                          sx={{ flex: 1, width: { xs: '100%', md: 'auto' } }}
                        />

                        {editavel && (
                          <Tooltip title="Remover diagnóstico">
                            <IconButton
                              onClick={() =>
                                setDiagnosticos((a) => a.filter((_, j) => j !== i))
                              }
                              aria-label="Remover diagnóstico"
                              sx={{ mt: 0.5 }}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>

                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={2}
                        sx={{ alignItems: 'flex-start' }}
                      >
                        <TextField
                          label="Processo"
                          value={d.processo}
                          onChange={(e) => alterarDiagnostico(i, 'processo', e.target.value)}
                          disabled={!editavel}
                          sx={{ flex: 1, width: { xs: '100%', md: 'auto' } }}
                          helperText="inflamatório, neoplásico…"
                        />
                        <TextField
                          label="Entidade"
                          value={d.entidade}
                          onChange={(e) => alterarDiagnostico(i, 'entidade', e.target.value)}
                          disabled={!editavel}
                          sx={{ flex: 1.4, width: { xs: '100%', md: 'auto' } }}
                          helperText="mastocitoma, lipoma…"
                        />
                        <TextField
                          select
                          label="Comportamento"
                          value={d.comportamento}
                          onChange={(e) =>
                            alterarDiagnostico(i, 'comportamento', e.target.value)
                          }
                          disabled={!editavel}
                          sx={{ minWidth: 160, width: { xs: '100%', md: 'auto' } }}
                          helperText=" "
                        >
                          <MenuItem value="">—</MenuItem>
                          {COMPORTAMENTO.map((c) => (
                            <MenuItem key={c.valor} value={c.valor}>
                              {c.rotulo}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          label="Grau"
                          value={d.grau}
                          onChange={(e) => alterarDiagnostico(i, 'grau', e.target.value)}
                          disabled={!editavel}
                          sx={{ width: { xs: '100%', md: 110 } }}
                          helperText=" "
                        />
                        <TextField
                          select
                          label="Lateralidade"
                          value={d.lateralidade}
                          onChange={(e) => alterarDiagnostico(i, 'lateralidade', e.target.value)}
                          disabled={!editavel}
                          sx={{ minWidth: 145, width: { xs: '100%', md: 'auto' } }}
                          // O aviso aparece na digitação; o bloqueio de verdade é
                          // do Guardian, na assinatura.
                          color={diverge ? 'warning' : undefined}
                          focused={diverge || undefined}
                          helperText={
                            lateralidadeCadastro && lateralidadeCadastro !== 'nao_aplicavel'
                              ? `Cadastro: ${lateralidadeCadastro}`
                              : ' '
                          }
                        >
                          {LATERALIDADE.map((l) => (
                            <MenuItem key={l} value={l}>
                              {LATERALIDADE_LABEL[l]}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Stack>

                      <Stack direction="row" spacing={1.5} sx={{ mt: 1, alignItems: 'center' }}>
                        {diverge && (
                          <Chip
                            size="small"
                            color="warning"
                            label="▲ lateralidade diverge do cadastro — o Guardian bloqueia a assinatura"
                          />
                        )}
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={d.provisorio}
                              onChange={(e) =>
                                setDiagnosticos((a) =>
                                  a.map((x, j) =>
                                    i === j ? { ...x, provisorio: e.target.checked } : x,
                                  ),
                                )
                              }
                              disabled={!editavel}
                            />
                          }
                          label="Provisório"
                          slotProps={{ typography: { sx: { fontSize: 13 } } }}
                        />
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Secao>

            <Secao
              titulo="Margens"
              descricao="O sistema não impõe valor universal para “margem próxima” — depende do tumor e do protocolo. “Não avaliável” é resposta válida, não preenchimento pendente."
              acao={
                editavel && (
                  <Button
                    size="small"
                    startIcon={<AddOutlined />}
                    onClick={() =>
                      setMargens((a) => [
                        ...a,
                        { nome: '', resultado: '', distanciaMm: '', observacoes: '' },
                      ])
                    }
                  >
                    Adicionar
                  </Button>
                )
              }
            >
              {margens.length === 0 && (
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  Nenhuma margem avaliada microscopicamente.
                </Typography>
              )}

              {margens.map((m, i) => (
                <Stack
                  key={i}
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <TextField
                    label="Nome"
                    value={m.nome}
                    onChange={(e) => alterarMargem(i, 'nome', e.target.value)}
                    required
                    disabled={!editavel}
                    sx={{ flex: 1, width: { xs: '100%', md: 'auto' } }}
                  />
                  <TextField
                    select
                    label="Resultado"
                    value={m.resultado}
                    onChange={(e) => alterarMargem(i, 'resultado', e.target.value)}
                    required
                    disabled={!editavel}
                    sx={{ minWidth: 160, width: { xs: '100%', md: 'auto' } }}
                  >
                    {RESULTADO_MARGEM.map((r) => (
                      <MenuItem key={r} value={r}>
                        {MARGEM_LABEL[r]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Distância (mm)"
                    type="number"
                    value={m.distanciaMm}
                    onChange={(e) => alterarMargem(i, 'distanciaMm', e.target.value)}
                    disabled={!editavel || m.resultado === 'nao_avaliavel'}
                    sx={{ width: { xs: '100%', md: 140 } }}
                    slotProps={{ htmlInput: { min: 0, step: '0.1', inputMode: 'decimal' } }}
                  />
                  <TextField
                    label="Observações"
                    value={m.observacoes}
                    onChange={(e) => alterarMargem(i, 'observacoes', e.target.value)}
                    disabled={!editavel}
                    sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                  />

                  {editavel && (
                    <Tooltip title="Remover margem">
                      <IconButton
                        onClick={() => setMargens((a) => a.filter((_, j) => j !== i))}
                        aria-label="Remover margem"
                        sx={{ mt: 0.5 }}
                      >
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              ))}
            </Secao>

            <Secao titulo="Comentários e conclusão">
              <TextField
                label="Comentários"
                value={comentarios}
                onChange={(e) => setComentarios(e.target.value)}
                multiline
                minRows={3}
                fullWidth
                disabled={!editavel}
              />
              <TextField
                label="Conclusão"
                value={conclusao}
                onChange={(e) => setConclusao(e.target.value)}
                multiline
                minRows={3}
                fullWidth
                disabled={!editavel}
              />
            </Secao>

            {veNotaInterna && (
              <Secao
                titulo="Nota interna"
                descricao="Nunca aparece no documento entregue. Visível apenas para quem tem a permissão própria."
              >
                <TextField
                  value={notaInterna}
                  onChange={(e) => setNotaInterna(e.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                  disabled={!editavel}
                />
              </Secao>
            )}
          </Stack>

          {bloqueioGuardian && (
            <Alert severity="error" sx={{ mt: 2.5 }}>
              <AlertTitle>Envio impedido pelo Guardian</AlertTitle>
              <Typography sx={{ fontSize: 13, mb: 1 }}>{bloqueioGuardian.detalhe}</Typography>
              <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
                {bloqueioGuardian.achados?.map((achado) => (
                  <Box component="li" key={achado.codigo}>
                    <Typography sx={{ fontSize: 13 }}>{achado.mensagem}</Typography>
                    {achado.evidencias && (
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                        {Object.entries(achado.evidencias)
                          .map(([chave, valor]) => `${chave}: ${String(valor)}`)
                          .join(' · ')}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Alert>
          )}

          {erro && (
            <Alert severity="error" sx={{ mt: 2.5 }}>
              {erro}
            </Alert>
          )}

          {aviso && (
            <Alert severity="success" sx={{ mt: 2.5 }} onClose={() => setAviso(null)}>
              {aviso}
            </Alert>
          )}

          <Stack
            direction={{ xs: 'column-reverse', sm: 'row' }}
            spacing={1.5}
            sx={{ mt: 3, justifyContent: 'flex-end' }}
          >
            <Button onClick={() => navegar(`/casos/${id}`)} disabled={ocupado}>
              {editavel ? 'Cancelar' : 'Voltar ao dossiê'}
            </Button>

            {editavel && (
              <>
                <Button
                  variant="outlined"
                  onClick={() => void salvar()}
                  disabled={ocupado || !diagnosticosValidos || !margensValidas}
                >
                  Salvar rascunho
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SendOutlined />}
                  onClick={() => void enviarParaRevisao()}
                  disabled={ocupado || !diagnosticosValidos || !margensValidas}
                >
                  {ocupado ? 'Processando…' : 'Enviar para revisão'}
                </Button>
              </>
            )}
          </Stack>
        </>
      )}
    </Box>
  );

  function alterarDiagnostico(i: number, campo: keyof Diagnostico, valor: string) {
    setDiagnosticos((a) => a.map((x, j) => (i === j ? { ...x, [campo]: valor } : x)));
  }

  function alterarMargem(i: number, campo: keyof Margem, valor: string) {
    setMargens((a) => a.map((x, j) => (i === j ? { ...x, [campo]: valor } : x)));
  }
}

function Secao({
  titulo,
  descricao,
  acao,
  children,
}: {
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        sx={{ mb: 2, alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}
      >
        <Box>
          <Typography variant="h4">{titulo}</Typography>
          {descricao && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
              {descricao}
            </Typography>
          )}
        </Box>
        {acao}
      </Stack>

      <Divider sx={{ mb: 2.5 }} />

      <Stack spacing={2.5}>{children}</Stack>
    </Card>
  );
}
