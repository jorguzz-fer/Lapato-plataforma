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
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import {
  GRUPOS_DESCRITORES_MACRO,
  LATERALIDADE,
  METODO_AMOSTRAGEM,
  type Lateralidade,
  type MetodoAmostragem,
} from '@lapato/shared';
import {
  api,
  ErroApi,
  type Dossie as DadosDossie,
  type FichaMacroscopia,
} from '../api';
import { BloqueioGuardian } from './BloqueioGuardian';
import { AvisoBancadaBloqueada, impedimentoDeBancada } from './AvisoBancadaBloqueada';

/**
 * M08 - Macroscopia.
 *
 * "Transformar uma peca anatomica em representacao estruturada, mensuravel,
 * fotografada e amostrada."
 *
 * Decisoes desta tela que vem do modulo, e nao de gosto:
 *
 * - **Uma ficha por amostra, nao por caso.** Por isso as abas: um caso com tres
 *   amostras tem tres fichas independentes, cada uma com suas medidas, lesoes,
 *   margens e cassetes. Uma tela unica somando tudo esconderia justamente a
 *   unidade que o modulo define.
 * - **Campos estruturados e texto livre coexistem** - exigencia explicita, "um
 *   nao substitui o outro". O texto nao e resumo dos campos nem os dispensa.
 * - **Cassete sem tecido de origem nao existe.** O Guardian barra a conclusao,
 *   e aqui o campo e obrigatorio antes disso: produzir cassete irrastreavel
 *   quebraria a cadeia Caso -> Amostra -> Cassete -> Bloco -> Corte -> Lamina.
 * - **Cassete e objeto fisico.** Uma vez criado, ganha identificador definitivo
 *   e nao volta atras pela tela - por isso os ja gravados aparecem em leitura, e
 *   so os novos sao enviados. Reenviar os antigos criaria duplicatas com
 *   numeracao nova, que e exatamente o que o M08 proibe.
 */

const LATERALIDADE_LABEL: Record<Lateralidade, string> = {
  direito: 'Direito',
  esquerdo: 'Esquerdo',
  bilateral: 'Bilateral',
  nao_aplicavel: 'Não se aplica',
};

const METODO_LABEL: Record<MetodoAmostragem, string> = {
  perpendicular: 'Perpendicular',
  tangencial_en_face: 'Tangencial (en face)',
  radial: 'Radial',
};

interface Lesao {
  rotulo: string;
  tipo: string;
  localizacao: string;
  lateralidade: Lateralidade;
  maiorEixoCm: string;
  menorEixoCm: string;
}

interface Margem {
  nome: string;
  metodoAmostragem: MetodoAmostragem | '';
  distanciaCm: string;
  naoAvaliavel: boolean;
}

