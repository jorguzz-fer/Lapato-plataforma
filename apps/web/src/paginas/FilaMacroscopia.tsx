import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { IndicadorPrazo } from '@lapato/ui';
import { api, ErroApi, type CasoNaFila } from '../api';

/**
 * Fila da macroscopia (documento do Hugo): "ao clicar, abre-se a listagem de
 * exames aptos a macroscopia, do mais antigo para o mais recente", com busca
 * por paciente, responsavel e cliente, e a bipagem do pote abrindo direto na
 * ficha. A ordem vem do servidor pela data de entrada - e a ordem em que a
 * bancada deve pegar os potes.
 */
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function FilaMacroscopia() {
  const navegar = useNavigate();
  const [casos, setCasos] = useState<CasoNaFila[] | null>(null);
  const [busca, setBusca] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const q = busca.trim();
    const alca = setTimeout(() => {
      const consulta = new URLSearchParams({ etapa: 'aguardando_macroscopia,em_macroscopia' });
      if (q.length >= 2) consulta.set('q', q);
      api
        .get<CasoNaFila[]>(`/fluxo/casos?${consulta.toString()}`)
        .then(setCasos)
        .catch(() => setErro('Não foi possível carregar a fila.'));
    }, 250);
    return () => clearTimeout(alca);
  }, [busca]);

  async function bipar() {
    if (codigo.trim().length < 3) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ casoId: string }>('/casos/resolver-codigo', {
        codigo: codigo.trim(),
      });
      setCodigo('');
      navegar(`/casos/${r.casoId}/macroscopia`);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível localizar a etiqueta.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Macroscopia
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Aptos à bancada, do mais antigo para o mais recente. Bipe a etiqueta do pote para abrir a
        ficha direto.
      </Typography>

      <Card sx={{ p: 2, mb: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Stack direction="row" spacing={1} sx={{ flex: 1, width: '100%' }}>
            <TextField
              size="small"
              placeholder="CV-000342/26-F01"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void bipar();
              }}
              slotProps={{
                htmlInput: { 'aria-label': 'Código da etiqueta', style: MONO },
              }}
              sx={{ flex: 1, maxWidth: 320 }}
              autoFocus
            />
            <Button
              variant="contained"
              size="small"
              disabled={ocupado || codigo.trim().length < 3}
              onClick={() => void bipar()}
              sx={{ height: 40 }}
            >
              Abrir ficha
            </Button>
          </Stack>
          <TextField
            size="small"
            label="Buscar por paciente, responsável, cliente ou registro"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            sx={{ flex: 1.4, width: '100%' }}
          />
        </Stack>
        {erro && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {erro}
          </Alert>
        )}
      </Card>

      {casos === null ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={72} />
          ))}
        </Stack>
      ) : casos.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 600 }}>Nada aguardando macroscopia</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            {busca.trim() ? 'Nenhum caso com esse termo.' : 'A fila está vazia.'}
          </Typography>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {casos.length} {casos.length === 1 ? 'caso' : 'casos'} na fila
          </Typography>
          {casos.map((c, i) => (
            <Card
              key={c.casoId}
              component={Link}
              to={`/casos/${c.casoId}/macroscopia`}
              sx={{
                p: 2,
                display: 'block',
                textDecoration: 'none',
                color: 'inherit',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                <Typography sx={{ ...MONO, fontSize: 12.5, color: 'text.secondary', width: 28 }}>
                  {String(i + 1).padStart(2, '0')}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 700, color: 'primary.main' }}>
                      {c.identificador}
                    </Typography>
                    {c.bloqueado && <Chip size="small" color="error" label="bloqueado" />}
                    {c.prioridade !== 'rotina' && (
                      <Chip size="small" variant="outlined" color="warning" label={c.prioridade} />
                    )}
                  </Stack>
                  <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{c.paciente}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                    {[
                      c.responsavel ? `Responsável: ${c.responsavel}` : null,
                      c.modalidade === 'particular' ? 'Particular' : c.cliente,
                      c.servico,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: { sm: 'right' } }}>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Entrada</Typography>
                  <Typography sx={{ fontSize: 13 }}>
                    {new Date(c.entradaEm).toLocaleDateString('pt-BR')}
                  </Typography>
                  <IndicadorPrazo estado={c.alertaPrazo} previsao={c.previsaoLiberacao} />
                </Box>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
