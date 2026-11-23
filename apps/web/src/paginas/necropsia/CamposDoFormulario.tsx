import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { PERGUNTAS_FORMULARIO_NECROPSIA } from '@lapato/shared';

/**
 * Os campos do formulario de necropsia, uma vez.
 *
 * A tela publica do tutor e a do tecnico mostram EXATAMENTE as mesmas
 * perguntas - se fossem dois componentes, uma delas acabaria perguntando
 * menos, e a resposta que falta e justamente a que o patologista procura no
 * meio do exame.
 */
export function CamposDoFormularioNecropsia({
  valores,
  aoMudar,
}: {
  valores: Record<string, string>;
  aoMudar: (fn: (anterior: Record<string, string>) => Record<string, string>) => void;
}) {
  const definir = (chave: string) => (e: { target: { value: string } }) =>
    aoMudar((anterior) => ({ ...anterior, [chave]: e.target.value }));

  return (
    <Stack spacing={2}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'text.secondary' }}>
        RESPONSÁVEL LEGAL
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Nome do responsável"
          value={valores.responsavelSolicitacao ?? ''}
          onChange={definir('responsavelSolicitacao')}
          required
          sx={{ flex: 1.6 }}
        />
        <TextField
          label="CPF"
          value={valores.responsavelDocumento ?? ''}
          onChange={definir('responsavelDocumento')}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Telefone ou e-mail"
          value={valores.contatoResponsavel ?? ''}
          onChange={definir('contatoResponsavel')}
          required
          sx={{ flex: 1.6 }}
        />
        <TextField
          label="Cidade"
          value={valores.responsavelCidade ?? ''}
          onChange={definir('responsavelCidade')}
          sx={{ flex: 1.2 }}
        />
        <TextField
          label="UF"
          value={valores.responsavelUf ?? ''}
          onChange={(e) =>
            aoMudar((anterior) => ({
              ...anterior,
              responsavelUf: e.target.value.toUpperCase().slice(0, 2),
            }))
          }
          sx={{ width: 90 }}
        />
      </Stack>

      <Typography
        sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'text.secondary', pt: 1 }}
      >
        O QUE ACONTECEU
      </Typography>
      {PERGUNTAS_FORMULARIO_NECROPSIA.map((pergunta) => (
        <TextField
          key={pergunta.chave}
          label={pergunta.rotulo}
          value={valores[pergunta.chave] ?? ''}
          onChange={definir(pergunta.chave)}
          helperText={pergunta.ajuda}
          required={pergunta.chave === 'relatoCronologico'}
          type={pergunta.tipo === 'data_hora' ? 'datetime-local' : 'text'}
          multiline={pergunta.tipo === 'texto_longo'}
          minRows={pergunta.tipo === 'texto_longo' ? 3 : undefined}
          slotProps={
            pergunta.tipo === 'data_hora' ? { inputLabel: { shrink: true } } : undefined
          }
        />
      ))}
    </Stack>
  );
}
