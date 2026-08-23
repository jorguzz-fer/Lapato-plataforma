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
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import {
  LATERALIDADE,
  RESULTADO_MARGEM,
  type Lateralidade,
  type ResultadoMargem,
} from '@lapato/shared';
import {
  api,
  baixarArquivo,
  ErroApi,
  type CitologiaDaVersao,
  type Dossie as DadosDossie,
  type LaudoDoCaso,
  type VocabularioCitologia,
} from '../api';
import { BloqueioGuardian } from './BloqueioGuardian';
import { AvisoBancadaBloqueada, impedimentoDeBancada } from './AvisoBancadaBloqueada';
import {
  PainelCitologia,
  temConteudo,
  type AvaliacaoEditavel,
} from './laudo/PainelCitologia';
import { GaleriaDoCaso } from './imagens/GaleriaDoCaso';

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
 *   correcao, que criam versao nova e preservam a anterior - o Portal sinaliza
 *   "documento substituido".
 * - **A liberacao e UMA acao** (DIRETRIZES secao 17): fluxo, Portal,
 *   notificacao e auditoria sao consequencias automatizadas. O botao diz isso.
 * - **A edicao para quando o laudo sai das maos de quem elabora**: em revisao
 *   ou adiante, o formulario abre em leitura. O servidor ainda aceitaria o
 *   save, mas editar por baixo do revisor tornaria a aprovacao dele um parecer
 *   sobre um texto que ja nao existe.
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
  // M12: só carregado quando o caso é citológico - a bancada muda de forma.
  const [citologia, setCitologia] = useState<CitologiaDaVersao | null>(null);
  const [vocabulario, setVocabulario] = useState<VocabularioCitologia | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<Record<string, AvaliacaoEditavel>>({});
  const [comentarios, setComentarios] = useState('');
  const [conclusao, setConclusao] = useState('');
  const [notaInterna, setNotaInterna] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [bloqueioGuardian, setBloqueioGuardian] = useState<ErroApi | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // --- parte 2: revisao, assinatura, versoes ---
  const [comentariosRevisao, setComentariosRevisao] = useState('');
  const [discordancia, setDiscordancia] = useState(false);
  const [motivoVersao, setMotivoVersao] = useState('');
  const [codigoAssinatura, setCodigoAssinatura] = useState<string | null>(null);
  const [processandoPdf, setProcessandoPdf] = useState<'previa' | 'download' | null>(null);

  const veNotaInterna = permissoes.includes('laudo:ver_nota_interna');
  const podeEditar = permissoes.includes('laudo:editar');
  const podeRevisar = permissoes.includes('laudo:revisar');
  const podeAssinar = permissoes.includes('laudo:assinar') && !exigeSupervisao;
  const podeLiberar = permissoes.includes('laudo:liberar');
  const podeVerPdf = permissoes.includes('laudo:visualizar');

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
  /**
   * M12 seção 6 - interface adaptativa: "a citologia não deverá possuir uma
   * única ficha universal". A modalidade do serviço decide o que a bancada
   * mostra; margens e contagem mitótica são histopatologia (M13) e não fazem
   * sentido sobre um esfregaço.
   */
  const citologico = dossie?.servico.modalidade === 'citopatologia';
  const versaoId = versao?.id;

  useEffect(() => {
    if (!citologico || !versaoId) return;

    Promise.all([
      api.get<CitologiaDaVersao>(`/citologia/versoes/${versaoId}`),
      api.get<VocabularioCitologia>('/citologia/vocabulario'),
    ])
      .then(([dados, vocab]) => {
        setCitologia(dados);
        setVocabulario(vocab);
        setAvaliacoes(
          Object.fromEntries(
            dados.avaliacoes.map(({ amostraId, ...resto }) => [amostraId, resto]),
          ),
        );
      })
      .catch(() => setErro('Não foi possível carregar a avaliação citológica.'));
  }, [citologico, versaoId]);

  /**
   * Editável só enquanto o laudo está nas mãos de quem elabora. Em revisão ou
   * adiante o formulário vira leitura — editar por baixo do revisor tornaria a
   * aprovação dele um parecer sobre um texto que já não existe.
   */
  const editavel =
    podeEditar &&
    laudo !== null &&
    !assinada &&
    (laudo.status === 'rascunho' || laudo.status === 'retornado_para_correcao');

  const emRevisao = laudo?.status === 'aguardando_revisao' || laudo?.status === 'em_revisao';

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

      /**
       * M12: uma chamada por amostra, porque cada uma é uma avaliação
       * independente (§115). Vai só o que tem conteúdo - amostra intocada não
       * gera registro vazio no banco.
       */
      if (citologico) {
        for (const [amostraId, avaliacao] of Object.entries(avaliacoes)) {
          if (!temConteudo(avaliacao)) continue;
          await api.post(`/citologia/versoes/${versao.id}/amostras/${amostraId}`, avaliacao);
        }
      }

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

  /** Executa uma ação do fluxo e recarrega; o Guardian aparece estruturado. */
  async function agir(fn: () => Promise<void>, mensagemErro: string) {
    setOcupado(true);
    setErro(null);
    setBloqueioGuardian(null);
    try {
      await fn();
      carregar(await api.get<LaudoDoCaso | null>(`/laudos/casos/${id}`));
    } catch (err) {
      if (err instanceof ErroApi && err.bloqueadoPeloGuardian) {
        setBloqueioGuardian(err);
      } else {
        setErro(err instanceof ErroApi ? err.detalhe : mensagemErro);
      }
    } finally {
      setOcupado(false);
    }
  }

  function concluirRevisao(resultado: 'aprovada' | 'ajustes_solicitados') {
    void agir(async () => {
      await api.post(`/laudos/versoes/${versao!.id}/revisao/conclusao`, {
        resultado,
        ...(comentariosRevisao.trim() ? { comentarios: comentariosRevisao.trim() } : {}),
        discordancia,
      });
      setComentariosRevisao('');
      setDiscordancia(false);
    }, 'Não foi possível concluir a revisão.');
  }

  function assinar() {
    void agir(async () => {
      const r = await api.post<{ codigoValidacao: string }>(
        `/laudos/versoes/${versao!.id}/assinatura`,
      );
      // O código do QR aparece uma vez concluída a ação — é ele que valida o
      // documento entregue (M11).
      setCodigoAssinatura(r.codigoValidacao);
    }, 'Não foi possível assinar o laudo.');
  }

  function liberar() {
    void agir(
      () => api.post(`/laudos/versoes/${versao!.id}/liberacao`).then(() => undefined),
      'Não foi possível liberar o laudo.',
    );
  }

  function criarVersao(tipo: 'adendo' | 'correcao') {
    void agir(async () => {
      await api.post(`/laudos/${laudo!.laudoId}/versoes`, {
        tipo,
        motivo: motivoVersao.trim(),
      });
      setMotivoVersao('');
      setCodigoAssinatura(null);
    }, `Não foi possível criar a ${tipo === 'adendo' ? 'nova versão de adendo' : 'correção'}.`);
  }

  /**
   * Pré-visualização: mostra exatamente o documento que seria disponibilizado
   * (M11 seção 71), com a marca d'água RASCUNHO quando ainda não assinado.
   * Gerada na hora, nunca gravada — abre em nova aba, não baixa.
   */
  async function preVisualizarPdf() {
    if (!versao) return;
    setErro(null);
    setProcessandoPdf('previa');
    try {
      const blob = await baixarArquivo(`/laudos/versoes/${versao.id}/pdf/pre-visualizacao`);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setErro(
        err instanceof ErroApi ? err.detalhe : 'Não foi possível gerar a pré-visualização.',
      );
    } finally {
      setProcessandoPdf(null);
    }
  }

  /** Os bytes congelados na assinatura (ADR 0005) — nunca regerados. */
  async function baixarPdfAssinado() {
    if (!versao) return;
    setErro(null);
    setProcessandoPdf('download');
    try {
      const blob = await baixarArquivo(`/laudos/versoes/${versao.id}/pdf`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${dossie!.caso.identificador}-v${versao.versao}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível baixar o PDF.');
    } finally {
      setProcessandoPdf(null);
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

  /**
   * M05 secao 12: nao se abre laudo de material que o laboratorio nunca
   * registrou ter recebido. Vale so enquanto o laudo nao existe - depois de
   * aberto, ele continua acessivel mesmo que alguem mexa na triagem.
   */
  if (!laudo && impedimentoDeBancada(dossie, 'microscopia')) {
    return <AvisoBancadaBloqueada dossie={dossie} etapa="microscopia" />;
  }

  return (
    <Box sx={{ maxWidth: 940 }}>
      <Stack
        direction="row"
        sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h2">Microscopia e laudo</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {laudo && (
            <Chip
              size="small"
              variant="outlined"
              color={laudo.status === 'retornado_para_correcao' ? 'warning' : 'primary'}
              label={`${STATUS_LABEL[laudo.status] ?? laudo.status} · v${versao?.versao}`}
            />
          )}
          {laudo && podeVerPdf && (
            <Button
              size="small"
              startIcon={<VisibilityOutlined />}
              onClick={() => void preVisualizarPdf()}
              disabled={processandoPdf !== null}
            >
              {processandoPdf === 'previa' ? 'Gerando…' : 'Pré-visualizar PDF'}
            </Button>
          )}
          {assinada && podeVerPdf && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadOutlined />}
              onClick={() => void baixarPdfAssinado()}
              disabled={processandoPdf !== null}
            >
              {processandoPdf === 'download' ? 'Baixando…' : 'Baixar PDF'}
            </Button>
          )}
        </Stack>
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
            {citologico && vocabulario && citologia && (
              /* M12: a lógica citológica vem ANTES da descrição e do
                 diagnóstico porque é ela que os sustenta - o raciocínio da
                 seção 143 vai do material à interpretação, não o contrário. */
              <Secao
                titulo="Avaliação citológica"
                descricao="Uma avaliação por amostra: material, adequação, fundo, populações, critérios e interpretação (M12)."
              >
                <PainelCitologia
                  amostras={citologia.amostras}
                  valores={avaliacoes}
                  vocabulario={vocabulario}
                  editavel={editavel}
                  aoAlterar={(amostraId, avaliacao) =>
                    setAvaliacoes((a) => ({ ...a, [amostraId]: avaliacao }))
                  }
                />
              </Secao>
            )}

            <Secao
              titulo={citologico ? 'Descrição geral' : 'Descrição microscópica'}
              descricao={
                citologico
                  ? 'Observações que valem para o caso todo. A descrição de cada esfregaço fica na avaliação da amostra.'
                  : 'O que foi visto nas lâminas, com as palavras do patologista.'
              }
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

            {/* Margem microscópica é histopatologia (M13): num esfregaço não há
                peça orientada onde medir distância até a borda. */}
            {!citologico && (
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
            )}

            {/* M16 §36: escolher as imagens do laudo é parte do ato de laudar -
                por isso a galeria também mora aqui, e não só no dossiê. A
                numeração do documento sai da ordem da seleção (§38). */}
            <Secao
              titulo="Imagens"
              descricao="As selecionadas entram no documento, numeradas pela ordem da seleção. Microfotografias podem ser enviadas por aqui."
            >
              {id && (
                <GaleriaDoCaso
                  casoId={id}
                  permissoes={permissoes}
                  moduloContexto="M11_LAUDOS"
                />
              )}
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

          {/* --- Revisão (M11): o parecer de quem revisa ------------------- */}
          {emRevisao && podeRevisar && (
            <Card sx={{ p: 2.5, mt: 2.5 }}>
              <Typography variant="h4" sx={{ mb: 0.25 }}>
                Revisão
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
                Aprovar segue para assinatura. Solicitar ajustes devolve a quem elaborou — e exige
                dizer quais.
              </Typography>

              <TextField
                label="Comentários"
                value={comentariosRevisao}
                onChange={(e) => setComentariosRevisao(e.target.value)}
                multiline
                minRows={3}
                fullWidth
                helperText="Obrigatórios ao solicitar ajustes: são o que orienta a correção."
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={discordancia}
                    onChange={(e) => setDiscordancia(e.target.checked)}
                  />
                }
                // M13: a discordância registrada alimenta a Qualidade (M22).
                label="Registrar discordância diagnóstica"
                slotProps={{ typography: { sx: { fontSize: 13 } } }}
                sx={{ mt: 1 }}
              />

              <Stack
                direction={{ xs: 'column-reverse', sm: 'row' }}
                spacing={1.5}
                sx={{ mt: 2, justifyContent: 'flex-end' }}
              >
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => concluirRevisao('ajustes_solicitados')}
                  disabled={ocupado || comentariosRevisao.trim() === ''}
                >
                  Solicitar ajustes
                </Button>
                <Button
                  variant="contained"
                  onClick={() => concluirRevisao('aprovada')}
                  disabled={ocupado}
                >
                  Aprovar para assinatura
                </Button>
              </Stack>
            </Card>
          )}

          {emRevisao && !podeRevisar && (
            <Alert severity="info" sx={{ mt: 2.5 }}>
              Aguardando a conclusão da revisão. Enquanto isso, o conteúdo fica em leitura.
            </Alert>
          )}

          {/* --- Assinatura concluída: o código que valida o documento ----- */}
          {codigoAssinatura && (
            <Alert severity="success" sx={{ mt: 2.5 }}>
              <AlertTitle>Laudo assinado</AlertTitle>
              Código de validação do documento:{' '}
              <Box component="strong" sx={{ ...MONO }}>{codigoAssinatura}</Box>. Ele vai no QR do
              PDF e permite conferir a autenticidade.
            </Alert>
          )}

          {/* --- Liberado: o desfecho ------------------------------------- */}
          {laudo.status === 'liberado' && (
            <Alert severity="success" sx={{ mt: 2.5 }}>
              <AlertTitle>Laudo liberado</AlertTitle>
              Fluxo atualizado, notificação enfileirada e auditoria registrada — consequências
              automáticas da única ação que você executou.
            </Alert>
          )}

          {/* --- Versões (M11): adendo acrescenta; correção retifica ------- */}
          {laudo.versoes.length > 0 && (assinada || laudo.versoes.length > 1) && (
            <Card sx={{ p: 2.5, mt: 2.5 }}>
              <Typography variant="h4" sx={{ mb: 0.25 }}>
                Versões
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
                Nenhuma versão é apagada. A anterior fica marcada como substituída — e o Portal
                sinaliza isso a quem recebeu o documento.
              </Typography>

              <Stack spacing={1} divider={<Divider flexItem />}>
                {laudo.versoes.map((v) => (
                  <Stack
                    key={v.versao}
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}
                  >
                    <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 600 }}>
                      v{v.versao}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={v.tipo === 'original' ? 'Original' : v.tipo === 'adendo' ? 'Adendo' : 'Correção'}
                    />
                    {v.assinadaEm && (
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                        assinada em {new Date(v.assinadaEm).toLocaleString('pt-BR')}
                      </Typography>
                    )}
                    {v.substituida && <Chip size="small" label="substituída" />}
                    {v.motivo && (
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                        — {v.motivo}
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Stack>

              {assinada &&
                (permissoes.includes('laudo:adendo') || permissoes.includes('laudo:corrigir')) && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      sx={{ alignItems: { sm: 'flex-start' } }}
                    >
                      <TextField
                        label="Motivo"
                        value={motivoVersao}
                        onChange={(e) => setMotivoVersao(e.target.value)}
                        sx={{ flex: 1, width: { xs: '100%', sm: 'auto' } }}
                        // M11: adendo e correção exigem motivo — ele aparece na
                        // linha do tempo e no histórico de versões.
                        helperText="Obrigatório: fica registrado na versão."
                      />
                      {permissoes.includes('laudo:adendo') && (
                        <Button
                          variant="outlined"
                          onClick={() => criarVersao('adendo')}
                          disabled={ocupado || motivoVersao.trim() === ''}
                        >
                          Criar adendo
                        </Button>
                      )}
                      {permissoes.includes('laudo:corrigir') && (
                        <Button
                          variant="outlined"
                          color="warning"
                          onClick={() => criarVersao('correcao')}
                          disabled={ocupado || motivoVersao.trim() === ''}
                        >
                          Criar correção
                        </Button>
                      )}
                    </Stack>
                  </>
                )}
            </Card>
          )}

          {bloqueioGuardian && (
            <BloqueioGuardian erro={bloqueioGuardian} acao="assinar ou enviar o laudo" />
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

            {laudo.status === 'aguardando_assinatura' && !assinada && (
              <Tooltip
                title={
                  podeAssinar
                    ? ''
                    : exigeSupervisao
                      ? 'Perfil sob supervisão não assina laudo.'
                      : 'Seu perfil não assina laudos.'
                }
              >
                <span>
                  <Button
                    variant="contained"
                    onClick={assinar}
                    disabled={ocupado || !podeAssinar}
                  >
                    {/* M11 seção 82: a assinatura congela identificação
                        profissional, data e versão do documento. */}
                    {ocupado ? 'Processando…' : 'Assinar laudo'}
                  </Button>
                </span>
              </Tooltip>
            )}

            {laudo.status === 'assinado' && podeLiberar && (
              <Button variant="contained" onClick={liberar} disabled={ocupado}>
                {/* DIRETRIZES seção 17: é UMA ação; o resto é consequência. */}
                {ocupado ? 'Processando…' : 'Liberar laudo'}
              </Button>
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
