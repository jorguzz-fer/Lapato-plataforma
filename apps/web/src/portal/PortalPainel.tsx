import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { api, type PainelPortal } from '../api';

/**
 * M04 secao 9 - painel do cliente.
 *
 * A ordem dos numeros nao e decorativa: primeiro o que espera ACAO DELE
 * (pendencias), depois o que ele quer buscar (laudos), depois o resto. Um
 * painel que abre com "12 exames em andamento" e bonito e inutil; abrir com
 * "1 informacao pendente" e o que evita o telefonema (secao 86).
 */

const CARTOES = [
  {
    chave: 'pendenciasAguardandoVoce' as const,
    rotulo: 'Aguardando você',
    detalhe: 'Informações que o laboratório pediu',
    destino: '/portal/exames',
    destaque: true,
  },
  {
    chave: 'laudosLiberados' as const,
    rotulo: 'Laudos liberados',
    detalhe: 'Prontos para consulta e download',
    destino: '/portal/exames?situacao=liberados',
  },
  {
    chave: 'examesEmAndamento' as const,
    rotulo: 'Exames em andamento',
    detalhe: 'Ainda em análise no laboratório',
    destino: '/portal/exames?situacao=andamento',
  },
  {
    chave: 'solicitacoesAbertas' as const,
    rotulo: 'Solicitações abertas',
    detalhe: 'Pedidos em análise pelo laboratório',
    destino: '/portal/solicitacoes',
  },
];

export function PortalPainel() {
  const [dados, setDados] = useState<PainelPortal | null>(null);

  useEffect(() => {
    api.get<PainelPortal>('/portal/painel').then(setDados).catch(() => setDados(null));
  }, []);

  if (!dados) {
    return <Skeleton variant="rounded" height={220} />;
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h3" sx={{ mb: 0.5 }}>
          {dados.cliente}
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
          Acompanhe seus exames, consulte laudos e envie informações sem precisar ligar
          para o laboratório.
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        {CARTOES.map((c) => {
          const valor = dados[c.chave];
          const chama = c.destaque && valor > 0;
          return (
            <Card
              key={c.chave}
              component={Link}
              to={c.destino}
              sx={{
                p: 2.5,
                textDecoration: 'none',
                display: 'block',
                borderTop: '3px solid',
                borderColor: chama ? 'warning.main' : 'transparent',
              }}
            >
              <Typography
                sx={{
                  fontSize: 34,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: chama ? 'warning.main' : 'text.primary',
                }}
              >
                {valor}
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 600, mt: 0.5 }}>
                {c.rotulo}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                {c.detalhe}
              </Typography>
            </Card>
          );
        })}
      </Box>

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
        <Button component={Link} to="/portal/exames" variant="contained">
          Consultar exames
        </Button>
        <Button component={Link} to="/portal/exames?situacao=liberados" variant="outlined">
          Ver laudos liberados
        </Button>
      </Stack>
    </Stack>
  );
}
