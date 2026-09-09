import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { tomBloquinho } from '@lapato/design-tokens';
import {
  comporDescricaoMacro,
  formatarMedidaCm,
  GRUPOS_DESCRITORES_MACRO,
  LATERALIDADE,
  METODO_AMOSTRAGEM,
  TEXTO_TODO_MATERIAL,
  type Lateralidade,
  type MetodoAmostragem,
} from '@lapato/shared';
import {
  api,
  ErroApi,
  urlArquivo,
  type Dossie as DadosDossie,
  type FichaMacroscopia,
  type ImagemDoCaso,
  type ModeloMacroscopia,
} from '../api';
import { AjudaBiblioteca } from '../componentes/AjudaBiblioteca';
import { BloqueioGuardian } from './BloqueioGuardian';
import { AvisoBancadaBloqueada, impedimentoDeBancada } from './AvisoBancadaBloqueada';
import { CabecalhoDoMaterial } from './CabecalhoDoMaterial';
import { CapturaWebcam } from './imagens/CapturaWebcam';
import { FORMATOS_IMAGEM, enviarImagemDoCaso } from './imagens/envio';

/**
 * M08 - Macroscopia.
 *
 * "Transformar uma peca anatomica em representacao estruturada, mensuravel,
 * fotografada e amostrada."
 *
 * Decisoes desta tela que vem do modulo, e nao de gosto:
 *
 * - **Uma ficha por amostra, nao por caso.** Por isso as abas: um caso com tres
 *   amostras tem tres fichas independentes.
 * - **Varias macros por amostra** (terceira revisao com o Hugo): "vem uma
 *   cadeia mamaria e nessa peca vem cinco nodulos; so conseguimos decidir isso
 *   na macroscopia". Cada lesao e um painel com os proprios bloquinhos, texto,
 *   medidas, cassetes (com fragmentos), margem e foto; "Adicionar macro" abre
 *   outro. No fim, o resumo de cassetes e fragmentos e a descricao da amostra,
 *   montada a partir das macros.
 * - **Campos estruturados e texto livre coexistem** - "um nao substitui o
 *   outro". O texto nao e resumo dos campos nem os dispensa.
 * - **Cassete sem tecido de origem nao existe.** O Guardian barra a conclusao,
 *   e aqui o campo e obrigatorio antes disso.
 * - **Margem so quando o cadastro disse que ha** (e cobrada a parte). E a
 *   margem e de uma lesao: "dos tres nodulos, so um tem margem".
 * - **Cassetes ja gravados sao lidos, nao editados.** O identificador e
 *   definitivo (M08); so os novos sao enviados.
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
  /** Id gravado; ausente enquanto a lesao so existe na tela. */
  id?: string;
  rotulo: string;
  tipo: string;
  localizacao: string;
  lateralidade: Lateralidade;
  maiorEixoCm: string;
  menorEixoCm: string;
  terceiroEixoCm: string;
  /** Bloquinhos marcados desta macro. */
  selecoes: Record<string, string[]>;
  /** O texto desta macro - composto, de modelo ou escrito. */
  descricaoTexto: string;
  /** Ultima frase composta: compor de novo troca esta, em vez de empilhar. */
  ultimaComposicao: string;
}

interface Margem {
  nome: string;
  metodoAmostragem: MetodoAmostragem | '';
  distanciaCm: string;
  naoAvaliavel: boolean;
  /** De qual lesao; vazio = da peca. */
  lesaoRotulo: string;
}

