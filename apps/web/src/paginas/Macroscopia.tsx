import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
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
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { tomBloquinho } from '@lapato/design-tokens';
import {
  comporDescricaoMacro,
  GRUPOS_DESCRITORES_MACRO,
  LATERALIDADE,
  METODO_AMOSTRAGEM,
  TEXTO_TODO_MATERIAL,
  type Lateralidade,
  type MetodoAmostragem,
} from '@lapato/shared';
import { api, ErroApi, type Dossie as DadosDossie, type FichaMacroscopia } from '../api';
import { BloqueioGuardian } from './BloqueioGuardian';
import { AvisoBancadaBloqueada, impedimentoDeBancada } from './AvisoBancadaBloqueada';
import { CabecalhoDoMaterial } from './CabecalhoDoMaterial';

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
  /** Ultima frase composta: compor de novo troca esta, em vez de empilhar. */
  const [ultimaComposicao, setUltimaComposicao] = useState('');
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
    /*
      "Todo o material" é bloquinho E campo gravado da ficha: o M18 lê esse
      campo para saber se sobra remanescente para a Bioteca. Semear a marcação
      a partir do que está no banco impede que a frase composta diga uma coisa
      e o dado diga outra.
    */
    setSelecoes(dados?.materialTotalmenteIncluido ? { representacao: [TEXTO_TODO_MATERIAL] } : {});
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

  /**
   * Marca e desmarca um bloquinho. O par "todo o material" espelha o campo
   * gravado da ficha - um fato, um lugar.
   */
  function alternar(chave: string, texto: string) {
    const marcado = (selecoes[chave] ?? []).includes(texto);
    if (chave === 'representacao' && texto === TEXTO_TODO_MATERIAL) {
      setTotalmenteIncluido(!marcado);
    }
    setSelecoes((a) => {
      const atuais = a[chave] ?? [];
      return { ...a, [chave]: marcado ? atuais.filter((t) => t !== texto) : [...atuais, texto] };
    });
  }

  /**
   * A previa usa a MESMA funcao do servidor: o que aparece na tela e o que
   * seria gravado se nao houvesse IA nenhuma.
   */
  /** Só medidas produzem frase, mas não são descrição: o servidor recusa. */
  const temBloquinho = Object.values(selecoes).some((v) => v.some((t) => t.trim() !== ''));

  const previa = useMemo(
    () =>
      comporDescricaoMacro(selecoes, {
        comprimentoCm: numero(comprimento),
        larguraCm: numero(largura),
        alturaCm: numero(altura),
        pesoG: numero(peso),
      }),
    [selecoes, comprimento, largura, altura, peso],
  );

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
    /*
      Salvar antes de compor não é zelo: as medidas da frase vêm da ficha
      GRAVADA, então compor com medida recém-digitada e não salva devolveria um
      texto sem as medidas que estão na tela — o tipo de divergência silenciosa
      que ninguém percebe até o laudo sair. As marcações são congeladas porque
      recarregar a ficha limpa a seleção.
    */
    const marcadas = selecoes;
    setCompondo(true);
    setErro(null);
    try {
      if (!(await salvar())) return;
      setSelecoes(marcadas);

      const r = await api.post<{ texto: string; origem: 'ia' | 'padrao' }>(
        `/macroscopia/${ficha.id}/composicao`,
        { selecoes },
      );
      /**
       * Review: dois cliques em "Compor" deixaram a frase duas vezes no texto.
       * A composicao anterior e substituida, nao somada: o que a pessoa
       * escreveu por fora fica, o que veio dos bloquinhos e trocado.
       */
      setDescricaoTexto((atual) => {
        const base = atual.trim();
        if (!base) return r.texto;
        if (ultimaComposicao && base.includes(ultimaComposicao)) {
          return base.replace(ultimaComposicao, r.texto);
        }
        if (base.includes(r.texto)) return base;
        return `${base}\n\n${r.texto}`;
      });
      setUltimaComposicao(r.texto);
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
              lesoes: lesoes
                .filter((l) => !lesaoIntocada(l))
                .map((l) => ({
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
  const margensSemMetodo = margens.some(
    (m) => !m.naoAvaliavel && (m.metodoAmostragem === '' || m.distanciaCm.trim() === ''),
  );
  const podeSalvar = !ocupado && !cassetesIncompletos && !lesoesIncompletas && !margensIncompletas;
  /**
   * Review: "preciso lembrar de colocar uma marcação se algum dos campos que
   * é obrigatório... fica marcadinho em vermelho". Cada campo ja acende; aqui
   * a lista, no lugar onde a pessoa vai clicar em concluir.
   */
  const faltando = [
    cassetesIncompletos ? 'tecido de origem em cassete' : null,
    lesoesIncompletas ? 'rótulo de lesão' : null,
    margensIncompletas ? 'nome de margem' : null,
    margensSemMetodo ? 'método e distância de margem (ou "não avaliável")' : null,
  ].filter((f): f is string => f !== null);

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
        {/* Documento do Hugo: tudo que foi cadastrado aparece no cabeçalho, com as
            fotos e ressalvas - é o que evita troca entre pacientes homônimos. */}
        <CabecalhoDoMaterial dossie={dossie} />
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
          <AlertTitle>
            Amostra {amostra?.resultadoTriagem?.replaceAll('_', ' ')} na triagem
          </AlertTitle>
          Material com esse resultado não segue para a bancada. Resolva a pendência de triagem antes
          da macroscopia.
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
              Concluída em {new Date(ficha.concluidaEm!).toLocaleString('pt-BR')}. Alterar depois da
              conclusão exige permissão própria e passa por outra rota.
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
            {/*
              O cartão do fragmento: medidas e bloquinhos no mesmo lugar.

              Vem da bancada que o dono do produto já opera e aprovou na review
              — "gostei muito do UX/UI, quero refazer a da LAPATO assim". O que
              muda em relação àquela tela é que aqui a medida é NÚMERO, e não
              texto livre: é ela que alimenta a frase composta, o Guardian e o
              laudo. Uma caixa "Ex: 3,0 x 2,0 x 1,5 cm" seria mais bonita e
              indexaria nada.
            */}
            <Secao
              titulo="Fragmento"
              descricao="Medidas e descrição rápida. Marque os bloquinhos e componha o texto — a IA lapida quando disponível; sem ela, a frase padrão já sai pronta."
              acao={
                <Chip
                  size="small"
                  label={amostra?.identificador ?? ''}
                  sx={{ ...MONO, fontSize: 12, fontWeight: 600 }}
                />
              }
            >
              {/*
                Colunas de texto, não grade: os grupos têm alturas diferentes e
                uma grade deixaria buracos entre linhas desalinhadas.
              */}
              <Box sx={{ columnCount: { xs: 1, md: 2 }, columnGap: 3.5 }}>
                <Box sx={{ breakInside: 'avoid', mb: 2.25 }}>
                  <RotuloGrupo>Medidas do fragmento</RotuloGrupo>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Medida
                      rotulo="Compr. (cm)"
                      valor={comprimento}
                      aoMudar={setComprimento}
                      travado={concluida}
                    />
                    <Medida
                      rotulo="Largura (cm)"
                      valor={largura}
                      aoMudar={setLargura}
                      travado={concluida}
                    />
                    <Medida
                      rotulo="Altura (cm)"
                      valor={altura}
                      aoMudar={setAltura}
                      travado={concluida}
                    />
                    <Medida rotulo="Peso (g)" valor={peso} aoMudar={setPeso} travado={concluida} />
                  </Stack>
                </Box>

                {/*
                  Depois de concluída, os bloquinhos somem: eles são um atalho
                  para ESCREVER, e a marcação não é gravada - só o texto que
                  ela produziu. Mantê-los na tela, todos apagados, diria que
                  nada foi descrito quando a descrição está logo abaixo.
                */}
                {!concluida &&
                  GRUPOS_DESCRITORES_MACRO.map((grupo, iGrupo) => {
                    const marcados = selecoes[grupo.chave] ?? [];
                    const doGrupo = grupo.opcoes.map((o) => o.texto);
                    const extras = marcados.filter((m) => !doGrupo.includes(m));
                    const opcoes = [
                      ...grupo.opcoes,
                      ...extras.map((texto) => ({ rotulo: texto, texto, amostra: undefined })),
                    ];

                    return (
                      <Box key={grupo.chave} sx={{ breakInside: 'avoid', mb: 2.25 }}>
                        <RotuloGrupo>{grupo.rotulo}</RotuloGrupo>
                        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {opcoes.map((opcao, iOpcao) => (
                            <Bloquinho
                              key={opcao.texto}
                              rotulo={opcao.rotulo}
                              amostra={opcao.amostra}
                              tom={tomBloquinho[(iGrupo + iOpcao) % tomBloquinho.length]!}
                              ativo={marcados.includes(opcao.texto)}
                              travado={concluida}
                              aoAlternar={() => alternar(grupo.chave, opcao.texto)}
                            />
                          ))}

                          {/* "Caso não tenha, se adiciona na hora" (review). */}
                          {!concluida && (
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
                                  e.preventDefault();
                                  if (!marcados.includes(texto)) alternar(grupo.chave, texto);
                                  setOutroPorGrupo((a) => ({ ...a, [grupo.chave]: '' }));
                                }
                              }}
                              sx={{ width: 96, '& input': { fontSize: 12.5, py: 0.35 } }}
                            />
                          )}
                        </Stack>
                      </Box>
                    );
                  })}
              </Box>

              {/*
                Pré-visualização com a MESMA função que o servidor usa. Ver a
                frase nascer a cada bloquinho é o que torna o modo sem IA um
                caminho de primeira classe, e não um plano B (M17 §110).
              */}
              {!concluida && (
                <Box>
                  <RotuloGrupo>Prévia da frase</RotuloGrupo>
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      border: '1px dashed',
                      borderColor: 'divider',
                      bgcolor: 'action.hover',
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      color: previa ? 'text.primary' : 'text.secondary',
                      minHeight: 44,
                    }}
                  >
                    {previa || 'Marque um bloquinho para ver a frase se formar aqui.'}
                  </Box>

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ mt: 1.5, alignItems: { sm: 'center' } }}
                  >
                    <Button
                      size="small"
                      variant="contained"
                      disabled={compondo || !ficha || !temBloquinho}
                      onClick={() => void compor()}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      {compondo ? 'Compondo…' : 'Compor descrição'}
                    </Button>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                      A frase vai para a descrição macroscópica, onde continua editável.
                    </Typography>
                  </Stack>
                </Box>
              )}

              {/* M18: se nada sobra, não há o que arquivar na Bioteca. */}
              {concluida && (
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  Material totalmente incluído:{' '}
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {totalmenteIncluido ? 'sim' : 'não'}
                  </Box>
                </Typography>
              )}
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
                    error={!concluida && l.rotulo.trim() === '' && !lesaoIntocada(l)}
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
                    rotulo="Maior eixo (cm)"
                    valor={l.maiorEixoCm}
                    travado={concluida}
                    aoMudar={(v) =>
                      setLesoes((a) => a.map((x, j) => (i === j ? { ...x, maiorEixoCm: v } : x)))
                    }
                  />
                  <Medida
                    rotulo="Menor eixo (cm)"
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
                    error={!concluida && m.nome.trim() === ''}
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
                    // M13: sem o metodo, a distancia nao tem leitura na microscopia.
                    error={!concluida && !m.naoAvaliavel && m.metodoAmostragem === ''}
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
                    rotulo="Distância (cm)"
                    valor={m.distanciaCm}
                    travado={concluida || m.naoAvaliavel}
                    erro={!concluida && !m.naoAvaliavel && m.distanciaCm.trim() === ''}
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
                      c.tecidoOrigem.trim() === ''
                        ? 'Obrigatório: sem ele o cassete não existe.'
                        : ' '
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

          {!concluida && faltando.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2.5 }}>
              Falta para concluir: {faltando.join('; ')}.
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
  erro,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  travado?: boolean;
  /** Review: "fica marcadinho em vermelho" o que falta para concluir. */
  erro?: boolean;
}) {
  return (
    <TextField
      label={rotulo}
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      type="number"
      disabled={travado}
      error={erro}
      sx={{ width: { xs: '100%', md: 150 } }}
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

/** Rótulo curto e maiúsculo que abre cada grupo de bloquinhos. */
function RotuloGrupo({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      sx={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'text.secondary',
        mb: 0.85,
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * O bloquinho da descrição rápida.
 *
 * A cor é identidade visual, não significado — quem diz o que o bloquinho
 * significa é o rótulo do grupo. Por isso o estado marcado NÃO é só outro tom:
 * é preenchimento sólido mais o sinal de marcado, para não depender de cor
 * (M07, e a mesma regra dos indicadores de prazo).
 */
function Bloquinho({
  rotulo,
  amostra,
  tom,
  ativo,
  travado,
  aoAlternar,
}: {
  rotulo: string;
  amostra?: string;
  tom: { texto: string; borda: string; fundo: string; ativo: string };
  ativo: boolean;
  travado: boolean;
  aoAlternar: () => void;
}) {
  return (
    <ButtonBase
      onClick={aoAlternar}
      disabled={travado}
      aria-pressed={ativo}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.55,
        px: 1.1,
        py: 0.5,
        borderRadius: 1.5,
        border: '1px solid',
        fontSize: 12.5,
        fontWeight: 500,
        lineHeight: 1.4,
        transition: 'background-color .12s, border-color .12s',
        borderColor: ativo ? tom.ativo : tom.borda,
        color: ativo ? '#ffffff' : tom.texto,
        bgcolor: ativo ? tom.ativo : 'background.paper',
        '&:hover': { bgcolor: ativo ? tom.ativo : tom.fundo },
        '&.Mui-disabled': { opacity: 0.55 },
      }}
    >
      {amostra && (
        <Box
          aria-hidden
          sx={{
            width: 11,
            height: 11,
            borderRadius: '50%',
            bgcolor: amostra,
            border: '1px solid rgba(0,0,0,0.28)',
          }}
        />
      )}
      {ativo && <CheckOutlined sx={{ fontSize: 13.5 }} />}
      {rotulo}
    </ButtonBase>
  );
}
