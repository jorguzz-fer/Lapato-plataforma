import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, ErroApi, type DestinatarioLaudo } from '../../api';

const ROTULO_TIPO: Record<string, string> = {
  cliente: 'Cliente',
  veterinario: 'Veterinário solicitante',
  contato: 'Contato do cliente',
};

/**
 * Enviar ou reenviar o laudo.
 *
 * Quarta revisao com o Hugo: "aparece uma caixinha com os e-mails do cliente;
 * tem o principal que ja vem clicado, e o do veterinario, que as vezes e
 * outro - eu coloco nos e-mails que eu quiser"; e, do arquivo, "eu posso
 * reenviar esse laudo se eu quiser".
 *
 * Os enderecos vem do cadastro (M03), nao de digitacao: e-mail digitado na
 * pressa do envio e e-mail que ninguem conferiu - e o que vai anexo e dado
 * clinico de um paciente com nome e tutor.
 */
export function DialogoEnvio({
  versaoId,
  reenvio,
  aoFechar,
  aoEnviar,
}: {
  versaoId: string;
  /** Segundo envio em diante: muda o texto, nao a regra. */
  reenvio?: boolean;
  aoFechar: () => void;
  aoEnviar?: () => void;
}) {
  const [opcoes, setOpcoes] = useState<DestinatarioLaudo[] | null>(null);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api
      .get<DestinatarioLaudo[]>(`/laudos/versoes/${versaoId}/destinatarios`)
      .then((lista) => {
        setOpcoes(lista);
        // O principal e o do solicitante nascem marcados, como no software dele.
        setMarcados(Object.fromEntries(lista.map((d) => [d.email, d.padrao])));
      })
      .catch((err) => {
        setOpcoes([]);
        setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível carregar os e-mails.');
      });
  }, [versaoId]);

  const escolhidos = Object.entries(marcados)
    .filter(([, v]) => v)
    .map(([email]) => email);

  async function enviar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/laudos/versoes/${versaoId}/envio`, {
        destinatarios: escolhidos,
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
      });
      aoEnviar?.();
      aoFechar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar o laudo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 17 }}>{reenvio ? 'Reenviar laudo' : 'Enviar laudo'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {!opcoes && <Skeleton variant="rounded" height={90} />}

          {opcoes && opcoes.length === 0 && (
            <Alert severity="warning">
              Nem o cliente nem o veterinário têm e-mail no cadastro. Cadastre o endereço na ficha
              do cliente e volte — o envio não aceita e-mail digitado aqui.
            </Alert>
          )}

          {opcoes && opcoes.length > 0 && (
            <div>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                PARA QUEM
              </Typography>
              <Stack>
                {opcoes.map((d) => (
                  <FormControlLabel
                    key={d.email}
                    control={
                      <Checkbox
                        checked={marcados[d.email] ?? false}
                        onChange={(e) =>
                          setMarcados((atual) => ({ ...atual, [d.email]: e.target.checked }))
                        }
                      />
                    }
                    label={
                      <span>
                        {d.nome}{' '}
                        <Typography component="span" sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                          {d.email} · {ROTULO_TIPO[d.tipo] ?? d.tipo}
                        </Typography>
                      </span>
                    }
                  />
                ))}
              </Stack>
            </div>
          )}

          <TextField
            label="Observação"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            helperText="Opcional — fica no registro do envio, não vai no e-mail."
          />

          {/*
            Honestidade com quem clica: o registro do envio é imediato, a
            entrega depende do canal do M26 estar configurado. Prometer
            "enviado" sem servidor de e-mail seria mentir na cara do usuário.
          */}
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            O envio fica registrado com o seu nome, a data e os endereços escolhidos. A entrega sai
            pela fila de notificações, quando o canal de e-mail estiver configurado.
          </Typography>

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => void enviar()}
          disabled={ocupado || escolhidos.length === 0}
        >
          {ocupado ? 'Registrando…' : reenvio ? 'Reenviar' : 'Enviar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
