import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, ErroApi } from '../api';

/**
 * Arquivo de laudos (segunda review, Hugo): "a gente consegue fazer busca dos
 * laudos pelo paciente, pelo cliente, pelo nome do responsavel, por uma
 * palavra-chave - carcinoma -, pela lamina, pela OS". Uma caixa so; o
 * servidor procura em tudo isso na versao corrente de cada laudo.
 */

interface ResultadoLaudo {
  casoId: string;
  identificador: string;
  paciente: string;
  cliente: string;
  veterinario: string | null;
  patologista: string | null;
  status: string;
  liberadoEm: string | null;
  versao: number;
  entradaEm: string;
  trecho: string | null;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function ArquivoDeLaudos() {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ResultadoLaudo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  // Busca ao parar de digitar; menos de 2 letras nao vale a viagem.
  useEffect(() => {
    const q = termo.trim();
    if (q.length < 2) {
      setResultados(null);
      return;
    }
    const alarme = setTimeout(() => {
      setBuscando(true);
      setErro(null);
      api
        .get<ResultadoLaudo[]>(`/laudos/busca?q=${encodeURIComponent(q)}`)
        .then(setResultados)
        .catch((err) =>
          setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível buscar.'),
        )
        .finally(() => setBuscando(false));
    }, 350);
    return () => clearTimeout(alarme);
  }, [termo]);

  return (
    <Box component="section" sx={{ maxWidth: 980 }}>
      <Typography variant="h2">Arquivo de laudos</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2.5 }}>
        Paciente, cliente, veterinário, patologista, palavra do laudo, lâmina ou OS — tudo pela
        mesma caixa.
      </Typography>

      <TextField
        fullWidth
        autoFocus
        placeholder="Ex.: carcinoma, Thor, CV-000342/26, OS-2026-000012…"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Buscar no arquivo de laudos' } }}
        sx={{ mb: 2 }}
      />

      {erro && <Alert severity="error">{erro}</Alert>}

      {resultados && resultados.length === 0 && !buscando && (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Nenhum laudo com “{termo.trim()}”.
        </Typography>
      )}

      {resultados && resultados.length > 0 && (
        <Card sx={{ p: 0 }}>
          <Stack divider={<Divider flexItem />}>
            {resultados.map((r) => (
              <Box
                key={r.casoId}
                component={Link}
                to={`/casos/${r.casoId}/laudo`}
                sx={{
                  display: 'block',
                  px: 2.5,
                  py: 1.5,
                  textDecoration: 'none',
                  color: 'inherit',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'primary.main' }}>
                    {r.identificador}
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{r.paciente}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{r.cliente}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={r.liberadoEm ? 'success' : 'default'}
                    label={
                      r.liberadoEm
                        ? `liberado ${new Date(r.liberadoEm).toLocaleDateString('pt-BR')}`
                        : r.status.replaceAll('_', ' ')
                    }
                  />
                  {r.versao > 1 && <Chip size="small" variant="outlined" label={`v${r.versao}`} />}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {[r.patologista ? `laudo: ${r.patologista}` : null, r.veterinario ? `solicitante ${r.veterinario}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                {r.trecho && (
                  <Typography sx={{ fontSize: 12.5, mt: 0.5, fontStyle: 'italic' }}>{r.trecho}</Typography>
                )}
              </Box>
            ))}
          </Stack>
        </Card>
      )}
    </Box>
  );
}
