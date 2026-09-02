import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import { api, ErroApi, urlArquivo, type ImagemDoCaso } from '../../api';
import { CapturaWebcam } from './CapturaWebcam';

/**
 * M16 - galeria do caso (secao 57).
 *
 * O que a tela carrega do modulo:
 *
 * - **Acervo unico** (secao 6): nao existe galeria da macroscopia e outra da
 *   microscopia. E uma so, e o que separa e o contexto de captura.
 * - **Origem visivel** (secao 83): imagem enviada pelo cliente aparece marcada,
 *   para nao se confundir com registro produzido pelo laboratorio.
 * - **Inativar, nao excluir** (secao 69): a acao destrutiva nao existe na tela.
 *   O motivo e obrigatorio - "capturada por engano" e "vinculada ao caso
 *   errado" pedem tratamentos diferentes depois.
 * - **Selecionar para o laudo nao mexe no arquivo** (secao 134): e uma marca
 *   com ordem, e a numeracao do documento sai dela (secao 38).
 */

/**
 * Espelho do que o servidor aceita (M16 secao 61: "limite de tamanho, formatos
 * permitidos... arquivos rejeitados deverao gerar mensagem clara"). Repetir a
 * regra aqui nao substitui a validacao do servidor - serve para o usuario saber
 * ANTES de escolher o arquivo, em vez de descobrir por erro.
 */
const FORMATOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const TAMANHO_MAXIMO_MB = 25;

const TIPO_LABEL: Record<string, string> = {
  recebimento: 'Recebimento',
  triagem: 'Triagem',
  macroscopia: 'Macroscopia',
  microfotografia: 'Microfotografia',
  necropsia: 'Necropsia',
  documento: 'Documento',
  whole_slide: 'Lâmina digitalizada',
  requisicao: 'Requisição (guarda 5 anos)',
};

const ORIGEM_LABEL: Record<string, string> = {
  produzida_lapato: 'Produzida no laboratório',
  enviada_cliente: 'Enviada pelo cliente',
  enviada_veterinario: 'Enviada pelo veterinário',
  importada: 'Importada',
  laboratorio_parceiro: 'Laboratório parceiro',
  pericial_externa: 'Pericial externa',
};

/**
 * Tipos que a tela oferece; `whole_slide` fica de fora (ADR 0004: WSI é v2).
 * `requisicao` é a folha digitalizada — o conselho exige a digitalização e a
 * guarda por no mínimo cinco anos, por isso ela tem tipo próprio e não entra
 * como "documento" genérico.
 */
const TIPOS_OFERECIDOS = [
  'recebimento',
  'triagem',
  'macroscopia',
  'microfotografia',
  'necropsia',
  'requisicao',
  'documento',
] as const;

/**
 * Miniatura gerada no navegador, no momento do envio.
 *
 * Redimensionar no servidor exigiria dependência nativa de imagem na imagem
 * Docker da API; aqui o arquivo já está na mão de quem envia. O original sobe
 * intacto — a miniatura é só para a galeria não baixar 8 MB por quadradinho
 * (M16 §73).
 */
async function gerarMiniatura(arquivo: File, lado = 400): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72),
    );
  } catch {
    // Navegador sem createImageBitmap ou formato que ele não decodifica: segue
    // sem miniatura, e a galeria cai no original.
    return null;
  }
}

interface Props {
  casoId: string;
  permissoes: string[];
  /** Contexto de captura desta tela — vira o módulo de origem da imagem. */
  moduloContexto?: string;
  /** Etapa pré-selecionada ao enviar (recebimento, requisição, triagem…). */
  tipoPadrao?: string;
}

