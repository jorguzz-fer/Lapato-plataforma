import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  STATUS_ORDEM_LABEL,
  STATUS_ORDEM_SERVICO,
  formatarReais,
  type StatusOrdemServico,
} from '@lapato/shared';
import { api } from '../../api';

/**
 * M20 (parcial) - fila de Ordens de Servico.
 *
 * A fila que a review descreveu: "a pessoa pega a OS que foi gerada no
 * inicio, verifica se foi tudo feito, da ok, vai pra despacho, e a partir
 * desse momento ja pode ir pra fatura". Os filtros seguem esses momentos.
 * Clicar leva ao dossie do caso, onde a aba da OS mostra itens e acoes.
 */

interface LinhaOrdem {
  id: string;
  identificador: string;
  status: StatusOrdemServico;
  criadoEm: string;
  casoId: string;
  casoIdentificador: string;
  clienteNome: string;
  total: string;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function OrdensDeServico() {
  const [parametros, setParametros] = useSearchParams();
  const navegar = useNavigate();
  const filtro = (parametros.get('status') ?? '') as StatusOrdemServico | '';

  const [ordens, setOrdens] = useState<LinhaOrdem[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setCarregado(false);
    api
      .get<LinhaOrdem[]>(`/ordens${filtro ? `?status=${filtro}` : ''}`)
      .then(setOrdens)
      .catch(() => setErro('Não foi possível carregar as ordens.'))
      .finally(() => setCarregado(true));
  }, [filtro]);

  useEffect(carregar, [carregar]);

  return (
    <Box>
      <Typography component="h1" sx={{ fontSize: 20, fontWeight: 700 }}>
        Ordens de Serviço
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        A OS nasce na conferência do recebimento e é o que vira fatura — conferir a saída e
        despachar acontecem aqui ou no dossiê do caso.
      </Typography>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label="Todas"
          color={filtro === '' ? 'primary' : 'default'}
          onClick={() => setParametros({}, { replace: true })}
        />
        {STATUS_ORDEM_SERVICO.map((s) => (
          <Chip
            key={s}
            size="small"
            label={STATUS_ORDEM_LABEL[s]}
            color={filtro === s ? 'primary' : 'default'}
            onClick={() => setParametros({ status: s }, { replace: true })}
          />
        ))}
      </Stack>

      {!carregado && <Skeleton variant="rounded" height={220} />}

      {carregado && ordens.length === 0 && (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Nenhuma ordem {filtro ? `com status "${STATUS_ORDEM_LABEL[filtro]}"` : 'registrada'}.
        </Typography>
      )}

      <Stack spacing={1}>
        {ordens.map((o) => (
          <Card
            key={o.id}
            sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            onClick={() => navegar(`/casos/${o.casoId}?aba=os`)}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ justifyContent: 'space-between', gap: 1 }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ ...MONO, fontSize: 13.5, fontWeight: 700, color: 'primary.main' }}>
                    {o.identificador}
                  </Typography>
                  <Chip size="small" variant="outlined" label={STATUS_ORDEM_LABEL[o.status]} />
                </Stack>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                  Caso {o.casoIdentificador} · {o.clienteNome} ·{' '}
                  {new Date(o.criadoEm).toLocaleDateString('pt-BR')}
                </Typography>
              </Box>
              <Typography sx={{ ...MONO, fontSize: 15, fontWeight: 700, alignSelf: 'center' }}>
                {formatarReais(o.total)}
              </Typography>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