interface CasseteNovo {
  tecidoOrigem: string;
  descricao: string;
  exigeDescalcificacao: boolean;
  /** Terceira revisao: quantos fragmentos foram para este cassete. */
  fragmentos: string;
  /** De qual lesao; vazio = da peca. */
  lesaoRotulo: string;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const numero = (v: string) => (v.trim() === '' ? undefined : Number(v));

interface Props {
  /** M08: residente e técnico em treinamento executam, mas não concluem. */
  exigeSupervisao: boolean;
  /** M21: o botao "Consultar Biblioteca" so aparece para quem le a Biblioteca. */
  permissoes: string[];
}

const LESAO_VAZIA = (rotulo: string): Lesao => ({
  rotulo,
  tipo: '',
  localizacao: '',
  lateralidade: 'nao_aplicavel' as Lateralidade,
  maiorEixoCm: '',
  menorEixoCm: '',
  terceiroEixoCm: '',
  selecoes: {},
  descricaoTexto: '',
  ultimaComposicao: '',
});

/** Linha que so tem o rotulo automatico: apresentada, mas nunca preenchida. */
const lesaoIntocada = (l: Lesao) =>
  l.tipo.trim() === '' &&
  l.localizacao.trim() === '' &&
  l.lateralidade === 'nao_aplicavel' &&
  l.maiorEixoCm === '' &&
  l.menorEixoCm === '' &&
  l.terceiroEixoCm === '' &&
  l.descricaoTexto.trim() === '' &&
  Object.values(l.selecoes).every((v) => v.length === 0);

const proximoRotuloDe = (lesoes: Lesao[]) => {
  const usados = new Set(lesoes.map((l) => l.rotulo));
  let n = lesoes.length + 1;
  while (usados.has(`L${String(n).padStart(2, '0')}`)) n++;
  return `L${String(n).padStart(2, '0')}`;
};

/** As lacunas do modelo viram o que foi medido; o que nao foi medido fica como lacuna visivel. */
function preencherModelo(
  texto: string,
  medidas: { peca: string | null; lesao: string | null; peso: string | null },
): string {
  return texto
    .replaceAll('{peca}', medidas.peca ?? '___ cm')
    .replaceAll('{lesao}', medidas.lesao ?? '___ cm')
    .replaceAll('{peso}', medidas.peso ?? '___ g');
}

export function Macroscopia({ exigeSupervisao, permissoes }: Props) {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();

  const [dossie, setDossie] = useState<DadosDossie | null>(null);
  const [amostraId, setAmostraId] = useState('');
  const [ficha, setFicha] = useState<FichaMacroscopia | null>(null);
  const [carregandoFicha, setCarregandoFicha] = useState(false);

  const [descricaoTexto, setDescricaoTexto] = useState('');
  const [comprimento, setComprimento] = useState('');
  const [largura, setLargura] = useState('');
  const [altura, setAltura] = useState('');
  const [peso, setPeso] = useState('');
  const [totalmenteIncluido, setTotalmenteIncluido] = useState(false);
  const [lesoes, setLesoes] = useState<Lesao[]>([]);
  const [outroPorGrupo, setOutroPorGrupo] = useState<Record<string, string>>({});
  const [compondoEm, setCompondoEm] = useState<number | null>(null);
  const [margens, setMargens] = useState<Margem[]>([]);
  const [novosCassetes, setNovosCassetes] = useState<CasseteNovo[]>([]);
  const [quantidadePorLesao, setQuantidadePorLesao] = useState<Record<string, string>>({});
  const [modelos, setModelos] = useState<ModeloMacroscopia[]>([]);
  const [imagens, setImagens] = useState<ImagemDoCaso[]>([]);
  const [cameraPara, setCameraPara] = useState<number | null>(null);
  const [fotoPara, setFotoPara] = useState<number | null>(null);
  const entradaFoto = useRef<HTMLInputElement>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [bloqueioGuardian, setBloqueioGuardian] = useState<ErroApi | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregarImagens = useCallback(() => {
    if (!id) return;
    api
      .get<ImagemDoCaso[]>(`/imagens/casos/${id}`)
      .then(setImagens)
      .catch(() => setImagens([]));
  }, [id]);

  useEffect(() => {
    if (id) {
      api
        .get<DadosDossie>(`/casos/${id}`)
        .then((d) => {
          setDossie(d);
          setAmostraId((atual) => atual || (d.amostras[0]?.id ?? ''));
        })
        .catch(() => setErro('Não foi possível carregar o caso.'));
      recarregarImagens();
    }
    api
      .get<ModeloMacroscopia[]>('/catalogo/modelos-macroscopia')
      .then(setModelos)
      .catch(() => setModelos([]));
  }, [id, recarregarImagens]);

  /** Preenche o formulário a partir do que já está gravado. */
  const carregar = useCallback((dados: FichaMacroscopia | null) => {
    setFicha(dados);
    setDescricaoTexto(dados?.descricaoTexto ?? '');
    setOutroPorGrupo({});
    setComprimento(dados?.comprimentoCm ?? '');
    setLargura(dados?.larguraCm ?? '');
    setAltura(dados?.alturaCm ?? '');
    setPeso(dados?.pesoG ?? '');
    setTotalmenteIncluido(dados?.materialTotalmenteIncluido ?? false);
    const lesoesGravadas: Lesao[] = (dados?.lesoes ?? []).map((l) => ({
      id: l.id,
      rotulo: l.rotulo,
      tipo: l.tipo ?? '',
      localizacao: l.localizacao ?? '',
      lateralidade: (l.lateralidade as Lateralidade) ?? 'nao_aplicavel',
      maiorEixoCm: l.maiorEixoCm ?? '',
      menorEixoCm: l.menorEixoCm ?? '',
      terceiroEixoCm: l.terceiroEixoCm ?? '',
      selecoes: Object.fromEntries(
        Object.entries(l.caracteristicas ?? {}).filter(([, v]) => Array.isArray(v)),
      ) as Record<string, string[]>,
      descricaoTexto: l.descricaoTexto ?? '',
      ultimaComposicao: '',
    }));
    /**
     * Ficha aberta sem lesao ja apresenta um painel pronto: na review, o botao
     * "Adicionar" escondido a direita passou despercebido. O painel intocado e
     * descartado no salvar.
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
        lesaoRotulo: m.lesaoRotulo ?? '',
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
  /** Terceira revisão: a margem é decidida no cadastro; sem ela, a seção não oferece nada. */
  const comMargem = (amostra?.margemCirurgica ?? 'sem_margem') !== 'sem_margem';

  /** M06 -> M08: material bloqueado ou recusado não chega à bancada. */
  const travadaNaTriagem =
    amostra?.resultadoTriagem === 'bloqueado' || amostra?.resultadoTriagem === 'recusado';

  const concluida = ficha?.concluidaEm != null;

  const medidaPeca = formatarMedidaCm([numero(comprimento), numero(largura), numero(altura)]);

  function mudarLesao(i: number, mudanca: Partial<Lesao>) {
    setLesoes((a) => a.map((x, j) => (i === j ? { ...x, ...mudanca } : x)));
  }

  /**
   * Marca e desmarca um bloquinho de uma macro. O par "todo o material"
   * espelha o campo gravado da ficha - um fato, um lugar.
   */
  function alternar(i: number, chave: string, texto: string) {
    const lesao = lesoes[i];
    if (!lesao) return;
    const marcado = (lesao.selecoes[chave] ?? []).includes(texto);
    if (chave === 'representacao' && texto === TEXTO_TODO_MATERIAL) {
      setTotalmenteIncluido(!marcado);
    }
    const atuais = lesao.selecoes[chave] ?? [];
    mudarLesao(i, {
      selecoes: {
        ...lesao.selecoes,
        [chave]: marcado ? atuais.filter((t) => t !== texto) : [...atuais, texto],
      },
    });
  }

  /** A previa usa a MESMA funcao do servidor, com as medidas DA LESAO. */
  const previaDe = (l: Lesao) =>
    comporDescricaoMacro(l.selecoes, {
      comprimentoCm: numero(l.maiorEixoCm),
      larguraCm: numero(l.menorEixoCm),
      alturaCm: numero(l.terceiroEixoCm),
    });

  const temBloquinho = (l: Lesao) =>
    Object.values(l.selecoes).some((v) => v.some((t) => t.trim() !== ''));

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

  /** O que a tela tem, no formato que a API grava. */
  function montarPayload() {
    const vivas = lesoes.filter((l) => !lesaoIntocada(l));
    return {
      ...(descricaoTexto.trim() ? { descricaoTexto: descricaoTexto.trim() } : {}),
      ...(numero(comprimento) ? { comprimentoCm: numero(comprimento) } : {}),
      ...(numero(largura) ? { larguraCm: numero(largura) } : {}),
      ...(numero(altura) ? { alturaCm: numero(altura) } : {}),
      ...(numero(peso) ? { pesoG: numero(peso) } : {}),
      materialTotalmenteIncluido: totalmenteIncluido,
      ...(vivas.length > 0
        ? {
            lesoes: vivas.map((l) => ({
              rotulo: l.rotulo.trim(),
              ...(l.tipo.trim() ? { tipo: l.tipo.trim() } : {}),
              ...(l.localizacao.trim() ? { localizacao: l.localizacao.trim() } : {}),
              lateralidade: l.lateralidade,
              ...(numero(l.maiorEixoCm) ? { maiorEixoCm: numero(l.maiorEixoCm) } : {}),
              ...(numero(l.menorEixoCm) ? { menorEixoCm: numero(l.menorEixoCm) } : {}),
              ...(numero(l.terceiroEixoCm) ? { terceiroEixoCm: numero(l.terceiroEixoCm) } : {}),
              caracteristicas: l.selecoes,
              descricaoTexto: l.descricaoTexto.trim() || null,
            })),
          }
        : {}),
      ...(margens.length > 0
        ? {
            margens: margens.map((m) => ({
              nome: m.nome,
              ...(m.metodoAmostragem ? { metodoAmostragem: m.metodoAmostragem } : {}),
              ...(numero(m.distanciaCm) !== undefined ? { distanciaCm: numero(m.distanciaCm) } : {}),
              naoAvaliavel: m.naoAvaliavel,
              lesaoRotulo: m.lesaoRotulo || null,
            })),
          }
        : {}),
      // Só os novos: os já gravados têm identificador definitivo.
      ...(novosCassetes.length > 0
        ? {
            cassetes: novosCassetes.map((c) => ({
              tecidoOrigem: c.tecidoOrigem.trim(),
              ...(c.descricao.trim() ? { descricao: c.descricao.trim() } : {}),
              exigeDescalcificacao: c.exigeDescalcificacao,
              ...(numero(c.fragmentos) !== undefined ? { fragmentos: numero(c.fragmentos) } : {}),
              lesaoRotulo: c.lesaoRotulo || null,
            })),
          }
        : {}),
    };
  }

  async function salvar(silencioso = false): Promise<FichaMacroscopia | null> {
    if (!ficha) return null;
    setOcupado(true);
    setErro(null);
    if (!silencioso) setAviso(null);
    // As marcacoes e os textos das macros sao preservados: recarregar a ficha
    // devolve o que foi gravado, que e o que esta na tela.
    try {
      await api.post(`/macroscopia/${ficha.id}`, montarPayload());
      const nova = await api.get<FichaMacroscopia | null>(`/macroscopia/amostras/${amostraId}`);
      carregar(nova);
      if (!silencioso) setAviso('Rascunho salvo.');
      return nova;
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar a macroscopia.');
      return null;
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Compoe o texto de UMA macro no servidor: a base deterministica sempre
   * responde; o Copiloto lapida quando ha provedor. O resultado entra no
   * texto da macro, editavel - quem assina e o profissional, nao o compositor.
   * Salva antes, porque as medidas da frase vem da ficha GRAVADA.
   */
  async function compor(i: number) {
    const lesao = lesoes[i];
    if (!ficha || !lesao) return;
    const marcadas = lesao.selecoes;
    const rotulo = lesao.rotulo.trim();
    setCompondoEm(i);
    setErro(null);
    try {
      const salva = await salvar(true);
      if (!salva) return;
      const r = await api.post<{ texto: string; origem: 'ia' | 'padrao' }>(
        `/macroscopia/${ficha.id}/composicao`,
        { selecoes: marcadas, lesaoRotulo: rotulo },
      );
      setLesoes((a) =>
        a.map((x) => {
          if (x.rotulo !== rotulo) return x;
          const base = x.descricaoTexto.trim();
          let texto: string;
          if (!base) texto = r.texto;
          else if (x.ultimaComposicao && base.includes(x.ultimaComposicao))
            texto = base.replace(x.ultimaComposicao, r.texto);
          else if (base.includes(r.texto)) texto = base;
          else texto = `${base}\n\n${r.texto}`;
          return { ...x, selecoes: marcadas, descricaoTexto: texto, ultimaComposicao: r.texto };
        }),
      );
      if (r.origem === 'padrao') {
        setAviso('Texto composto no modo padrão (IA indisponível) — revise e ajuste à vontade.');
      }
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível compor a descrição.');
    } finally {
      setCompondoEm(null);
    }
  }

  /** O modelo pronto entra no texto da macro com as lacunas preenchidas. */
  function aplicarModelo(i: number, modeloId: string) {
    const modelo = modelos.find((m) => m.id === modeloId);
    const lesao = lesoes[i];
    if (!modelo || !lesao) return;
    const texto = preencherModelo(modelo.texto, {
      peca: medidaPeca,
      lesao: formatarMedidaCm([numero(lesao.maiorEixoCm), numero(lesao.menorEixoCm), numero(lesao.terceiroEixoCm)]),
      peso: numero(peso) ? `${peso} g` : null,
    });
    const base = lesao.descricaoTexto.trim();
    mudarLesao(i, {
      descricaoTexto: base ? `${base}\n\n${texto}` : texto,
      ...(lesao.tipo.trim() ? {} : { tipo: modelo.titulo }),
    });
  }

  /** A descricao da amostra, montada a partir das macros - e editavel depois. */
  function montarDescricao() {
    const partes = lesoes
      .filter((l) => l.descricaoTexto.trim())
      .map((l) => {
        const cabeca = [l.rotulo.trim(), l.tipo.trim()].filter(Boolean).join(' — ');
        return lesoes.length > 1 ? `${cabeca}: ${l.descricaoTexto.trim()}` : l.descricaoTexto.trim();
      });
    if (partes.length === 0) return;
    setDescricaoTexto(partes.join('\n\n'));
  }

  async function concluir() {
    // Concluir sem salvar antes descartaria o que está na tela.
    if (!(await salvar(true))) return;
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

  /**
   * Foto de uma lesao (terceira revisao: "ela precisa documentar cada lesao").
   * Vai para o acervo do caso (M16) apontando para a lesao; se a lesao ainda
   * nao foi gravada, salva antes para ter o id.
   */
  async function enviarFoto(i: number, arquivo: File) {
    if (!id) return;
    const rotulo = lesoes[i]?.rotulo.trim();
    if (!rotulo) return;
    setOcupado(true);
    setErro(null);
    try {
      let lesaoId = ficha?.lesoes.find((l) => l.rotulo === rotulo)?.id;
      if (!lesaoId) {
        const salva = await salvar(true);
        lesaoId = salva?.lesoes.find((l) => l.rotulo === rotulo)?.id;
      }
      if (!lesaoId) throw new Error('Preencha a macro antes de fotografar.');
      await enviarImagemDoCaso(id, arquivo, 'macroscopia', 'M08_MACROSCOPIA', {
        objetoTipo: 'lesao_macroscopica',
        objetoId: lesaoId,
      });
      recarregarImagens();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : err instanceof Error ? err.message : 'Não foi possível enviar a foto.');
    } finally {
      setOcupado(false);
    }
  }

  function gerarCassetes(lesaoRotulo: string, tecidoPadrao: string) {
    const chave = lesaoRotulo || '_peca';
    const quantidade = Math.min(Math.max(Math.trunc(Number(quantidadePorLesao[chave] ?? '1')) || 1, 1), 40);
    setNovosCassetes((a) => [
      ...a,
      ...Array.from({ length: quantidade }, () => ({
        tecidoOrigem: tecidoPadrao,
        descricao: '',
        exigeDescalcificacao: false,
        fragmentos: '',
        lesaoRotulo,
      })),
    ]);
  }

  const cassetesIncompletos = novosCassetes.some((c) => c.tecidoOrigem.trim() === '');
  const lesoesIncompletas = lesoes.some((l) => l.rotulo.trim() === '' && !lesaoIntocada(l));
  const rotulosRepetidos = new Set(lesoes.map((l) => l.rotulo.trim())).size !== lesoes.length;
  const margensIncompletas = margens.some((m) => m.nome.trim() === '');
  const margensSemMetodo = margens.some(
    (m) => !m.naoAvaliavel && (m.metodoAmostragem === '' || m.distanciaCm.trim() === ''),
  );
  const podeSalvar =
    !ocupado && !cassetesIncompletos && !lesoesIncompletas && !rotulosRepetidos && !margensIncompletas;
  /**
   * Review: "preciso lembrar de colocar uma marcação se algum dos campos que
   * é obrigatório... fica marcadinho em vermelho". Cada campo ja acende; aqui
   * a lista, no lugar onde a pessoa vai clicar em concluir.
   */
  const faltando = [
    cassetesIncompletos ? 'tecido de origem em cassete' : null,
    lesoesIncompletas ? 'rótulo de lesão' : null,
    rotulosRepetidos ? 'rótulos de lesão repetidos' : null,
    margensIncompletas ? 'nome de margem' : null,
    margensSemMetodo ? 'método e distância de margem (ou "não avaliável")' : null,
  ].filter((f): f is string => f !== null);

  /** Resumo (terceira revisão): quantos cassetes e fragmentos, e de qual lesão. */
  const resumoCassetes = useMemo(() => {
    const gravados = (ficha?.cassetes ?? []).map((c) => ({
      identificador: c.identificador.slice(c.identificador.lastIndexOf('-') + 1),
      fragmentos: c.fragmentos,
      lesaoRotulo: c.lesaoRotulo ?? '',
      novo: false,
    }));
    const novos = novosCassetes.map((c, i) => ({
      identificador: `novo ${i + 1}`,
      fragmentos: numero(c.fragmentos) ?? null,
      lesaoRotulo: c.lesaoRotulo,
      novo: true,
    }));
    const todos = [...gravados, ...novos];
    const fragmentos = todos.reduce((t, c) => t + (c.fragmentos ?? 0), 0);
    return { todos, total: todos.length, fragmentos, semContagem: todos.some((c) => c.fragmentos == null) };
  }, [ficha, novosCassetes]);

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

  const tecidoPadrao = amostra?.descricao?.trim() ?? '';

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Stack direction="row" sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h2">Macroscopia</Typography>
        <AjudaBiblioteca contexto="macroscopia" permissoes={permissoes} />
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Uma ficha por amostra; dentro dela, uma macro por lesão. Campos estruturados e texto livre
        convivem — um não substitui o outro.
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
        <CabecalhoDoMaterial
          dossie={dossie}
          podeCorrigir={permissoes.includes('caso:corrigir_identificacao')}
          aoMudar={() => api.get<DadosDossie>(`/casos/${id}`).then(setDossie)}
        />
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
            {/* A peça inteira: o que chegou no pote. As lesões vêm abaixo, cada uma com a sua macro. */}
            <Secao
              titulo="Peça"
              descricao="O que veio no pote, medido antes de cortar. A medida é número: alimenta a frase, o Guardian e o laudo."
              acao={
                <Chip
                  size="small"
                  label={amostra?.identificador ?? ''}
                  sx={{ ...MONO, fontSize: 12, fontWeight: 600 }}
                />
              }
            >
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Medida rotulo="Compr. (cm)" valor={comprimento} aoMudar={setComprimento} travado={concluida} />
                <Medida rotulo="Largura (cm)" valor={largura} aoMudar={setLargura} travado={concluida} />
                <Medida rotulo="Altura (cm)" valor={altura} aoMudar={setAltura} travado={concluida} />
                <Medida rotulo="Peso (g)" valor={peso} aoMudar={setPeso} travado={concluida} />
                {medidaPeca && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    Sai como <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{medidaPeca}</Box>
                  </Typography>
                )}
              </Stack>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={totalmenteIncluido}
                    onChange={(e) => setTotalmenteIncluido(e.target.checked)}
                    disabled={concluida}
                  />
                }
                label="Todo o material foi incluído (nada sobra para a Bioteca)"
                slotProps={{ typography: { sx: { fontSize: 13 } } }}
              />
            </Secao>

            {lesoes.map((l, i) => {
              const rotulo = l.rotulo.trim();
              const previa = previaDe(l);
              const cassetesGravados = ficha.cassetes.filter((c) => (c.lesaoRotulo ?? '') === rotulo && rotulo !== '');
              const fotos = l.id ? imagens.filter((img) => img.objetoId === l.id) : [];
              const chaveQtd = rotulo || '_peca';
              return (
                <Secao
                  key={i}
                  titulo={`Macro ${i + 1}${rotulo ? ` · ${rotulo}` : ''}${l.tipo.trim() ? ` — ${l.tipo.trim()}` : ''}`}
                  descricao={
                    i === 0 && lesoes.length === 1
                      ? 'Uma lesão, uma macro. Se a peça tem mais de uma, "Adicionar macro" abre outro painel com cassetes, margem e foto próprios.'
                      : undefined
                  }
                  acao={
                    !concluida && (
                      <Remover
                        rotulo="Remover esta macro"
                        aoRemover={() => {
                          setLesoes((a) => a.filter((_, j) => j !== i));
                          setNovosCassetes((a) => a.filter((c) => c.lesaoRotulo !== rotulo));
                          setMargens((a) => a.filter((m) => m.lesaoRotulo !== rotulo));
                        }}
                      />
                    )
                  }
                >
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
                    <TextField
                      label="Rótulo"
                      value={l.rotulo}
                      onChange={(e) => {
                        const novo = e.target.value;
                        // Cassetes e margens novos seguem o rótulo.
                        setNovosCassetes((a) => a.map((c) => (c.lesaoRotulo === rotulo ? { ...c, lesaoRotulo: novo.trim() } : c)));
                        setMargens((a) => a.map((m) => (m.lesaoRotulo === rotulo ? { ...m, lesaoRotulo: novo.trim() } : m)));
                        mudarLesao(i, { rotulo: novo });
                      }}
                      required
                      error={!concluida && ((l.rotulo.trim() === '' && !lesaoIntocada(l)) || rotulosRepetidos)}
                      disabled={concluida || Boolean(l.id)}
                      helperText={l.id ? 'Gravado' : ' '}
                      sx={{ width: { xs: '100%', md: 100 }, ...MONO }}
                    />
                    <TextField
                      label="Tipo"
                      value={l.tipo}
                      onChange={(e) => mudarLesao(i, { tipo: e.target.value })}
                      disabled={concluida}
                      helperText=" "
                      sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                    />
                    <TextField
                      label="Localização"
                      value={l.localizacao}
                      onChange={(e) => mudarLesao(i, { localizacao: e.target.value })}
                      disabled={concluida}
                      helperText=" "
                      sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
                    />
                    <TextField
                      select
                      label="Lateralidade"
                      value={l.lateralidade}
                      onChange={(e) => mudarLesao(i, { lateralidade: e.target.value as Lateralidade })}
                      disabled={concluida}
                      helperText=" "
                      sx={{ minWidth: 150, width: { xs: '100%', md: 'auto' } }}
                    >
                      {LATERALIDADE.map((v) => (
                        <MenuItem key={v} value={v}>
                          {LATERALIDADE_LABEL[v]}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>

                  <Box>
                    <RotuloGrupo>Medidas da lesão</RotuloGrupo>
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <Medida rotulo="Maior eixo (cm)" valor={l.maiorEixoCm} travado={concluida} aoMudar={(v) => mudarLesao(i, { maiorEixoCm: v })} />
                      <Medida rotulo="Menor eixo (cm)" valor={l.menorEixoCm} travado={concluida} aoMudar={(v) => mudarLesao(i, { menorEixoCm: v })} />
                      <Medida rotulo="Terceiro eixo (cm)" valor={l.terceiroEixoCm} travado={concluida} aoMudar={(v) => mudarLesao(i, { terceiroEixoCm: v })} />
                      {formatarMedidaCm([numero(l.maiorEixoCm), numero(l.menorEixoCm), numero(l.terceiroEixoCm)]) && (
                        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                          Sai como{' '}
                          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                            {formatarMedidaCm([numero(l.maiorEixoCm), numero(l.menorEixoCm), numero(l.terceiroEixoCm)])}
                          </Box>
                        </Typography>
                      )}
                    </Stack>
                  </Box>

                  {/*
                    Depois de concluída, os bloquinhos somem: são um atalho para
                    ESCREVER; o que fica é o texto que eles produziram.
                  */}
                  {!concluida && (
                    <Box sx={{ columnCount: { xs: 1, md: 2 }, columnGap: 3.5 }}>
                      {GRUPOS_DESCRITORES_MACRO.map((grupo, iGrupo) => {
                        const marcados = l.selecoes[grupo.chave] ?? [];
                        const doGrupo = grupo.opcoes.map((o) => o.texto);
                        const extras = marcados.filter((m) => !doGrupo.includes(m));
                        const opcoes = [
                          ...grupo.opcoes,
                          ...extras.map((texto) => ({ rotulo: texto, texto, amostra: undefined })),
                        ];
                        const chaveOutro = `${i}:${grupo.chave}`;
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
                                  aoAlternar={() => alternar(i, grupo.chave, opcao.texto)}
                                />
                              ))}
                              {/* "Caso não tenha, se adiciona na hora" (review). */}
                              <TextField
                                size="small"
                                variant="standard"
                                placeholder="outro…"
                                value={outroPorGrupo[chaveOutro] ?? ''}
                                onChange={(e) => setOutroPorGrupo((a) => ({ ...a, [chaveOutro]: e.target.value }))}
                                onKeyDown={(e) => {
                                  const texto = (outroPorGrupo[chaveOutro] ?? '').trim();
                                  if (e.key === 'Enter' && texto) {
                                    e.preventDefault();
                                    if (!marcados.includes(texto)) alternar(i, grupo.chave, texto);
                                    setOutroPorGrupo((a) => ({ ...a, [chaveOutro]: '' }));
                                  }
                                }}
                                sx={{ width: 96, '& input': { fontSize: 12.5, py: 0.35 } }}
                              />
                            </Stack>
                          </Box>
                        );
                      })}
                    </Box>
                  )}

                  {/* Pré-visualização com a MESMA função que o servidor usa (M17 §110). */}
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
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5, alignItems: { sm: 'center' } }}>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={compondoEm !== null || ocupado || !temBloquinho(l) || rotulo === ''}
                          onClick={() => void compor(i)}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          {compondoEm === i ? 'Compondo…' : 'Compor descrição'}
                        </Button>
                        {modelos.length > 0 && (
                          <TextField
                            select
                            size="small"
                            label="Modelo pronto"
                            value=""
                            onChange={(e) => aplicarModelo(i, e.target.value)}
                            sx={{ minWidth: 260 }}
                            helperText="Entra no texto com as medidas preenchidas."
                          >
                            {modelos.map((m) => (
                              <MenuItem key={m.id} value={m.id}>
                                {m.orgao} · {m.titulo}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                          A frase vai para o texto desta macro, onde continua editável.
                        </Typography>
                      </Stack>
                    </Box>
                  )}

                  <TextField
                    label="Texto desta macro"
                    value={l.descricaoTexto}
                    onChange={(e) => mudarLesao(i, { descricaoTexto: e.target.value })}
                    multiline
                    minRows={3}
                    fullWidth
                    disabled={concluida}
                  />

                  {/* Cassetes desta lesão: "AB107 M1 tem dois fragmentos" */}
                  <Box>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                      <RotuloGrupo>Cassetes desta lesão</RotuloGrupo>
                      {!concluida && (
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <TextField
                            size="small"
                            label="Qtd."
                            value={quantidadePorLesao[chaveQtd] ?? '1'}
                            onChange={(e) => setQuantidadePorLesao((a) => ({ ...a, [chaveQtd]: e.target.value }))}
                            sx={{ width: 64, '& input': { textAlign: 'center' } }}
                          />
                          <Button
                            size="small"
                            startIcon={<AddOutlined />}
                            disabled={rotulo === ''}
                            onClick={() => gerarCassetes(rotulo, l.tipo.trim() || tecidoPadrao)}
                          >
                            Gerar cassetes
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                    <Stack spacing={1.5}>
                      {cassetesGravados.map((c) => (
                        <LinhaCasseteGravado key={c.id} cassete={c} />
                      ))}
                      {novosCassetes.map((c, k) =>
                        c.lesaoRotulo === rotulo && rotulo !== '' ? (
                          <LinhaCasseteNovo key={k} cassete={c} indice={k} aoMudar={setNovosCassetes} />
                        ) : null,
                      )}
                      {cassetesGravados.length === 0 && !novosCassetes.some((c) => c.lesaoRotulo === rotulo && rotulo !== '') && (
                        <Vazio texto="Nenhum cassete desta lesão." />
                      )}
                    </Stack>
                  </Box>

                  {/* Margem desta lesão: só quando o cadastro disse que há margem. */}
                  {comMargem && (
                    <Box>
                      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                        <RotuloGrupo>Margem desta lesão</RotuloGrupo>
                        {!concluida && (
                          <Button
                            size="small"
                            startIcon={<AddOutlined />}
                            disabled={rotulo === ''}
                            onClick={() =>
                              setMargens((a) => [
                                ...a,
                                { nome: '', metodoAmostragem: '', distanciaCm: '', naoAvaliavel: false, lesaoRotulo: rotulo },
                              ])
                            }
                          >
                            Adicionar margem
                          </Button>
                        )}
                      </Stack>
                      <Stack spacing={1.5}>
                        {margens.map((m, k) =>
                          m.lesaoRotulo === rotulo && rotulo !== '' ? (
                            <LinhaMargem key={k} margem={m} indice={k} concluida={concluida} aoMudar={setMargens} />
                          ) : null,
                        )}
                        {!margens.some((m) => m.lesaoRotulo === rotulo && rotulo !== '') && (
                          <Vazio texto="Sem margem avaliada nesta lesão. Nem toda lesão tem: só a que veio com margem pedida." />
                        )}
                      </Stack>
                    </Box>
                  )}

                  {/* Foto desta lesão (M16, apontando para a lesão). */}
                  <Box>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                      <RotuloGrupo>Foto desta lesão</RotuloGrupo>
                      {!concluida && (
                        <Stack direction="row" spacing={1}>
                          <Button size="small" startIcon={<PhotoCameraOutlined />} disabled={ocupado || rotulo === ''} onClick={() => setCameraPara(i)}>
                            Tirar foto
                          </Button>
                          <Button
                            size="small"
                            startIcon={<AddPhotoAlternateOutlined />}
                            disabled={ocupado || rotulo === ''}
                            onClick={() => {
                              setFotoPara(i);
                              entradaFoto.current?.click();
                            }}
                          >
                            Enviar imagem
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                    {fotos.length === 0 ? (
                      <Vazio texto="Nenhuma foto desta lesão." />
                    ) : (
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {fotos.map((f) => (
                          <Box
                            key={f.id}
                            component="img"
                            src={urlArquivo(`/imagens/${f.id}/arquivo?tamanho=miniatura`)}
                            alt={f.legenda ?? `Foto ${rotulo}`}
                            sx={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                          />
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Secao>
              );
            })}

            {!concluida && (
              <Box>
                <Button
                  variant="outlined"
                  startIcon={<AddOutlined />}
                  onClick={() => setLesoes((a) => [...a, LESAO_VAZIA(proximoRotuloDe(a))])}
                >
                  Adicionar macro
                </Button>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                  Outra lesão na mesma peça — com descrição, cassetes, margem e foto próprios.
                </Typography>
              </Box>
            )}

            {/* Cassetes e margens da peça, fora de uma lesão (fichas antigas ou peça sem lesão). */}
            {(ficha.cassetes.some((c) => !c.lesaoRotulo) ||
              novosCassetes.some((c) => c.lesaoRotulo === '') ||
              lesoes.every((l) => lesaoIntocada(l))) && (
              <Secao
                titulo="Cassetes da peça"
                descricao="Cassetes que não são de uma lesão específica. Cada um precisa de tecido de origem — é o primeiro elo da rastreabilidade até a lâmina."
                acao={
                  !concluida && (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="Qtd."
                        value={quantidadePorLesao._peca ?? '1'}
                        onChange={(e) => setQuantidadePorLesao((a) => ({ ...a, _peca: e.target.value }))}
                        sx={{ width: 64, '& input': { textAlign: 'center' } }}
                      />
                      <Button size="small" startIcon={<AddOutlined />} onClick={() => gerarCassetes('', tecidoPadrao)}>
                        Gerar cassetes
                      </Button>
                    </Stack>
                  )
                }
              >
                {ficha.cassetes.filter((c) => !c.lesaoRotulo).map((c) => (
                  <LinhaCasseteGravado key={c.id} cassete={c} />
                ))}
                {novosCassetes.map((c, k) =>
                  c.lesaoRotulo === '' ? <LinhaCasseteNovo key={k} cassete={c} indice={k} aoMudar={setNovosCassetes} /> : null,
                )}
                {!ficha.cassetes.some((c) => !c.lesaoRotulo) && !novosCassetes.some((c) => c.lesaoRotulo === '') && (
                  <Vazio texto="Nenhum cassete da peça." />
                )}
              </Secao>
            )}

            {margens.some((m) => m.lesaoRotulo === '') && (
              <Secao titulo="Margens da peça" descricao="Margens registradas sem lesão específica.">
                {margens.map((m, k) =>
                  m.lesaoRotulo === '' ? <LinhaMargem key={k} margem={m} indice={k} concluida={concluida} aoMudar={setMargens} /> : null,
                )}
              </Secao>
            )}

            {/* Resumo (terceira revisão): "nessa OS eu tenho três cassetes com dez fragmentos". */}
            <Secao
              titulo="Resumo dos cassetes"
              descricao="O que vai para o processamento e o que quem lê a lâmina vai conferir. Não entra no laudo."
            >
              {resumoCassetes.total === 0 ? (
                <Vazio texto="Nenhum cassete ainda." />
              ) : (
                <>
                  <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Cassetes</Typography>
                      <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{resumoCassetes.total}</Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Fragmentos</Typography>
                      <Typography sx={{ fontSize: 20, fontWeight: 700 }}>
                        {resumoCassetes.fragmentos}
                        {resumoCassetes.semContagem ? '+' : ''}
                      </Typography>
                      {resumoCassetes.semContagem && (
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>há cassete sem contagem</Typography>
                      )}
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {resumoCassetes.todos.map((c, k) => (
                      <Chip
                        key={k}
                        size="small"
                        variant={c.novo ? 'outlined' : 'filled'}
                        label={`${c.identificador}${c.fragmentos != null ? ` (${c.fragmentos})` : ''}${c.lesaoRotulo ? ` · ${c.lesaoRotulo}` : ''}`}
                        sx={{ ...MONO, fontSize: 11.5 }}
                      />
                    ))}
                  </Stack>
                </>
              )}
            </Secao>

            <Secao
              titulo="Descrição macroscópica"
              descricao="O texto da amostra — o que vai para o laudo. Monte a partir das macros e ajuste; convive com os campos acima, não os resume nem os dispensa."
              acao={
                !concluida && (
                  <Button size="small" onClick={montarDescricao} disabled={!lesoes.some((l) => l.descricaoTexto.trim())}>
                    Montar a partir das macros
                  </Button>
                )
              }
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

          <input
            ref={entradaFoto}
            type="file"
            accept={FORMATOS_IMAGEM.join(',')}
            hidden
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo && fotoPara !== null) void enviarFoto(fotoPara, arquivo);
              e.target.value = '';
            }}
          />
          <CapturaWebcam
            aberto={cameraPara !== null}
            aoFechar={() => setCameraPara(null)}
            aoCapturar={(arquivo) => {
              const alvo = cameraPara;
              setCameraPara(null);
              if (alvo !== null) void enviarFoto(alvo, arquivo);
            }}
          />

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

/** Já gravado: em leitura. O identificador é definitivo (M08). */
function LinhaCasseteGravado({ cassete }: { cassete: FichaMacroscopia['cassetes'][number] }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip size="small" label={cassete.identificador} sx={{ ...MONO, fontSize: 12 }} />
      <Typography sx={{ fontSize: 13.5 }}>{cassete.tecidoOrigem}</Typography>
      {cassete.descricao && (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{cassete.descricao}</Typography>
      )}
      {cassete.exigeDescalcificacao && <Chip size="small" variant="outlined" label="descalcificação" />}
      {cassete.fragmentos != null && (
        <Chip size="small" variant="outlined" label={`${cassete.fragmentos} fragmento(s)`} />
      )}
      <Tooltip title="Gravado — o identificador é definitivo">
        <CheckOutlined sx={{ fontSize: 16, color: 'success.main' }} />
      </Tooltip>
    </Stack>
  );
}

function LinhaCasseteNovo({
  cassete,
  indice,
  aoMudar,
}: {
  cassete: CasseteNovo;
  indice: number;
  aoMudar: React.Dispatch<React.SetStateAction<CasseteNovo[]>>;
}) {
  const mudar = (mudanca: Partial<CasseteNovo>) =>
    aoMudar((a) => a.map((x, j) => (indice === j ? { ...x, ...mudanca } : x)));
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
      <TextField
        label="Tecido de origem"
        value={cassete.tecidoOrigem}
        onChange={(e) => mudar({ tecidoOrigem: e.target.value })}
        required
        error={cassete.tecidoOrigem.trim() === ''}
        helperText={cassete.tecidoOrigem.trim() === '' ? 'Obrigatório: sem ele o cassete não existe.' : ' '}
        sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
      />
      <TextField
        label="Descrição"
        value={cassete.descricao}
        onChange={(e) => mudar({ descricao: e.target.value })}
        sx={{ flex: 2, width: { xs: '100%', md: 'auto' } }}
        helperText=" "
      />
      <TextField
        label="Fragmentos"
        type="number"
        value={cassete.fragmentos}
        onChange={(e) => mudar({ fragmentos: e.target.value })}
        slotProps={{ htmlInput: { min: 0, max: 999, inputMode: 'numeric' } }}
        sx={{ width: { xs: '100%', md: 120 } }}
        helperText=" "
      />
      <FormControlLabel
        control={
          <Checkbox checked={cassete.exigeDescalcificacao} onChange={(e) => mudar({ exigeDescalcificacao: e.target.checked })} />
        }
        label="Descalcificação"
        slotProps={{ typography: { sx: { fontSize: 13 } } }}
        sx={{ mt: 1 }}
      />
      <Remover rotulo="Remover cassete" aoRemover={() => aoMudar((a) => a.filter((_, j) => j !== indice))} />
    </Stack>
  );
}

function LinhaMargem({
  margem,
  indice,
  concluida,
  aoMudar,
}: {
  margem: Margem;
  indice: number;
  concluida: boolean;
  aoMudar: React.Dispatch<React.SetStateAction<Margem[]>>;
}) {
  const mudar = (mudanca: Partial<Margem>) =>
    aoMudar((a) => a.map((x, j) => (indice === j ? { ...x, ...mudanca } : x)));
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
      <TextField
        label="Nome"
        value={margem.nome}
        onChange={(e) => mudar({ nome: e.target.value })}
        required
        error={!concluida && margem.nome.trim() === ''}
        disabled={concluida}
        sx={{ flex: 1.5, width: { xs: '100%', md: 'auto' } }}
      />
      <TextField
        select
        label="Método"
        value={margem.metodoAmostragem}
        onChange={(e) => mudar({ metodoAmostragem: e.target.value as MetodoAmostragem })}
        disabled={concluida}
        // M13: sem o metodo, a distancia nao tem leitura na microscopia.
        error={!concluida && !margem.naoAvaliavel && margem.metodoAmostragem === ''}
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
        valor={margem.distanciaCm}
        travado={concluida || margem.naoAvaliavel}
        erro={!concluida && !margem.naoAvaliavel && margem.distanciaCm.trim() === ''}
        aoMudar={(v) => mudar({ distanciaCm: v })}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={margem.naoAvaliavel}
            // Não avaliável e distância medida se contradizem; a marcação limpa o número.
            onChange={(e) => mudar({ naoAvaliavel: e.target.checked, distanciaCm: e.target.checked ? '' : margem.distanciaCm })}
            disabled={concluida}
          />
        }
        label="Não avaliável"
        slotProps={{ typography: { sx: { fontSize: 13 } } }}
        sx={{ mt: 1 }}
      />
      {!concluida && <Remover rotulo="Remover margem" aoRemover={() => aoMudar((a) => a.filter((_, j) => j !== indice))} />}
    </Stack>
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