export function GaleriaDoCaso({
  casoId,
  permissoes,
  moduloContexto = 'M16_IMAGENS',
  tipoPadrao = 'macroscopia',
}: Props) {
  const [imagens, setImagens] = useState<ImagemDoCaso[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [novoTipo, setNovoTipo] = useState<string>(tipoPadrao);
  const entrada = useRef<HTMLInputElement>(null);

  const [emEdicao, setEmEdicao] = useState<ImagemDoCaso | null>(null);
  const [legenda, setLegenda] = useState('');
  const [inativando, setInativando] = useState<ImagemDoCaso | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ampliada, setAmpliada] = useState<ImagemDoCaso | null>(null);

  const podeEnviar = permissoes.includes('imagem:enviar');
  const [cameraAberta, setCameraAberta] = useState(false);
  const podeEditar = permissoes.includes('imagem:editar');

  const carregar = useCallback(() => {
    api
      .get<ImagemDoCaso[]>(`/imagens/casos/${casoId}`)
      .then(setImagens)
      .catch(() => setErro('Não foi possível carregar as imagens.'))
      .finally(() => setCarregado(true));
  }, [casoId]);

  useEffect(carregar, [carregar]);

  async function enviar(arquivos: FileList | File[] | null) {
    if (!arquivos || arquivos.length === 0) return;
    setOcupado(true);
    setErro(null);

    try {
      // Uma por vez: o módulo permite lote (§20), e enviar em série mantém o
      // relato de erro por arquivo em vez de um "falhou" para as 40.
      for (const arquivo of Array.from(arquivos)) {
        /**
         * Recusa antes de subir: mandar 30 MB pela rede para receber "não
         * aceito" gasta o tempo de quem envia, e num laboratório isso costuma
         * ser conexão de celular.
         */
        if (!FORMATOS.includes(arquivo.type)) {
          throw new Error(
            `"${arquivo.name}" não é um formato aceito. Envie JPEG, PNG, WebP ou HEIC — ` +
              'PDF e documentos não entram no acervo de imagens.',
          );
        }
        if (arquivo.size > TAMANHO_MAXIMO_MB * 1024 * 1024) {
          throw new Error(
            `"${arquivo.name}" tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB e o limite é ${TAMANHO_MAXIMO_MB} MB.`,
          );
        }

        const corpo = new FormData();
        corpo.append('arquivo', arquivo);
        corpo.append('tipo', novoTipo);
        corpo.append('moduloContexto', moduloContexto);

        const mini = await gerarMiniatura(arquivo);
        if (mini) corpo.append('miniatura', mini, 'miniatura.jpg');

        await api.postForm(`/imagens/casos/${casoId}`, corpo);
      }
      carregar();
    } catch (err) {
      setErro(
        err instanceof ErroApi
          ? err.detalhe
          : err instanceof Error
            ? err.message
            : 'Não foi possível enviar a imagem.',
      );
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function salvarLegenda() {
    if (!emEdicao) return;
    setOcupado(true);
    try {
      await api.post(`/imagens/${emEdicao.id}`, { legenda });
      setEmEdicao(null);
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar a legenda.');
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarInativacao() {
    if (!inativando) return;
    setOcupado(true);
    try {
      await api.post(`/imagens/${inativando.id}/inativacao`, { motivo });
      setInativando(null);
      setMotivo('');
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível inativar a imagem.');
    } finally {
      setOcupado(false);
    }
  }

  async function alternarLaudo(img: ImagemDoCaso) {
    setOcupado(true);
    try {
      await api.post(`/imagens/${img.id}/laudo`, { incluir: !img.incluidaNoLaudo });
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível alterar a seleção.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card sx={{ p: 2.5 }}>
      {erro && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
          {erro}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Acervo do caso — todas as etapas num só lugar. Toda imagem guarda quem produziu,
            quando e em qual contexto.
          </Typography>
          {podeEnviar && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              JPEG, PNG, WebP ou HEIC · até {TAMANHO_MAXIMO_MB} MB por arquivo · o original é
              preservado; recorte e anotação não alteram o arquivo enviado.
            </Typography>
          )}
        </Box>

        {podeEnviar && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Etapa"
              value={novoTipo}
              onChange={(e) => setNovoTipo(e.target.value)}
              sx={{ minWidth: 170 }}
            >
              {TIPOS_OFERECIDOS.map((t) => (
                <MenuItem key={t} value={t}>
                  {TIPO_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>

            <Button
              variant="outlined"
              startIcon={<PhotoCameraOutlined />}
              disabled={ocupado}
              onClick={() => setCameraAberta(true)}
            >
              Tirar foto
            </Button>
            <Button
              variant="contained"
              startIcon={<AddPhotoAlternateOutlined />}
              disabled={ocupado}
              onClick={() => entrada.current?.click()}
            >
              Enviar imagens
            </Button>
            <input
              ref={entrada}
              type="file"
              accept={FORMATOS.join(',')}
              multiple
              hidden
              onChange={(e) => void enviar(e.target.files)}
            />
          </Stack>
        )}
      </Stack>

      {carregado && imagens.length === 0 && (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Nenhuma imagem no acervo deste caso.
        </Typography>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          gap: 2,
        }}
      >
        {imagens.map((img) => (
          <Card key={img.id} variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box
              component="button"
              onClick={() => setAmpliada(img)}
              sx={{
                display: 'block',
                width: '100%',
                border: 0,
                p: 0,
                cursor: 'zoom-in',
                background: 'var(--mui-palette-action-hover, #f1f2f5)',
              }}
              aria-label={`Ampliar ${img.identificador}`}
            >
              <Box
                component="img"
                src={urlArquivo(`/imagens/${img.id}/arquivo?tamanho=miniatura`)}
                alt={img.legenda ?? img.identificador}
                loading="lazy"
                sx={{ width: '100%', height: 170, objectFit: 'cover', display: 'block' }}
              />
            </Box>

            <Box sx={{ p: 1.5 }}>
              <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
                <Chip size="small" label={TIPO_LABEL[img.tipo] ?? img.tipo} />
                {/* §83: o que veio de fora precisa se declarar. */}
                {img.origem !== 'produzida_lapato' && (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={ORIGEM_LABEL[img.origem] ?? img.origem}
                  />
                )}
                {img.incluidaNoLaudo && (
                  <Chip
                    size="small"
                    color="primary"
                    label={`Imagem ${String(img.ordemNoLaudo ?? 0).padStart(2, '0')}`}
                  />
                )}
              </Stack>

              <Typography sx={{ fontSize: 12.5, minHeight: 34 }}>
                {img.legenda ?? (
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    Sem legenda
                  </Box>
                )}
              </Typography>

              <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
                {img.identificador} · {img.autor ?? 'autor não registrado'} ·{' '}
                {new Date(img.enviadaEm).toLocaleDateString('pt-BR')}
              </Typography>

              {podeEditar && (
                <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
                  <Tooltip title="Legenda">
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEmEdicao(img);
                        setLegenda(img.legenda ?? '');
                      }}
                      aria-label="Editar legenda"
                    >
                      <DescriptionOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  <Button
                    size="small"
                    variant={img.incluidaNoLaudo ? 'outlined' : 'text'}
                    disabled={ocupado}
                    onClick={() => void alternarLaudo(img)}
                  >
                    {img.incluidaNoLaudo ? 'Retirar do laudo' : 'Incluir no laudo'}
                  </Button>

                  <Tooltip title="Inativar (o histórico fica)">
                    <IconButton
                      size="small"
                      onClick={() => setInativando(img)}
                      aria-label="Inativar imagem"
                      sx={{ ml: 'auto' }}
                    >
                      <BlockOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              )}
            </Box>
          </Card>
        ))}
      </Box>

      {/* --- ampliação --- */}
      <Dialog open={ampliada !== null} onClose={() => setAmpliada(null)} maxWidth="lg">
        <DialogTitle sx={{ fontSize: 15 }}>
          {ampliada?.identificador}
          {ampliada?.legenda ? ` — ${ampliada.legenda}` : ''}
        </DialogTitle>
        <DialogContent>
          {ampliada && (
            <Box
              component="img"
              src={urlArquivo(`/imagens/${ampliada.id}/arquivo`)}
              alt={ampliada.legenda ?? ampliada.identificador}
              sx={{ maxWidth: '100%', display: 'block' }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAmpliada(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>

      {/* --- legenda --- */}
      <Dialog open={emEdicao !== null} onClose={() => setEmEdicao(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: 16 }}>Legenda da imagem</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Legenda"
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            sx={{ mt: 1 }}
            helperText="Descrição objetiva do que a imagem mostra — não a hipótese diagnóstica."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmEdicao(null)}>Cancelar</Button>
          <Button variant="contained" disabled={ocupado} onClick={() => void salvarLegenda()}>
            Salvar
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- inativação --- */}
      <Dialog
        open={inativando !== null}
        onClose={() => setInativando(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontSize: 16 }}>Inativar imagem</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            A imagem sai da galeria e do laudo, mas continua no acervo com o histórico —
            arquivo clínico não se apaga.
          </Alert>
          <TextField
            autoFocus
            fullWidth
            label="Motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
            helperText="Ex.: captura acidental; imagem fora de foco; vinculada ao caso errado."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInativando(null)}>Cancelar</Button>
          <Button
            variant="contained"
            color="error"
            disabled={ocupado || motivo.trim() === ''}
            onClick={() => void confirmarInativacao()}
          >
            Inativar
          </Button>
        </DialogActions>
      </Dialog>

      <CapturaWebcam
        aberto={cameraAberta}
        aoFechar={() => setCameraAberta(false)}
        aoCapturar={(arquivo) => void enviar([arquivo])}
      />
    </Card>
  );
}
