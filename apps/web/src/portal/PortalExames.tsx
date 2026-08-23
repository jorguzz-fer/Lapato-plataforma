import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { STATUS_EXTERNO_LABEL, type StatusExterno } from '@lapato/shared';
import { api, type ExamePortal } from '../api';

/**
 * M04 secoes 11-17 - exames do cliente.
 *
 * A lista mostra o STATUS EXTERNO e a previsao, que sao as duas perguntas que
 * o cliente faz ao telefone. A busca aceita paciente, tutor e registro porque
 * e assim que ele lembra do exame - ninguem decora "CV-000342/26".
 */

const COR: Partial<Record<StatusExterno, 'default' | 'primary' | 'success' | 'warning'>> = {
  laudo_disponivel: 'success',
  aguardando_informacao: 'warning',
  em_analise_diagnostica: 'primary',
  em_revisao: 'primary',
};

export function PortalExames() {
  const [params, setParams] = useSearchParams();
  const situacao = params.get('situacao') ?? 'todos';

  const [busca, setBusca] = useState(params.get('q') ?? '');
  const [exames, setExames] = useState<ExamePortal[] | null>(null);

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (busca.trim()) q.set('q', busca.trim());
    if (situacao !== 'todos') q.set('situacao', situacao);

    api
      .get<ExamePortal[]>(`/portal/exames?${q.toString()}`)
      .then(setExames)
      .catch(() => setExames([]));
  }, [busca, situacao]);

  useEffect(() => {
    // Espera a digitação parar: a busca por paciente é curta e o usuário
    // costuma digitar o nome inteiro.
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar]);

  return (
    <Stack spacing={2.5}>
      <Typography variant="h3">Exames</Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Buscar por paciente, tutor ou registro"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="Situação"
          value={situacao}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value === 'todos') p.delete('situacao');
            else p.set('situacao', e.target.value);
            setParams(p, { replace: true });
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="todos">Todos</MenuItem>
          <MenuItem value="andamento">Em andamento</MenuItem>
          <MenuItem value="liberados">Com laudo liberado</MenuItem>
        </TextField>
      </Stack>

      {exames === null && <Skeleton variant="rounded" height={180} />}

      {exames?.length === 0 && (
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
          Nenhum exame encontrado.
        </Typography>
      )}

      <Stack spacing={1.5}>
        {exames?.map((e) => (
          <Card
            key={e.id}
            component={Link}
            to={`/portal/exames/${e.id}`}
            sx={{ p: 2.5, textDecoration: 'none', display: 'block' }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{ gap: 1.5, justifyContent: 'space-between', md: { alignItems: 'center' } }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{e.paciente}</Typography>
                  <Typography
                    sx={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12.5,
                      color: 'text.secondary',
                    }}
                  >
                    {e.identificador}
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  {[e.servico, e.tutor && `Tutor: ${e.tutor}`, e.veterinario]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>

              <Stack
                direction="row"
                sx={{ gap: 1.5, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}
              >
                {e.previsaoLiberacao && !e.laudoDisponivel && (
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                    Previsão: {new Date(e.previsaoLiberacao).toLocaleDateString('pt-BR')}
                  </Typography>
                )}
                <Chip
                  size="small"
                  color={COR[e.status] ?? 'default'}
                  label={STATUS_EXTERNO_LABEL[e.status] ?? e.status}
                />
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
