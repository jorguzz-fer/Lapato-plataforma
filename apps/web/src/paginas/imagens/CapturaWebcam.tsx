import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';

/**
 * M16 — captura direta pela webcam da bancada.
 *
 * Pedido da primeira review com o laboratório: a câmera fica fixa num braço
 * sobre a bancada (recebimento, macroscopia), e quem opera não deve encostar
 * nela nem trocar de aplicativo — clica em "Tirar foto", confere o
 * enquadramento e captura. O arquivo segue o MESMO caminho do upload: mesma
 * validação, mesma miniatura, mesmo acervo; a câmera é só outra origem de
 * arquivo. Também atende à digitalização da requisição: a folha vai sob a
 * câmera e vira imagem do tipo `requisicao`.
 *
 * A lista de câmeras só ganha nomes legíveis depois que a permissão foi
 * concedida — antes disso o navegador esconde os rótulos de propósito. Por
 * isso a ordem: abre o vídeo com a câmera padrão, e então enumera.
 */

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  /** Recebe o arquivo capturado; o chamador decide como enviar. */
  aoCapturar: (arquivo: File) => void | Promise<void>;
}

export function CapturaWebcam({ aberto, aoFechar, aoCapturar }: Props) {
  const video = useRef<HTMLVideoElement | null>(null);
  const fluxo = useRef<MediaStream | null>(null);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pronta, setPronta] = useState(false);

  const parar = useCallback(() => {
    fluxo.current?.getTracks().forEach((t) => t.stop());
    fluxo.current = null;
    setPronta(false);
  }, []);

  const ligar = useCallback(
    async (deviceId: string) => {
      parar();
      setErro(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : // Sem preferência: pede a maior resolução razoável que a câmera dá.
              { width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        fluxo.current = stream;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        setPronta(true);

        // Com a permissão concedida, os rótulos ficam visíveis.
        const dispositivos = await navigator.mediaDevices.enumerateDevices();
        setCameras(dispositivos.filter((d) => d.kind === 'videoinput'));
        const emUso = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (emUso) setCameraId(emUso);
      } catch (e) {
        setErro(
          e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
            ? 'O navegador bloqueou o acesso à câmera. Libere a permissão de câmera para este site e tente de novo.'
            : e instanceof DOMException && e.name === 'NotFoundError'
              ? 'Nenhuma câmera foi encontrada. Conecte a webcam da bancada e tente de novo.'
              : 'Não foi possível abrir a câmera.',
        );
      }
    },
    [parar],
  );

  useEffect(() => {
    if (aberto) void ligar('');
    else parar();
    return parar;
    // `ligar('')` só na abertura; trocas de câmera passam pelo select.
  }, [aberto]);

  function capturar() {
    const el = video.current;
    if (!el || el.videoWidth === 0) return;

    const tela = document.createElement('canvas');
    tela.width = el.videoWidth;
    tela.height = el.videoHeight;
    tela.getContext('2d')?.drawImage(el, 0, 0);

    tela.toBlob(
      (blob) => {
        if (!blob) {
          setErro('Não foi possível gerar a imagem da captura.');
          return;
        }
        const nome = `captura-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
        void aoCapturar(new File([blob], nome, { type: 'image/jpeg' }));
        aoFechar();
      },
      'image/jpeg',
      // Qualidade alta de propósito: é registro técnico, não avatar.
      0.92,
    );
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 16 }}>Tirar foto pela webcam</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {erro && <Alert severity="warning">{erro}</Alert>}

          {cameras.length > 1 && (
            <TextField
              select
              size="small"
              label="Câmera"
              value={cameraId}
              onChange={(e) => {
                setCameraId(e.target.value);
                void ligar(e.target.value);
              }}
              sx={{ maxWidth: 360 }}
            >
              {cameras.map((c, i) => (
                <MenuItem key={c.deviceId} value={c.deviceId}>
                  {c.label || `Câmera ${i + 1}`}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Box
            sx={{
              position: 'relative',
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'common.black',
              minHeight: 240,
            }}
          >
            <video ref={video} playsInline muted style={{ width: '100%', display: 'block' }} />
          </Box>

          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            A câmera fixa da bancada não precisa ser tocada: ajuste o material sob a lente e
            capture. A foto entra no acervo do caso pelo mesmo caminho do envio de arquivo.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button
          variant="contained"
          startIcon={<PhotoCameraOutlined />}
          disabled={!pronta}
          onClick={capturar}
        >
          Capturar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
