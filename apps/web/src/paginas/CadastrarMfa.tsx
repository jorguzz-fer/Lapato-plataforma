import { useEffect, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { QRCodeSVG } from 'qrcode.react';
import { MFA_TAMANHO_CODIGO, type EstagioSessao } from '@lapato/shared';
import { MolduraEntrada } from '@lapato/ui';
import { api, ErroApi } from '../api';

/**
 * Cadastro do segundo fator (Blueprint secao 6: TOTP obrigatorio para quem
 * administra e para quem assina laudo).
 *
 * Duas etapas numa tela: a API sorteia o segredo, o usuario le o QR Code e
 * devolve um codigo valido. Sem essa confirmacao, um erro ao copiar o segredo
 * produziria uma conta com MFA ativo e nenhum aplicativo capaz de gerar codigo.
 */
export function CadastrarMfa({
  obrigatorio,
  aoConcluir,
}: {
  obrigatorio: boolean;
  aoConcluir: (estagio: EstagioSessao) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let ativo = true;

    api
      .post<{ segredo: string; uri: string }>('/auth/mfa/cadastro')
      .then((r) => {
        // StrictMode monta duas vezes em desenvolvimento; ignorar a resposta do
        // efeito descartado evita exibir um segredo que ja foi substituido.
        if (!ativo) return;
        setUri(r.uri);
        setSegredo(r.segredo);
      })
      .catch((err: unknown) => {
        if (ativo) {
          setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível iniciar o cadastro.');
        }
      });

    return () => {
      ativo = false;
    };
  }, []);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>(
        '/auth/mfa/cadastro/confirmacao',
        { codigo },
      );
      aoConcluir(estagio);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível confirmar o código.');
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MolduraEntrada
      titulo="Verificação em duas etapas"
      descricao={
        obrigatorio
          ? 'Seu perfil permite assinar laudos ou administrar permissões. Nesses casos o segundo fator é obrigatório.'
          : 'Leia o código abaixo com seu aplicativo autenticador.'
      }
    >
      <Box component="form" onSubmit={submeter} noValidate>
        <Stack spacing={2.5}>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            {uri ? (
              // Fundo branco fixo: em tema escuro um QR invertido não é lido por
              // boa parte dos leitores.
              <Box sx={{ p: 2, borderRadius: 2, backgroundColor: '#fff' }}>
                <QRCodeSVG value={uri} size={160} />
              </Box>
            ) : (
              <Skeleton variant="rounded" width={192} height={192} />
            )}
          </Box>

          {segredo && (
            <Accordion elevation={0} disableGutters sx={{ backgroundColor: 'transparent' }}>
              <AccordionSummary expandIcon={<ExpandMore />} sx={{ px: 0, minHeight: 0 }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  Não consigo ler o código
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0 }}>
                <Typography sx={{ fontSize: 12.5, mb: 1 }}>
                  Digite esta chave no aplicativo:
                </Typography>
                <Box
                  component="code"
                  sx={{
                    display: 'block',
                    p: 1.5,
                    borderRadius: 1,
                    fontSize: 12,
                    wordBreak: 'break-all',
                    backgroundColor: 'action.hover',
                  }}
                >
                  {segredo}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          <TextField
            label="Código gerado pelo aplicativo"
            value={codigo}
            onChange={(e) =>
              setCodigo(e.target.value.replace(/\D/g, '').slice(0, MFA_TAMANHO_CODIGO))
            }
            required
            fullWidth
            autoComplete="one-time-code"
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            sx={{
              '& input': {
                textAlign: 'center',
                fontSize: 22,
                letterSpacing: '0.5em',
                fontVariantNumeric: 'tabular-nums',
              },
            }}
          />

          {erro && (
            <Alert severity="error" sx={{ fontSize: 13 }}>
              {erro}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={enviando || codigo.length !== MFA_TAMANHO_CODIGO || !uri}
          >
            {enviando ? 'Confirmando…' : 'Confirmar e ativar'}
          </Button>

          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', textAlign: 'center' }}>
            Guarde o acesso ao aplicativo: ainda não existe recuperação de segundo fator.
          </Typography>
        </Stack>
      </Box>
    </MolduraEntrada>
  );
}
