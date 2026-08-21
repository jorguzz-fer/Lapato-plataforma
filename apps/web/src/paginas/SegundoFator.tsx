import { useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { MFA_TAMANHO_CODIGO, type EstagioSessao } from '@lapato/shared';
import { MolduraEntrada } from '@lapato/ui';
import { api, ErroApi } from '../api';

/**
 * Segundo fator (M02, Blueprint secao 6).
 *
 * A senha ja foi aceita e o cookie de sessao existe, mas a sessao esta em
 * `mfa_pendente` - nenhuma rota de negocio responde ate o codigo ser validado.
 */
export function SegundoFator({ aoAvancar }: { aoAvancar: (estagio: EstagioSessao) => void }) {
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>('/auth/mfa', { codigo });
      aoAvancar(estagio);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível validar o código.');
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MolduraEntrada
      titulo="Verificação em duas etapas"
      descricao="Digite o código de 6 dígitos do seu aplicativo autenticador."
    >
      <Box component="form" onSubmit={submeter} noValidate>
        <Stack spacing={2.5}>
          <TextField
            label="Código"
            value={codigo}
            // Só dígitos: colar de um autenticador costuma trazer espaço no meio.
            onChange={(e) =>
              setCodigo(e.target.value.replace(/\D/g, '').slice(0, MFA_TAMANHO_CODIGO))
            }
            required
            fullWidth
            autoFocus
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
            disabled={enviando || codigo.length !== MFA_TAMANHO_CODIGO}
          >
            {enviando ? 'Verificando…' : 'Verificar'}
          </Button>
        </Stack>
      </Box>
    </MolduraEntrada>
  );
}
