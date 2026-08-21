import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import {
  GRAVIDADE_NC,
  RESULTADO_TRIAGEM,
  type GravidadeNc,
  type ResultadoTriagem,
} from '@lapato/shared';
import { api, ErroApi, type Dossie as DadosDossie } from '../api';

/**
 * M06 - Triagem de amostras.
 *
 * DIRETRIZES 8.1: "o Cadastro registra o que foi informado; a Triagem verifica o
 * que existe fisicamente e se esta adequado". A triagem **confirma ou contradiz**
 * o cadastro - nao o substitui. Por isso o que foi cadastrado aparece ao lado de
 * cada amostra, em leitura, e nao ha campo para corrigi-lo aqui.
 *
 * Tres decisoes desta tela carregam regra do modulo:
 *
 * 1. **Nenhum resultado vem pre-selecionado.** Comecar em "apto" faria a
 *    aprovacao ser o caminho sem esforco e a ressalva exigir acao - que e
 *    exatamente como uma conferencia vira clicar em salvar. E o mesmo motivo
 *    pelo qual o campo de quantidade do recebimento nasce vazio.
 * 2. **Bloquear e recusar exigem motivo escrito.** O bloqueio suspende o prazo e
 *    cria uma pendencia de descricao generica; a observacao e o unico lugar onde
 *    cabe o motivo real. A API recusa sem ele - aqui o campo so evita o 400.
 * 3. **Nao conformidade nao e pendencia.** A NC registra o FATO, para a Qualidade
 *    (M22). Resolver o problema nao apaga a NC: adicionar fixador as 14:42 nao
 *    faz o material ter chegado fixado.
 */

const RESULTADO: Record<
  ResultadoTriagem,
  { rotulo: string; simbolo: string; cor: 'success' | 'warning' | 'error'; ajuda: string }
> = {
  apto: {
    rotulo: 'Apto',
    simbolo: '✓',
    cor: 'success',
    ajuda: 'Material adequado. O caso segue para a próxima etapa.',
  },
  apto_com_ressalva: {
    rotulo: 'Apto com ressalva',
    simbolo: '▲',
    cor: 'warning',
    ajuda: 'O caso avança, e a ressalva fica registrada no material.',
  },
  bloqueado: {
    rotulo: 'Bloqueado',
    simbolo: '⊘',
    cor: 'error',
    ajuda: 'O caso não avança. Gera pendência e suspende o prazo.',
  },
  recusado: {
    rotulo: 'Recusado',
    simbolo: '⨯',
    cor: 'error',
    ajuda: 'Material não aproveitável. O caso não avança.',
  },
};

/** M06: bloqueado e recusado seguram o caso; os demais deixam seguir. */
const TRAVA: ResultadoTriagem[] = ['bloqueado', 'recusado'];

const GRAVIDADE_LABEL: Record<GravidadeNc, string> = {
  leve: 'Leve',
  moderada: 'Moderada',
  grave: 'Grave',
  critica: 'Crítica',
};

/**
 * Tipos de nao conformidade pre-analitica. A API aceita texto livre e o M01
 * ainda nao tem tabela mestre para isto; estes sao os casos que a documentacao
 * do M05/M06 cita nominalmente, com "outra" preservando o texto livre.
 */
const TIPO_NC = [
  { valor: 'identificacao_ausente', rotulo: 'Identificação ausente ou ilegível' },
  { valor: 'identificacao_divergente', rotulo: 'Identificação divergente da requisição' },
  { valor: 'fixacao_inadequada', rotulo: 'Fixação inadequada' },
  { valor: 'volume_fixador_insuficiente', rotulo: 'Volume de fixador insuficiente' },
  { valor: 'recipiente_danificado', rotulo: 'Recipiente danificado ou com vazamento' },
  { valor: 'material_autolisado', rotulo: 'Material autolisado' },
  { valor: 'divergencia_quantidade', rotulo: 'Divergência de quantidade' },
  { valor: 'requisicao_incompleta', rotulo: 'Requisição incompleta' },
  { valor: 'outra', rotulo: 'Outra' },
] as const;

interface NaoConformidade {
  amostraId: string;
  tipo: string;
  gravidade: GravidadeNc;
  descricao: string;
}

const NC_VAZIA: NaoConformidade = {
  amostraId: '',
  tipo: '',
  gravidade: 'moderada',
  descricao: '',
};

