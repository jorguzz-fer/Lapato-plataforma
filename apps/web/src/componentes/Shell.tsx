import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DarkMode from '@mui/icons-material/DarkModeOutlined';
import LightMode from '@mui/icons-material/LightModeOutlined';
import Logout from '@mui/icons-material/LogoutOutlined';
import AddCircle from '@mui/icons-material/AddCircleOutlineOutlined';
import ViewList from '@mui/icons-material/ViewListOutlined';
import Password from '@mui/icons-material/PasswordOutlined';
import Security from '@mui/icons-material/SecurityOutlined';
import { shell } from '@lapato/design-tokens';
import { MODULO_LABEL, MODULOS } from '@lapato/shared';
import { useTema } from '@lapato/ui';
import { api, type Sessao } from '../api';
import { PainelCopiloto, type CartaoPainel } from './PainelCopiloto';

/**
 * Shell de navegacao.
 *
 * DIRETRIZES secao 15: navegacao POR CONTEXTO. O usuario nao deve abandonar o
 * caso para executar acoes relacionadas - por isso o painel do Copiloto e o
 * cabecalho do caso ficam no shell, e nao dentro de cada tela.
 *
 * Layout: ~70% area de trabalho / ~30% painel lateral (M17 secao 8).
 */

const MENU = [
  {
    para: '/casos',
    icone: <ViewList fontSize="small" />,
    rotulo: MODULO_LABEL[MODULOS.M07_RASTREAMENTO],
    permissao: 'fluxo:visualizar',
  },
  {
    para: '/casos/novo',
    icone: <AddCircle fontSize="small" />,
    rotulo: 'Novo caso',
    permissao: 'caso:criar',
  },
] as const;

interface Props {
  sessao: Sessao;
  /** Devolve o controle ao `App`, que zera o estagio e volta ao login. */
  aoSair: () => void;
  modulo: string;
  etapa?: string;
  cartoes?: CartaoPainel[];
  children: ReactNode;
}

export function Shell({ sessao, aoSair, modulo, etapa, cartoes, children }: Props) {
  const [painelRecolhido, setPainelRecolhido] = useState(false);
  const { modo, alternar } = useTema();
  const navegar = useNavigate();
  const { pathname } = useLocation();

  async function sair() {
    await api.post('/auth/logout');
    navegar('/entrar');
    // Só depois de navegar: zerar o estágio antes desmontaria esta tela no meio.
    aoSair();
  }

  const itemSx = {
    borderRadius: 1.5,
    mb: 0.25,
    '&.Mui-selected': {
      backgroundColor: 'primary.50',
      color: 'primary.main',
      '& .MuiListItemIcon-root': { color: 'primary.main' },
      '& .MuiListItemText-primary': { fontWeight: 600 },
    },
  };

  /**
   * O item ativo sai do caminho da URL, e nao do `NavLink`: `selected` do MUI ja
   * carrega o estado visual e o `aria-selected`, enquanto o `className` do
   * `NavLink` teria de ser reconciliado com as classes do proprio componente.
   */
  const ativo = (para: string) => pathname === para;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Stack
        component="header"
        direction="row"
        sx={{
          height: `${shell.topbarAltura}px`,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline' }}>
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: 'primary.main' }}>
            LAPATO
          </Typography>
          <Typography
            sx={{ fontSize: 12, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
          >
            Gestão Anatomopatológica Veterinária
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title={`Mudar para tema ${modo === 'claro' ? 'escuro' : 'claro'}`}>
            <IconButton onClick={alternar} size="small">
              {modo === 'claro' ? <DarkMode fontSize="small" /> : <LightMode fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Tooltip title="Sair">
            <IconButton onClick={sair} size="small" aria-label="Sair">
              <Logout fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box
          component="nav"
          aria-label="Navegação principal"
          sx={{
            width: `${shell.sidebarLargura}px`,
            flexShrink: 0,
            p: 1.5,
            display: { xs: 'none', md: 'block' },
            borderRight: '1px solid',
            borderColor: 'divider',
            backgroundColor: 'background.paper',
            overflowY: 'auto',
          }}
        >
          <List disablePadding>
            {MENU.filter((i) => sessao.permissoes.includes(i.permissao)).map((item) => (
              <ListItemButton
                key={item.para}
                component={Link}
                to={item.para}
                selected={ativo(item.para)}
                sx={itemSx}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>{item.icone}</ListItemIcon>
                <ListItemText
                  primary={item.rotulo}
                />
              </ListItemButton>
            ))}
          </List>

          <Divider sx={{ my: 1.5 }} />

          <Typography
            sx={{ px: 2, pb: 0.5, fontSize: 11, color: 'text.secondary', fontWeight: 600 }}
          >
            CONTA
          </Typography>

          <List disablePadding>
            <ListItemButton
              component={Link}
              to="/conta/senha"
              selected={ativo('/conta/senha')}
              sx={itemSx}
            >
              <ListItemIcon sx={{ minWidth: 34 }}>
                <Password fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Trocar senha" />
            </ListItemButton>

            {!sessao.mfaAtivo && (
              /* Blueprint seção 6: oferecer o segundo fator a quem ainda não
                 tem, mesmo quando o perfil não o torna obrigatório. */
              <ListItemButton
                component={Link}
                to="/conta/mfa"
                selected={ativo('/conta/mfa')}
                sx={itemSx}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <Security fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Ativar 2 etapas"
                />
              </ListItemButton>
            )}
          </List>

          {sessao.exigeSupervisao && (
            /* M02/M11: o perfil em supervisão precisa saber disso o tempo todo. */
            <Alert severity="info" sx={{ mt: 2, fontSize: 11.5 }}>
              Perfil sob supervisão: elaboração permitida; assinatura e liberação exigem
              responsável.
            </Alert>
          )}
        </Box>

        <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: 3 }}>
          {children}
        </Box>

        <PainelCopiloto
          modulo={modulo}
          etapa={etapa}
          cartoes={cartoes}
          recolhido={painelRecolhido}
          onAlternar={() => setPainelRecolhido((v) => !v)}
        />
      </Box>
    </Box>
  );
}
