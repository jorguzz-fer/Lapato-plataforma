import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Visibility from '@mui/icons-material/VisibilityOutlined';
import VisibilityOff from '@mui/icons-material/VisibilityOffOutlined';

/**
 * Campo de senha com alternancia de visibilidade.
 *
 * Senha mascarada esconde o erro de digitacao, e nao so a senha. Numa senha
 * inicial longa, gerada e transcrita de outro lugar, um `I` no lugar de `l`
 * produz "credenciais invalidas" sem nenhuma pista de onde esta o engano -
 * aconteceu no primeiro acesso em producao.
 *
 * Nasce oculto: mostrar e sempre um ato deliberado de quem esta na frente da tela.
 */
export function CampoSenha({
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  autoFocus,
  minLength,
  ajuda,
  erro,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  minLength?: number;
  ajuda?: string;
  erro?: string;
}) {
  const [visivel, setVisivel] = useState(false);

  return (
    <TextField
      label={rotulo}
      type={visivel ? 'text' : 'password'}
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      required
      fullWidth
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      error={Boolean(erro)}
      helperText={erro ?? ajuda}
      slotProps={{
        htmlInput: { minLength },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setVisivel((v) => !v)}
                edge="end"
                size="small"
                // O rotulo anuncia a acao; `aria-pressed` anuncia o estado.
                aria-pressed={visivel}
                aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {visivel ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
