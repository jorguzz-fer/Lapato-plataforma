import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AutoAwesome from '@mui/icons-material/AutoAwesomeOutlined';
import DarkMode from '@mui/icons-material/DarkModeOutlined';
import LightMode from '@mui/icons-material/LightModeOutlined';
import Logout from '@mui/icons-material/LogoutOutlined';
import MenuIcon from '@mui/icons-material/MenuOutlined';
import AddCircle from '@mui/icons-material/AddCircleOutlineOutlined';
import ViewList from '@mui/icons-material/ViewListOutlined';
import LocalShipping from '@mui/icons-material/LocalShippingOutlined';
import PendingActions from '@mui/icons-material/PendingActionsOutlined';
import Science from '@mui/icons-material/ScienceOutlined';
import Contacts from '@mui/icons-material/ContactsOutlined';
import Inventory2 from '@mui/icons-material/Inventory2Outlined';
import Tune from '@mui/icons-material/TuneOutlined';
import Group from '@mui/icons-material/GroupOutlined';
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
 * Layout em duas formas, e nao uma so encolhida:
 *
 * - **Telas largas (md+)**: sidebar fixa a esquerda e area de trabalho com a
 *   largura toda. O Copiloto flutua por cima quando aberto, sem tirar espaco
 *   dos dados - e so vira coluna de 30% se o usuario fixar (M17 secao 8).
 * - **Telas estreitas**: menu e Copiloto viram gavetas temporarias, abertas por
 *   botoes na barra superior. Espremer os tres em 375px daria 75px de area util -
 *   e foi o que aconteceu antes desta separacao existir.
 *
 * O M17 secao 8 pede que o painel possa ser "expandido, reduzido, recolhido,
 * fixado ou ocultado". A gaveta e a forma que "recolhido" assume onde nao ha
 * 30% de tela para ceder; o flutuante e a forma que o estado nao-fixado assume
 * onde ha.
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
  {
    /* M09: o lote é do dia e atravessa casos, então não mora dentro de um. */
    para: '/processamento',
    icone: <LocalShipping fontSize="small" />,
    rotulo: MODULO_LABEL[MODULOS.M09_PROCESSAMENTO],
    permissao: 'processamento:visualizar',
  },
  {
    /* M10: a demanda atravessa casos e setores - a fila é da instituição. */
    para: '/solicitacoes',
    icone: <PendingActions fontSize="small" />,
    rotulo: MODULO_LABEL[MODULOS.M10_SOLICITACOES],
    permissao: 'solicitacao:visualizar',
  },
  {
    /* M15: a fila é física e atravessa casos - quem está na câmara agora. */
    para: '/cadaveres',
    icone: <Inventory2 fontSize="small" />,
    rotulo: MODULO_LABEL[MODULOS.M15_CADAVERES],
    permissao: 'cadaver:visualizar',
  },
  {
    /* M18: o acervo atravessa casos e anos - "onde está o bloco A3" não mora
       dentro de um caso, mora no armário. */
    para: '/bioteca',
    icone: <Science fontSize="small" />,
    rotulo: MODULO_LABEL[MODULOS.M18_BIOTECA],
    permissao: 'bioteca:visualizar',
  },
  {
    /* M03: fonte única dos dados cadastrais - o degrau zero de qualquer caso. */
    para: '/clientes',
    icone: <Contacts fontSize="small" />,
    rotulo: 'Clientes e Veterinários',
    permissao: 'cliente:visualizar',
  },
  {
    /* M01: o fluxo é configurado em dados - serviços, tabelas, calendário. */
    para: '/administracao',
    icone: <Tune fontSize="small" />,
    rotulo: 'Administração',
    permissao: 'config:visualizar',
  },
  {
    /* M02: ciclo de vida das contas - a autorização em si é do servidor. */
    para: '/usuarios',
    icone: <Group fontSize="small" />,
    rotulo: 'Usuários e Perfis',
    permissao: 'usuario:visualizar',
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
  const { modo, alternar } = useTema();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('md'));

  const [menuAberto, setMenuAberto] = useState(false);
  /**
   * O Copiloto nasce fechado, em qualquer largura. Ele assiste o trabalho: abrir
   * sozinho por cima da tabela de casos seria cobrar espaco antes de ter o que
   * dizer. A aba lateral fica visivel com a contagem de apontamentos, que e o
   * convite para abrir quando ha motivo.
   */
  const [copilotoAberto, setCopilotoAberto] = useState(false);

  /** Ao estreitar a janela, a gaveta fecha em vez de cobrir o trabalho. */
  useEffect(() => {
    if (estreito) setCopilotoAberto(false);
  }, [estreito]);

  /** Navegar fecha o menu: numa gaveta temporaria, ele cobriria a tela nova. */
  useEffect(() => {
    setMenuAberto(false);
  }, [pathname]);

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
   * O item ativo sai do caminho da URL: `selected` do MUI ja carrega o estado
   * visual e o `aria-selected`.
   */
  const ativo = (para: string) => pathname === para;

  const navegacao = (
    <Box sx={{ p: 1.5 }}>
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
            <ListItemText primary={item.rotulo} />
          </ListItemButton>
        ))}
      </List>

      <Divider sx={{ my: 1.5 }} />

      <Typography sx={{ px: 2, pb: 0.5, fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>
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
          /* Blueprint seção 6: oferecer o segundo fator a quem ainda não tem,
             mesmo quando o perfil não o torna obrigatório. */
          <ListItemButton
            component={Link}
            to="/conta/mfa"
            selected={ativo('/conta/mfa')}
            sx={itemSx}
          >
            <ListItemIcon sx={{ minWidth: 34 }}>
              <Security fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Ativar 2 etapas" />
          </ListItemButton>
        )}
      </List>

      {sessao.exigeSupervisao && (
        /* M02/M11: o perfil em supervisão precisa saber disso o tempo todo. */
        <Alert severity="info" sx={{ mt: 2, fontSize: 11.5 }}>
          Perfil sob supervisão: elaboração permitida; assinatura e liberação exigem responsável.
        </Alert>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <Stack
        component="header"
        direction="row"
        sx={{
          height: `${shell.topbarAltura}px`,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 1.5, md: 3 },
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          {estreito && (
            <IconButton
              onClick={() => setMenuAberto(true)}
              aria-label="Abrir menu"
              // `aria-expanded` porque o botão controla uma gaveta, não navega.
              aria-expanded={menuAberto}
              size="small"
            >
              <MenuIcon />
            </IconButton>
          )}

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
          {estreito && (
            <Tooltip title="LAPATO Copiloto">
              <IconButton
                onClick={() => setCopilotoAberto(true)}
                aria-label="Abrir painel do Copiloto"
                aria-expanded={copilotoAberto}
                size="small"
              >
                {/* O badge dá o motivo de abrir: há apontamento esperando. */}
                <Badge badgeContent={cartoes?.length ?? 0} color="primary">
                  <AutoAwesome fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
          )}

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
        {estreito ? (
          <Drawer
            open={menuAberto}
            onClose={() => setMenuAberto(false)}
            // `keepMounted` melhora o tempo de abertura em aparelho modesto.
            ModalProps={{ keepMounted: true }}
            slotProps={{ paper: { sx: { width: shell.sidebarLargura } } }}
          >
            <Box component="nav" aria-label="Navegação principal">
              {navegacao}
            </Box>
          </Drawer>
        ) : (
          <Box
            component="nav"
            aria-label="Navegação principal"
            sx={{
              width: `${shell.sidebarLargura}px`,
              flexShrink: 0,
              borderRight: '1px solid',
              borderColor: 'divider',
              backgroundColor: 'background.paper',
              overflowY: 'auto',
            }}
          >
            {navegacao}
          </Box>
        )}

        <Box
          component="main"
          sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: { xs: 2, md: 3 } }}
        >
          {children}
        </Box>

        <PainelCopiloto
          modulo={modulo}
          etapa={etapa}
          cartoes={cartoes}
          estreito={estreito}
          aberto={copilotoAberto}
          onAlternar={() => setCopilotoAberto((v) => !v)}
        />
      </Box>
    </Box>
  );
}