interface Avaliacao {
  resultado: ResultadoTriagem | '';
  observacoes: string;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function Triagem() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('sm'));

  const [dados, setDados] = useState<DadosDossie | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<Record<string, Avaliacao>>({});
  const [ncs, setNcs] = useState<NaoConformidade[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueioGuardian, setBloqueioGuardian] = useState<ErroApi | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (id) {
      api
        .get<DadosDossie>(`/casos/${id}`)
        .then(setDados)
        .catch(() => setErro('Não foi possível carregar o caso.'));
    }
  }, [id]);

  const amostras = dados?.amostras ?? [];

  const avaliacao = (amostraId: string): Avaliacao =>
    avaliacoes[amostraId] ?? { resultado: '', observacoes: '' };

  function alterar(amostraId: string, campo: keyof Avaliacao, valor: string) {
    setAvaliacoes((atual) => ({
      ...atual,
      [amostraId]: { ...avaliacao(amostraId), [campo]: valor },
    }));
  }

  /**
   * M05: o resultado do caso deriva do das amostras, e o pior vence - uma
   * amostra bloqueada segura o caso inteiro. Isso e calculado no servidor; aqui
   * a mesma regra e espelhada para que a consequencia apareca **antes** de
   * concluir, e nao como surpresa depois.
   */
  const resultadoDoCaso = useMemo((): ResultadoTriagem | null => {
    const escolhidos = amostras
      .map((a) => avaliacao(a.id).resultado)
      .filter((r): r is ResultadoTriagem => r !== '');

    if (escolhidos.length === 0) return null;
    if (escolhidos.includes('bloqueado')) return 'bloqueado';
    if (escolhidos.includes('recusado')) return 'recusado';
    if (escolhidos.includes('apto_com_ressalva')) return 'apto_com_ressalva';
    return 'apto';
  }, [amostras, avaliacoes]);

  /** Toda amostra precisa de resultado, e quem trava precisa de motivo. */
  const completo = useMemo(
    () =>
      amostras.length > 0 &&
      amostras.every((a) => {
        const { resultado, observacoes } = avaliacao(a.id);
        if (resultado === '') return false;
        if (TRAVA.includes(resultado)) return observacoes.trim() !== '';
        return true;
      }),
    [amostras, avaliacoes],
  );

  const ncsValidas = ncs.filter((n) => n.tipo !== '' && n.descricao.trim() !== '');
  const travara = resultadoDoCaso !== null && TRAVA.includes(resultadoDoCaso);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setBloqueioGuardian(null);
    setEnviando(true);

    try {
      await api.post(`/casos/${id}/triagem`, {
        amostras: amostras.map((a) => {
          const { resultado, observacoes } = avaliacao(a.id);
          return {
            amostraId: a.id,
            resultado,
            ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
          };
        }),
        ...(ncsValidas.length > 0
          ? {
              naoConformidades: ncsValidas.map((n) => ({
                ...(n.amostraId ? { amostraId: n.amostraId } : {}),
                tipo: n.tipo,
                gravidade: n.gravidade,
                descricao: n.descricao.trim(),
              })),
            }
          : {}),
      });

      navegar(`/casos/${id}`);
    } catch (err) {
      /**
       * M05: sem correspondência segura material-paciente, o Guardian impede a
       * progressão. M17 seção 15 pede que a intervenção diga o que a sustenta —
       * então o achado é exibido inteiro, com evidências, em vez de virar um
       * "erro ao salvar".
       */
      if (err instanceof ErroApi && err.bloqueadoPeloGuardian) {
        setBloqueioGuardian(err);
      } else {
        setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível concluir a triagem.');
      }
      setEnviando(false);
    }
  }

  if (!dados) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <Stack spacing={2} sx={{ maxWidth: 860 }}>
        <Skeleton variant="rounded" height={70} />
        <Skeleton variant="rounded" height={300} />
      </Stack>
    );
  }

  /**
   * M05: a triagem verifica o material FISICO. Sem recebimento registrado nao
   * ha o que conferir - a API recusa, e mostrar o formulario seria convidar ao
   * preenchimento inútil.
   */
  if (!dados.caso.recebidoEm) {
    return (
      <Box sx={{ maxWidth: 860 }}>
        <Alert
          severity="info"
          action={
            <Button size="small" component={Link} to={`/casos/${id}/recebimento`}>
              Ir ao recebimento
            </Button>
          }
        >
          <AlertTitle>Material ainda não recebido</AlertTitle>
          A triagem confere o material físico. Registre o recebimento de{' '}
          {dados.caso.identificador} primeiro.
        </Alert>
      </Box>
    );
  }

  if (dados.caso.triadoEm) {
    const anterior = dados.caso.resultadoTriagem as ResultadoTriagem | null;
    return (
      <Box sx={{ maxWidth: 860 }}>
        <Alert
          severity={anterior && TRAVA.includes(anterior) ? 'warning' : 'success'}
          icon={<CheckCircleOutline />}
          action={
            <Button size="small" onClick={() => navegar(`/casos/${id}`)}>
              Abrir dossiê
            </Button>
          }
        >
          <AlertTitle>Caso já triado</AlertTitle>
          A triagem de {dados.caso.identificador} foi concluída em{' '}
          {new Date(dados.caso.triadoEm).toLocaleString('pt-BR')}
          {anterior ? `, com resultado ${RESULTADO[anterior].rotulo.toLowerCase()}` : ''}.
        </Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={submeter} noValidate sx={{ maxWidth: 860 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Triagem
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        A triagem confirma ou contradiz o cadastro — não o substitui. O que foi declarado aparece
        ao lado, em leitura.
      </Typography>

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
            {dados.caso.identificador}
          </Typography>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Paciente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.paciente.nome}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Recebido em</Typography>
            <Typography sx={{ fontSize: 13.5 }}>
              {new Date(dados.caso.recebidoEm).toLocaleString('pt-BR')}
            </Typography>
          </Box>
        </Stack>
      </Card>

      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Amostras
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          Nenhum resultado vem marcado — a avaliação é de quem olhou o material.
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        <Stack spacing={3.5} divider={<Divider flexItem />}>
          {amostras.map((a) => {
            const { resultado, observacoes } = avaliacao(a.id);
            const trava = resultado !== '' && TRAVA.includes(resultado);

            return (
              <Box key={a.id}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ mb: 1.5, alignItems: { sm: 'baseline' }, justifyContent: 'space-between' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ ...MONO, fontSize: 13 }}>{a.identificador}</Typography>
                    <Typography sx={{ fontSize: 13.5 }}>{a.descricao ?? '—'}</Typography>
                  </Box>

                  {/* O cadastro em leitura: é o que a triagem confirma ou contradiz. */}
                  {a.lateralidade !== 'nao_aplicavel' && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`cadastrado: ${a.lateralidade}`}
                      sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}
                    />
                  )}
                </Stack>

                <ToggleButtonGroup
                  exclusive
                  // `null` e nao `''`: em modo exclusivo e assim que o MUI
                  // representa "nada selecionado".
                  value={resultado === '' ? null : resultado}
                  onChange={(_, v: ResultadoTriagem | null) => v && alterar(a.id, 'resultado', v)}
                  aria-label={`Resultado da triagem de ${a.identificador}`}
                  /**
                   * Em tela estreita os quatro rótulos não cabem lado a lado, e
                   * "Apto com ressalva" truncado perde justamente a palavra que
                   * o distingue de "Apto". Vertical é a forma que o próprio
                   * componente sabe estilizar — quebrar em duas colunas deixaria
                   * o arredondamento das bordas errado.
                   */
                  orientation={estreito ? 'vertical' : 'horizontal'}
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  {RESULTADO_TRIAGEM.map((r) => (
                    <ToggleButton
                      key={r}
                      value={r}
                      sx={{
                        px: 1.5,
                        py: 0.75,
                        fontSize: 12.5,
                        textTransform: 'none',
                        gap: 0.75,
                        // Vertical: alinhar à esquerda em vez de centrar cada
                        // rótulo numa largura diferente.
                        justifyContent: { xs: 'flex-start', sm: 'center' },
                        '&.Mui-selected': {
                          color: `${RESULTADO[r].cor}.main`,
                          borderColor: `${RESULTADO[r].cor}.main`,
                          backgroundColor: `${RESULTADO[r].cor}.50`,
                          fontWeight: 600,
                        },
                      }}
                    >
                      {/* M07: o indicador não pode depender só de cor — símbolo
                          e rótulo acompanham. */}
                      <Box aria-hidden component="span">
                        {RESULTADO[r].simbolo}
                      </Box>
                      {RESULTADO[r].rotulo}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>

                {resultado !== '' && (
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.75 }}>
                    {RESULTADO[resultado].ajuda}
                  </Typography>
                )}

                <TextField
                  label={trava ? 'Motivo' : 'Observações'}
                  value={observacoes}
                  onChange={(e) => alterar(a.id, 'observacoes', e.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                  required={trava}
                  sx={{ mt: 2 }}
                  helperText={
                    trava
                      ? 'Obrigatório: é o único lugar onde fica registrado por que o caso parou.'
                      : ' '
                  }
                />
              </Box>
            );
          })}
        </Stack>
      </Card>

      <Card sx={{ p: 2.5, mt: 2.5 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}
        >
          <Box>
            <Typography variant="h4">Não conformidades</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
              Registram o fato, para a Qualidade. Corrigir o problema depois não apaga a não
              conformidade — e não é para apagar.
            </Typography>
          </Box>
          <Button
            size="small"
            startIcon={<AddOutlined />}
            onClick={() => setNcs((atual) => [...atual, { ...NC_VAZIA }])}
          >
            Adicionar
          </Button>
        </Stack>

        {ncs.length > 0 && <Divider sx={{ my: 2.5 }} />}

        <Stack spacing={2.5}>
          {ncs.map((n, i) => (
            <Stack
              key={i}
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: 'flex-start' }}
            >
              <TextField
                select
                label="Tipo"
                value={n.tipo}
                onChange={(e) =>
                  setNcs((atual) =>
                    atual.map((x, j) => (i === j ? { ...x, tipo: e.target.value } : x)),
                  )
                }
                sx={{ flex: 1.4, minWidth: 190, width: { xs: '100%', md: 'auto' } }}
              >
                {TIPO_NC.map((t) => (
                  <MenuItem key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label="Gravidade"
                value={n.gravidade}
                onChange={(e) =>
                  setNcs((atual) =>
                    atual.map((x, j) =>
                      i === j ? { ...x, gravidade: e.target.value as GravidadeNc } : x,
                    ),
                  )
                }
                sx={{ flex: 1, minWidth: 140, width: { xs: '100%', md: 'auto' } }}
              >
                {GRAVIDADE_NC.map((g) => (
                  <MenuItem key={g} value={g}>
                    {GRAVIDADE_LABEL[g]}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label="Amostra"
                value={n.amostraId}
                onChange={(e) =>
                  setNcs((atual) =>
                    atual.map((x, j) => (i === j ? { ...x, amostraId: e.target.value } : x)),
                  )
                }
                sx={{ flex: 1, minWidth: 150, width: { xs: '100%', md: 'auto' } }}
                // A NC pode ser do caso todo — requisição incompleta, por
                // exemplo, não pertence a nenhuma amostra em particular.
                helperText="Vazio: do caso"
              >
                <MenuItem value="">Todo o caso</MenuItem>
                {amostras.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.identificador}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Descrição"
                value={n.descricao}
                onChange={(e) =>
                  setNcs((atual) =>
                    atual.map((x, j) => (i === j ? { ...x, descricao: e.target.value } : x)),
                  )
                }
                sx={{ flex: 2, width: { xs: '100%', md: 'auto' } }}
              />

              <Tooltip title="Remover não conformidade">
                <IconButton
                  onClick={() => setNcs((atual) => atual.filter((_, j) => j !== i))}
                  aria-label="Remover não conformidade"
                  sx={{ mt: 0.5 }}
                >
                  <DeleteOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      </Card>

      {/**
        * O resultado agregado aparece enquanto se preenche. A regra "o pior
        * vence" é invisível se só se manifestar depois de salvar — e é ela que
        * explica por que uma amostra bloqueada em cinco segura o caso todo.
        */}
      {resultadoDoCaso && (
        <Alert
          severity={travara ? 'warning' : 'info'}
          sx={{ mt: 2.5 }}
          icon={<Box aria-hidden>{RESULTADO[resultadoDoCaso].simbolo}</Box>}
        >
          <AlertTitle>Resultado do caso: {RESULTADO[resultadoDoCaso].rotulo}</AlertTitle>
          {travara ? (
            <>
              O caso <strong>não avança</strong>. Uma pendência de triagem é criada, o prazo fica
              suspenso e a bancada recusa iniciar a macroscopia até a resolução. Isso é um desfecho
              previsto da triagem, não um erro.
            </>
          ) : (
            <>
              O caso segue para a próxima etapa. O resultado do caso é o pior entre as amostras.
            </>
          )}
        </Alert>
      )}

      {bloqueioGuardian && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          <AlertTitle>Triagem impedida pelo Guardian</AlertTitle>
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

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, justifyContent: 'flex-end' }}>
        <Button onClick={() => navegar(`/casos/${id}`)} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          type="submit"
          variant="contained"
          color={travara ? 'warning' : 'primary'}
          disabled={enviando || !completo}
        >
          {/* O rótulo diz o que o clique faz. "Concluir" num caso que vai
              travar esconderia a consequência atrás de uma palavra neutra. */}
          {enviando
            ? 'Registrando…'
            : travara
              ? `Concluir e ${resultadoDoCaso === 'recusado' ? 'recusar material' : 'bloquear o caso'}`
              : 'Concluir triagem'}
        </Button>
      </Stack>

      {!completo && amostras.length > 0 && (
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', textAlign: 'right', mt: 1 }}>
          Avalie todas as amostras. Bloqueado e recusado exigem o motivo.
        </Typography>
      )}
    </Box>
  );
}