interface CasseteNovo {
  tecidoOrigem: string;
  descricao: string;
  exigeDescalcificacao: boolean;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const numero = (v: string) => (v.trim() === '' ? undefined : Number(v));

interface Props {
  /** M08: residente e técnico em treinamento executam, mas não concluem. */
  exigeSupervisao: boolean;
}

const LESAO_VAZIA = (rotulo: string) => ({
  rotulo,
  tipo: '',
  localizacao: '',
  lateralidade: 'nao_aplicavel' as Lateralidade,
  maiorEixoCm: '',
  menorEixoCm: '',
});

/** Linha que so tem o rotulo automatico: apresentada, mas nunca preenchida. */
const lesaoIntocada = (l: ReturnType<typeof LESAO_VAZIA>) =>
  l.tipo.trim() === '' &&
  l.localizacao.trim() === '' &&
  l.lateralidade === 'nao_aplicavel' &&
  l.maiorEixoCm === '' &&
  l.menorEixoCm === '';

export function Macroscopia({ exigeSupervisao }: Props) {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();

  const [dossie, setDossie] = useState<DadosDossie | null>(null);
  const [amostraId, setAmostraId] = useState('');
  const [ficha, setFicha] = useState<FichaMacroscopia | null>(null);
  const [carregandoFicha, setCarregandoFicha] = useState(false);

  const [descricaoTexto, setDescricaoTexto] = useState('');
  const [selecoes, setSelecoes] = useState<Record<string, string[]>>({});
  const [outroPorGrupo, setOutroPorGrupo] = useState<Record<string, string>>({});
  const [compondo, setCompondo] = useState(false);
  const [comprimento, setComprimento] = useState('');
  const [largura, setLargura] = useState('');
  const [altura, setAltura] = useState('');
  const [peso, setPeso] = useState('');
  const [totalmenteIncluido, setTotalmenteIncluido] = useState(false);
  const [lesoes, setLesoes] = useState<Lesao[]>([]);
  const [margens, setMargens] = useState<Margem[]>([]);
  const [novosCassetes, setNovosCassetes] = useState<CasseteNovo[]>([]);
  const [quantidadeCassetes, setQuantidadeCassetes] = useState('1');

  const [erro, setErro] = useState<string | null>(null);
  const [bloqueioGuardian, setBloqueioGuardian] = useState<ErroApi | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (id) {
      api
        .get<DadosDossie>(`/casos/${id}`)
        .then((d) => {
          setDossie(d);
          setAmostraId((atual) => atual || (d.amostras[0]?.id ?? ''));
        })
        .catch(() => setErro('Não foi possível carregar o caso.'));
    }
  }, [id]);

  /** Preenche o formulário a partir do que já está gravado. */
  const carregar = useCallback((dados: FichaMacroscopia | null) => {
    setFicha(dados);
    setDescricaoTexto(dados?.descricaoTexto ?? '');
    setSelecoes({});
    setOutroPorGrupo({});
    setComprimento(dados?.comprimentoCm ?? '');
    setLargura(dados?.larguraCm ?? '');
    setAltura(dados?.alturaCm ?? '');
    setPeso(dados?.pesoG ?? '');
    setTotalmenteIncluido(dados?.materialTotalmenteIncluido ?? false);
    const lesoesGravadas = (dados?.lesoes ?? []).map((l) => ({
      rotulo: l.rotulo,
      tipo: l.tipo ?? '',
      localizacao: l.localizacao ?? '',
      lateralidade: (l.lateralidade as Lateralidade) ?? 'nao_aplicavel',
      maiorEixoCm: l.maiorEixoCm ?? '',
      menorEixoCm: l.menorEixoCm ?? '',
    }));
    /**
     * Ficha aberta sem lesao ja apresenta uma linha pronta: na review, o botao
     * "Adicionar" escondido a direita passou despercebido e a secao parecia
     * nao ter onde escrever. A linha intocada e descartada no salvar.
     */
    setLesoes(
      lesoesGravadas.length === 0 && dados && dados.concluidaEm == null
        ? [LESAO_VAZIA('L01')]
        : lesoesGravadas,
    );
    setMargens(
      (dados?.margens ?? []).map((m) => ({
        nome: m.nome,
        metodoAmostragem: (m.metodoAmostragem as MetodoAmostragem | null) ?? '',
        distanciaCm: m.distanciaCm ?? '',
        naoAvaliavel: m.naoAvaliavel,
      })),
    );
    setNovosCassetes([]);
  }, []);

  useEffect(() => {
    if (!amostraId) return;
    setCarregandoFicha(true);
    setErro(null);
    setAviso(null);
    setBloqueioGuardian(null);
    api
      .get<FichaMacroscopia | null>(`/macroscopia/amostras/${amostraId}`)
      .then(carregar)
      .catch(() => setErro('Não foi possível carregar a ficha de macroscopia.'))
      .finally(() => setCarregandoFicha(false));
  }, [amostraId, carregar]);

  const amostra = useMemo(
    () => dossie?.amostras.find((a) => a.id === amostraId),
    [dossie, amostraId],
  );

  /** M06 -> M08: material bloqueado ou recusado não chega à bancada. */
  const travadaNaTriagem =
    amostra?.resultadoTriagem === 'bloqueado' || amostra?.resultadoTriagem === 'recusado';

  const concluida = ficha?.concluidaEm != null;
  const proximoRotulo = `L${String(lesoes.length + 1).padStart(2, '0')}`;

  async function iniciar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post<{ id: string }>(`/macroscopia/amostras/${amostraId}`);
      carregar(await api.get<FichaMacroscopia | null>(`/macroscopia/amostras/${amostraId}`));
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível iniciar a macroscopia.');
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Compoe o texto no servidor: a base deterministica sempre responde; o
   * Copiloto lapida quando ha provedor. O resultado ENTRA NO CAMPO, editavel -
   * quem assina e o profissional, nao o compositor.
   */
  async function compor() {
    if (!ficha) return;
    setCompondo(true);
    setErro(null);
    try {
      const r = await api.post<{ texto: string; origem: 'ia' | 'padrao' }>(
        `/macroscopia/${ficha.id}/composicao`,
        { selecoes },
      );
      setDescricaoTexto((atual) => (atual.trim() ? `${atual.trim()}\n\n${r.texto}` : r.texto));
      if (r.origem === 'padrao') {
        setAviso('Texto composto no modo padrão (IA indisponível) — revise e ajuste à vontade.');
      }
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível compor a descrição.');
    } finally {
      setCompondo(false);
    }
  }

  async function salvar(): Promise<boolean> {
    if (!ficha) return false;
    setOcupado(true);
    setErro(null);
    setAviso(null);

    try {
      await api.post(`/macroscopia/${ficha.id}`, {
        ...(descricaoTexto.trim() ? { descricaoTexto: descricaoTexto.trim() } : {}),
        ...(numero(comprimento) ? { comprimentoCm: numero(comprimento) } : {}),
        ...(numero(largura) ? { larguraCm: numero(largura) } : {}),
        ...(numero(altura) ? { alturaCm: numero(altura) } : {}),
        ...(numero(peso) ? { pesoG: numero(peso) } : {}),
        materialTotalmenteIncluido: totalmenteIncluido,
        ...(lesoes.filter((l) => !lesaoIntocada(l)).length > 0
          ? {
              lesoes: lesoes.filter((l) => !lesaoIntocada(l)).map((l) => ({
                rotulo: l.rotulo,
                ...(l.tipo.trim() ? { tipo: l.tipo.trim() } : {}),
                ...(l.localizacao.trim() ? { localizacao: l.localizacao.trim() } : {}),
                lateralidade: l.lateralidade,
                ...(numero(l.maiorEixoCm) ? { maiorEixoCm: numero(l.maiorEixoCm) } : {}),
                ...(numero(l.menorEixoCm) ? { menorEixoCm: numero(l.menorEixoCm) } : {}),
              })),
            }
          : {}),
        ...(margens.length > 0
          ? {
              margens: margens.map((m) => ({
                nome: m.nome,
                ...(m.metodoAmostragem ? { metodoAmostragem: m.metodoAmostragem } : {}),
                ...(numero(m.distanciaCm) !== undefined
                  ? { distanciaCm: numero(m.distanciaCm) }
                  : {}),
                naoAvaliavel: m.naoAvaliavel,
              })),
            }
          : {}),
        // Só os novos: os já gravados têm identificador definitivo e reenviá-los
        // criaria duplicatas com numeração nova.
        ...(novosCassetes.length > 0
          ? {
              cassetes: novosCassetes.map((c) => ({
                tecidoOrigem: c.tecidoOrigem.trim(),
                ...(c.descricao.trim() ? { descricao: c.descricao.trim() } : {}),
                exigeDescalcificacao: c.exigeDescalcificacao,
              })),
            }
          : {}),
      });

      carregar(await api.get<FichaMacroscopia | null>(`/macroscopia/amostras/${amostraId}`));
      setAviso('Rascunho salvo.');
      return true;
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar a macroscopia.');
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function concluir() {
    // Concluir sem salvar antes descartaria o que está na tela: o servidor
    // avaliaria a ficha gravada, que não é a que a pessoa está vendo.
    if (!(await salvar())) return;
    if (!ficha) return;

    setOcupado(true);
    setErro(null);
    setBloqueioGuardian(null);

    try {
      await api.post(`/macroscopia/${ficha.id}/conclusao`);
      carregar(await api.get<FichaMacroscopia | null>(`/macroscopia/amostras/${amostraId}`));
      setAviso(null);
    } catch (err) {
      /** M17 seção 15: o achado é exibido inteiro, com o que o sustenta. */
      if (err instanceof ErroApi && err.bloqueadoPeloGuardian) {
        setBloqueioGuardian(err);
      } else {
        setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível concluir a macroscopia.');
      }
    } finally {
      setOcupado(false);
    }
  }

  const cassetesIncompletos = novosCassetes.some((c) => c.tecidoOrigem.trim() === '');
  const lesoesIncompletas = lesoes.some((l) => l.rotulo.trim() === '' && !lesaoIntocada(l));
  const margensIncompletas = margens.some((m) => m.nome.trim() === '');
  const podeSalvar =
    !ocupado && !cassetesIncompletos && !lesoesIncompletas && !margensIncompletas;

  if (!dossie) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <Stack spacing={2} sx={{ maxWidth: 900 }}>
        <Skeleton variant="rounded" height={70} />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  }

  /**
   * M05 secao 12: cadastrado nao e recebido. Mostrar a ficha de um caso que a
   * API vai recusar convida a preencher a toa - a triagem ja se comporta assim.
   */
  if (impedimentoDeBancada(dossie, 'macroscopia')) {
    return <AvisoBancadaBloqueada dossie={dossie} etapa="macroscopia" />;
  }

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Macroscopia
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Uma ficha por amostra. Campos estruturados e texto livre convivem — um não substitui o
        outro.
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
        </Stack>
      </Card>

      {/* Uma ficha por amostra: as abas tornam isso estrutural em vez de implícito. */}
      <Tabs
        value={amostraId}
        onChange={(_, v: string) => setAmostraId(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {dossie.amostras.map((a) => (
          <Tab
            key={a.id}
            value={a.id}
            label={a.identificador}
            sx={{ ...MONO, fontSize: 13, minHeight: 42 }}
          />
        ))}
      </Tabs>

      {carregandoFicha ? (
        <Skeleton variant="rounded" height={320} />
      ) : travadaNaTriagem ? (
        <Alert severity="warning">
          <AlertTitle>Amostra {amostra?.resultadoTriagem?.replaceAll('_', ' ')} na triagem</AlertTitle>
          Material com esse resultado não segue para a bancada. Resolva a pendência de triagem
          antes da macroscopia.
        </Alert>
      ) : !ficha ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <ScienceOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography sx={{ fontWeight: 600 }}>Macroscopia ainda não iniciada</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2.5 }}>
            Iniciar registra o horário, move o caso para “em macroscopia” e fica na linha do tempo.
          </Typography>
          <Button variant="contained" onClick={iniciar} disabled={ocupado}>
            {ocupado ? 'Iniciando…' : 'Iniciar macroscopia'}
          </Button>
        </Card>
      ) : (
        <>
          {concluida && (
            <Alert severity="success" sx={{ mb: 2.5 }}>
              <AlertTitle>Macroscopia concluída</AlertTitle>
              Concluída em {new Date(ficha.concluidaEm!).toLocaleString('pt-BR')}. Alterar depois
              da conclusão exige permissão própria e passa por outra rota.
            </Alert>
          )}

          {!concluida && exigeSupervisao && (
            /* M08: dito antes de preencher, e não como 403 no botão de concluir. */
            <Alert severity="info" sx={{ mb: 2.5 }}>
              Seu perfil está sob supervisão: você registra a macroscopia, mas a conclusão precisa
              de um responsável.
            </Alert>
          )}

          <Stack spacing={2.5}>
            <Secao titulo="Medidas" descricao="Em centímetros; peso em gramas.">
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Medida rotulo="Comprimento" valor={comprimento} aoMudar={setComprimento} travado={concluida} />
                <Medida rotulo="Largura" valor={largura} aoMudar={setLargura} travado={concluida} />
                <Medida rotulo="Altura" valor={altura} aoMudar={setAltura} travado={concluida} />
                <Medida rotulo="Peso (g)" valor={peso} aoMudar={setPeso} travado={concluida} />
              </Stack>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={totalmenteIncluido}
                    onChange={(e) => setTotalmenteIncluido(e.target.checked)}
                    disabled={concluida}
                  />
                }
                // M18: se nada sobra, não há o que arquivar na Bioteca.
                label="Material totalmente incluído (não há remanescente)"
                slotProps={{ typography: { sx: { fontSize: 13.5 } } }}
              />
            </Secao>

            <Secao
              titulo="Lesões"
              descricao="A lateralidade daqui é comparada com o laudo antes da assinatura."
              acao={
                !concluida && (
                  <Button
                    size="small"
                    startIcon={<AddOutlined />}
                    onClick={() =>
                      setLesoes((a) => [
                        ...a,
                        {
                          rotulo: proximoRotulo,
                          tipo: '',
                          localizacao: '',
                          lateralidade: 'nao_aplicavel',
                          maiorEixoCm: '',
                          menorEixoCm: '',
                        },
                      ])
                    }
                  >
                    Adicionar
                  </Button>
                )
              }
            >
              {lesoes.length === 0 && <Vazio texto="Nenhuma lesão descrita." />}

              {lesoes.map((l, i) => (
                <Stack
                  key={i}
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <TextField
                    label="Rótulo"
                    value={l.rotulo}
                    onChange={(e) =>
                      setLesoes((a) =>
                        a.map((x, j) => (i === j ? { ...x, rotulo: e.target.value } : x)),
                      )
                    }
                    required
                    disabled={concluida}
                    sx={{ width: { xs: '100%', md: 100 }, ...MONO }}
                  />
                  <TextField
                    label="Tipo"
                    value={l.tipo}
                    onChange={(e) =>
                      setLesoes((a) =>
                        a.map((x, j) => (i === j ? { ...x, tipo: e.target.value } : x)),
                      )
                    }
                    disabled={concluida}
                    sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                  />
                  <TextField
                    label="Localização"
                    value={l.localizacao}
                    onChange={(e) =>
                      setLesoes((a) =>
                        a.map((x, j) => (i === j ? { ...x, localizacao: e.target.value } : x)),
                      )
                    }
                    disabled={concluida}
                    sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                  />
                  <TextField
                    select
                    label="Lateralidade"
                    value={l.lateralidade}
                    onChange={(e) =>
                      setLesoes((a) =>
                        a.map((x, j) =>
                          i === j ? { ...x, lateralidade: e.target.value as Lateralidade } : x,
                        ),
                      )
                    }
                    disabled={concluida}
                    sx={{ minWidth: 145, width: { xs: '100%', md: 'auto' } }}
                  >
                    {LATERALIDADE.map((v) => (
                      <MenuItem key={v} value={v}>
                        {LATERALIDADE_LABEL[v]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Medida
                    rotulo="Maior eixo"
                    valor={l.maiorEixoCm}
                    travado={concluida}
                    aoMudar={(v) =>
                      setLesoes((a) => a.map((x, j) => (i === j ? { ...x, maiorEixoCm: v } : x)))
                    }
                  />
                  <Medida
                    rotulo="Menor eixo"
                    valor={l.menorEixoCm}
                    travado={concluida}
                    aoMudar={(v) =>
                      setLesoes((a) => a.map((x, j) => (i === j ? { ...x, menorEixoCm: v } : x)))
                    }
                  />

                  {!concluida && (
                    <Remover
                      rotulo="Remover lesão"
                      aoRemover={() => setLesoes((a) => a.filter((_, j) => j !== i))}
                    />
                  )}
                </Stack>
              ))}
            </Secao>

            <Secao
              titulo="Margens"
              descricao="O método de amostragem é o que permite ler a distância na microscopia — tangencial e perpendicular não significam a mesma coisa (M13)."
              acao={
                !concluida && (
                  <Button
                    size="small"
                    startIcon={<AddOutlined />}
                    onClick={() =>
                      setMargens((a) => [
                        ...a,
                        { nome: '', metodoAmostragem: '', distanciaCm: '', naoAvaliavel: false },
                      ])
                    }
                  >
                    Adicionar
                  </Button>
                )
              }
            >
              {margens.length === 0 && <Vazio texto="Nenhuma margem avaliada." />}

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
                    onChange={(e) =>
                      setMargens((a) =>
                        a.map((x, j) => (i === j ? { ...x, nome: e.target.value } : x)),
                      )
                    }
                    required
                    disabled={concluida}
                    sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                  />
                  <TextField
                    select
                    label="Método"
                    value={m.metodoAmostragem}
                    onChange={(e) =>
                      setMargens((a) =>
                        a.map((x, j) =>
                          i === j
                            ? { ...x, metodoAmostragem: e.target.value as MetodoAmostragem }
                            : x,
                        ),
                      )
                    }
                    disabled={concluida}
                    sx={{ minWidth: 185, width: { xs: '100%', md: 'auto' } }}
                  >
                    <MenuItem value="">—</MenuItem>
                    {METODO_AMOSTRAGEM.map((v) => (
                      <MenuItem key={v} value={v}>
                        {METODO_LABEL[v]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Medida
                    rotulo="Distância"
                    valor={m.distanciaCm}
                    travado={concluida || m.naoAvaliavel}
                    aoMudar={(v) =>
                      setMargens((a) => a.map((x, j) => (i === j ? { ...x, distanciaCm: v } : x)))
                    }
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={m.naoAvaliavel}
                        onChange={(e) =>
                          setMargens((a) =>
                            a.map((x, j) =>
                              i === j
                                ? {
                                    ...x,
                                    naoAvaliavel: e.target.checked,
                                    // Não avaliável e distância medida se
                                    // contradizem; a marcação limpa o número.
                                    distanciaCm: e.target.checked ? '' : x.distanciaCm,
                                  }
                                : x,
                            ),
                          )
                        }
                        disabled={concluida}
                      />
                    }
                    label="Não avaliável"
                    slotProps={{ typography: { sx: { fontSize: 13 } } }}
                    sx={{ mt: 1 }}
                  />

                  {!concluida && (
                    <Remover
                      rotulo="Remover margem"
                      aoRemover={() => setMargens((a) => a.filter((_, j) => j !== i))}
                    />
                  )}
                </Stack>
              ))}
            </Secao>

            <Secao
              titulo="Cassetes"
              descricao="Cada cassete precisa de tecido de origem. É o primeiro elo da rastreabilidade até a lâmina."
              acao={
                !concluida && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      size="small"
                      label="Qtd."
                      value={quantidadeCassetes}
                      onChange={(e) => setQuantidadeCassetes(e.target.value)}
                      sx={{ width: 64, '& input': { textAlign: 'center' } }}
                    />
                    {/**
                      * Review: "eu pensei que ele já criasse o cassete de cada
                      * amostra... o cara tem que inserir um a um". Um clique
                      * gera N linhas com o tecido de origem herdado da amostra
                      * (editável) — quantos são, só quem cortou sabe, então a
                      * quantidade é informada, não adivinhada.
                      */}
                    <Button
                      size="small"
                      startIcon={<AddOutlined />}
                      onClick={() => {
                        const quantidade = Math.min(
                          Math.max(Math.trunc(Number(quantidadeCassetes)) || 1, 1),
                          40,
                        );
                        const tecido = amostra?.descricao?.trim() ?? '';
                        setNovosCassetes((a) => [
                          ...a,
                          ...Array.from({ length: quantidade }, () => ({
                            tecidoOrigem: tecido,
                            descricao: '',
                            exigeDescalcificacao: false,
                          })),
                        ]);
                      }}
                    >
                      Gerar cassetes
                    </Button>
                  </Stack>
                )
              }
            >
              {/**
                * Já gravados: em leitura. O identificador é definitivo e o M08
                * proíbe renumerar sem rastreabilidade — editar aqui seria
                * prometer algo que o modelo não permite.
                */}
              {ficha.cassetes.map((c) => (
                <Stack
                  key={c.id}
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 600 }}>
                    {c.identificador}
                  </Typography>
                  <Typography sx={{ fontSize: 13.5 }}>{c.tecidoOrigem}</Typography>
                  {c.descricao && (
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                      {c.descricao}
                    </Typography>
                  )}
                  {c.exigeDescalcificacao && (
                    <Chip size="small" variant="outlined" label="descalcificação" />
                  )}
                </Stack>
              ))}

              {ficha.cassetes.length === 0 && novosCassetes.length === 0 && (
                <Vazio texto="Nenhum cassete gerado." />
              )}

              {novosCassetes.length > 0 && ficha.cassetes.length > 0 && <Divider />}

              {novosCassetes.map((c, i) => (
                <Stack
                  key={i}
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <TextField
                    label="Tecido de origem"
                    value={c.tecidoOrigem}
                    onChange={(e) =>
                      setNovosCassetes((a) =>
                        a.map((x, j) => (i === j ? { ...x, tecidoOrigem: e.target.value } : x)),
                      )
                    }
                    required
                    error={c.tecidoOrigem.trim() === ''}
                    helperText={
                      c.tecidoOrigem.trim() === '' ? 'Obrigatório: sem ele o cassete não existe.' : ' '
                    }
                    sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                  />
                  <TextField
                    label="Descrição"
                    value={c.descricao}
                    onChange={(e) =>
                      setNovosCassetes((a) =>
                        a.map((x, j) => (i === j ? { ...x, descricao: e.target.value } : x)),
                      )
                    }
                    sx={{ flex: 2, width: { xs: '100%', md: 'auto' } }}
                    helperText=" "
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={c.exigeDescalcificacao}
                        onChange={(e) =>
                          setNovosCassetes((a) =>
                            a.map((x, j) =>
                              i === j ? { ...x, exigeDescalcificacao: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                    }
                    label="Descalcificação"
                    slotProps={{ typography: { sx: { fontSize: 13 } } }}
                    sx={{ mt: 1 }}
                  />

                  <Remover
                    rotulo="Remover cassete"
                    aoRemover={() => setNovosCassetes((a) => a.filter((_, j) => j !== i))}
                  />
                </Stack>
              ))}

              {novosCassetes.length > 0 && (
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                  O identificador é gerado ao salvar, na sequência do caso.
                </Typography>
              )}
            </Secao>

            {!concluida && (
              <Secao
                titulo="Descrição rápida"
                descricao="Marque os bloquinhos e componha o texto — a IA lapida quando disponível; sem ela, a frase padrão já sai pronta."
              >
                <Stack spacing={1.25}>
                  {GRUPOS_DESCRITORES_MACRO.map((grupo) => {
                    const marcados = selecoes[grupo.chave] ?? [];
                    const extras = marcados.filter((m) => !grupo.opcoes.includes(m));
                    return (
                      <Box key={grupo.chave}>
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.5 }}>
                          {grupo.rotulo}
                        </Typography>
                        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {[...grupo.opcoes, ...extras].map((opcao) => {
                            const ativo = marcados.includes(opcao);
                            return (
                              <Chip
                                key={opcao}
                                size="small"
                                label={opcao}
                                color={ativo ? 'primary' : 'default'}
                                variant={ativo ? 'filled' : 'outlined'}
                                onClick={() =>
                                  setSelecoes((a) => ({
                                    ...a,
                                    [grupo.chave]: ativo
                                      ? marcados.filter((m) => m !== opcao)
                                      : [...marcados, opcao],
                                  }))
                                }
                              />
                            );
                          })}
                          {/* "Caso não tenha, se adiciona na hora" (review). */}
                          <TextField
                            size="small"
                            variant="standard"
                            placeholder="outro…"
                            value={outroPorGrupo[grupo.chave] ?? ''}
                            onChange={(e) =>
                              setOutroPorGrupo((a) => ({ ...a, [grupo.chave]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              const texto = (outroPorGrupo[grupo.chave] ?? '').trim();
                              if (e.key === 'Enter' && texto) {
                                setSelecoes((a) => ({
                                  ...a,
                                  [grupo.chave]: [...(a[grupo.chave] ?? []), texto],
                                }));
                                setOutroPorGrupo((a) => ({ ...a, [grupo.chave]: '' }));
                              }
                            }}
                            sx={{ width: 110, '& input': { fontSize: 12.5, py: 0.4 } }}
                          />
                        </Stack>
                      </Box>
                    );
                  })}

                  <Button
                    size="small"
                    variant="contained"
                    disabled={
                      compondo ||
                      !ficha ||
                      Object.values(selecoes).every((v) => v.length === 0)
                    }
                    onClick={() => void compor()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {compondo ? 'Compondo…' : 'Compor descrição'}
                  </Button>
                </Stack>
              </Secao>
            )}

            <Secao
              titulo="Descrição macroscópica"
              descricao="Texto do profissional. Convive com os campos acima — não os resume nem os dispensa."
            >
              <TextField
                value={descricaoTexto}
                onChange={(e) => setDescricaoTexto(e.target.value)}
                multiline
                minRows={5}
                fullWidth
                disabled={concluida}
              />
            </Secao>
          </Stack>

          {bloqueioGuardian && (
            <BloqueioGuardian erro={bloqueioGuardian} acao="concluir a macroscopia" />
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
              {concluida ? 'Voltar ao dossiê' : 'Cancelar'}
            </Button>

            {!concluida && (
              <>
                <Button variant="outlined" onClick={() => void salvar()} disabled={!podeSalvar}>
                  Salvar rascunho
                </Button>
                <Tooltip
                  title={
                    exigeSupervisao
                      ? 'Perfil sob supervisão: a conclusão precisa de um responsável.'
                      : ''
                  }
                >
                  <span>
                    <Button
                      variant="contained"
                      onClick={() => void concluir()}
                      disabled={!podeSalvar || exigeSupervisao}
                    >
                      {ocupado ? 'Processando…' : 'Concluir macroscopia'}
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </Stack>

          {!concluida && cassetesIncompletos && (
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', textAlign: 'right', mt: 1 }}>
              Todo cassete precisa de tecido de origem.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
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

/** Campo numérico decimal: `inputMode` traz o teclado certo no celular. */
function Medida({
  rotulo,
  valor,
  aoMudar,
  travado,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  travado?: boolean;
}) {
  return (
    <TextField
      label={rotulo}
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      type="number"
      disabled={travado}
      sx={{ width: { xs: '100%', md: 118 } }}
      slotProps={{ htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }}
    />
  );
}

function Vazio({ texto }: { texto: string }) {
  return <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{texto}</Typography>;
}

function Remover({ rotulo, aoRemover }: { rotulo: string; aoRemover: () => void }) {
  return (
    <Tooltip title={rotulo}>
      <IconButton onClick={aoRemover} aria-label={rotulo} sx={{ mt: 0.5 }}>
        <DeleteOutline fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
