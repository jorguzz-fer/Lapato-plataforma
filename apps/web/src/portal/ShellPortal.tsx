import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DarkMode from '@mui/icons-material/DarkModeOutlined';
import LightMode from '@mui/icons-material/LightModeOutlined';
import Logout from '@mui/icons-material/LogoutOutlined';
import { useTema } from '@lapato/ui';

/**
 * Layout do Portal do Cliente (M04).
 *
 * Deliberadamente OUTRO shell, e nao o interno com menos itens. O modulo e
 * explicito na secao 55: "o Portal nao devera reproduzir a complexidade do
 * sistema interno". Quem entra aqui e um veterinario no meio de um atendimento,
 * frequentemente no celular (secao 54) - a navegacao inteira cabe em tres
 * itens, e nao ha painel de Copiloto, fila de trabalho nem etapa tecnica.
 */

const ITENS = [
  { para: '/portal', rotulo: 'Início', exato: true },
  { para: '/portal/exames', rotulo: 'Exames' },
  { para: '/portal/solicitacoes', rotulo: 'Solicitações' },
];

export function ShellPortal({ aoSair, children }: { aoSair: () => void; children: ReactNode }) {
  const { pathname } = useLocation();
  const { modo, alternar } = useTema();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="header"
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container maxWidth="lg">
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1.5, gap: 2 }}
          >
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              {/* Respaldo claro fixo: a arte e traco preto sobre transparencia. */}
              <Box
                sx={{
                  backgroundColor: '#eef0f3',
                  borderRadius: 1,
                  px: 1,
                  py: 0.25,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Box component="img" src="/logo.webp" alt="LAPATO" sx={{ height: 32 }} />
              </Box>
              {/* O nome da instituição aparece no painel, não aqui: a conta do
                  Portal pertence a um cliente só, e repeti-lo em toda tela
                  gastaria a barra estreita do celular (§54). */}
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                Portal do Cliente
              </Typography>
            </Stack>

            <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={modo === 'escuro' ? 'Tema claro' : 'Tema escuro'}>
                <IconButton onClick={alternar} aria-label="Alternar tema">
                  {modo === 'escuro' ? <LightMode /> : <DarkMode />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Sair">
                <IconButton onClick={aoSair} aria-label="Sair">
                  <Logout />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <Stack direction="row" sx={{ gap: 0.5, overflowX: 'auto' }}>
            {ITENS.map((i) => {
              const ativo = i.exato ? pathname === i.para : pathname.startsWith(i.para);
              return (
                <Button
                  key={i.para}
                  component={Link}
                  to={i.para}
                  sx={{
                    fontSize: 14,
                    px: 1.5,
                    borderRadius: 0,
                    borderBottom: '2px solid',
                    borderColor: ativo ? 'primary.main' : 'transparent',
                    color: ativo ? 'primary.main' : 'text.primary',
                    fontWeight: ativo ? 700 : 500,
                  }}
                >
                  {i.rotulo}
                </Button>
              );
            })}
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        {children}
      </Container>
    </Box>
  );
}
