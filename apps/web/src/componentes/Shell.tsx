import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
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
import SpaceDashboard from '@mui/icons-material/SpaceDashboardOutlined';
import ManageSearch from '@mui/icons-material/ManageSearchOutlined';
import Colorize from '@mui/icons-material/ColorizeOutlined';
import PendingActions from '@mui/icons-material/PendingActionsOutlined';
import RequestQuoteOutlined from '@mui/icons-material/RequestQuoteOutlined';
import Science from '@mui/icons-material/ScienceOutlined';
import Contacts from '@mui/icons-material/ContactsOutlined';
import MedicalServices from '@mui/icons-material/MedicalServicesOutlined';
import Inventory2 from '@mui/icons-material/Inventory2Outlined';
import Settings from '@mui/icons-material/SettingsOutlined';
import Group from '@mui/icons-material/GroupOutlined';
import Password from '@mui/icons-material/PasswordOutlined';
import PersonOutline from '@mui/icons-material/PersonOutlineOutlined';
import Security from '@mui/icons-material/SecurityOutlined';
import { shell } from '@lapato/design-tokens';
import { MODULO_LABEL, MODULOS, iniciaisDe } from '@lapato/shared';
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
    /* A tela de chegada. Fica presa no topo do menu porque e para onde o
       usuario volta quando perde o fio - e a mesma permissao do Rastreio, ja
       que o painel e uma leitura do fluxo, nao um modulo novo. */
    para: '/painel',
    icone: <SpaceDashboard fontSize="small" />,
    rotulo: 'Painel',
    permissao: 'fluxo:visualizar',
  },
  {
    /**
     * Rotulos do menu sao curtos de proposito: eles competem por uma coluna
     * estreita, e o nome oficial do modulo ja aparece no cabecalho da tela.
     * "Rastreamento e Gestao de Fluxo" quebrava em tres linhas e empurrava o
     * resto do menu para fora da dobra.
     */
    para: '/casos',
    icone: <ManageSearch fontSize="small" />,
    rotulo: 'Rastreio',
    permissao: 'fluxo:visualizar',
  },
  {
    para: '/casos/novo',
    icone: <AddCircle fontSize="small" />,
    rotulo: 'Novo caso',
    permissao: 'caso:criar',
  },
  {
    /* M09: o lote é do dia e atravessa casos, então não mora dentro de um.
       A pipeta, e não o caminhão: o envio ao laboratório de apoio é o meio,
       mas o que o módulo produz são blocos e lâminas coradas. */
    para: '/processamento',
    icone: <Colorize fontSize="small" />,
    rotulo: 'Processamento',
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
    /* M20 (review): a fila da cobrança - conferir a saída e despachar. */
    para: '/ordens',
    icone: <RequestQuoteOutlined fontSize="small" />,
    rotulo: 'Ordens de Serviço',
    permissao: 'os:visualizar',
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
    rotulo: 'Bioteca',
    permissao: 'bioteca:visualizar',
  },
  {
    /* M03: fonte única dos dados cadastrais - o degrau zero de qualquer caso. */
    para: '/clientes',
    icone: <Contacts fontSize="small" />,
    rotulo: 'Clientes',
    permissao: 'cliente:visualizar',
  },
  {
    /* M03 seção 12: o veterinário é uma pessoa com N vínculos, e não um campo
       do cliente - o mesmo profissional atende por várias clínicas. Cadastro
       próprio, com permissão própria: quem vê cliente não vê necessariamente
       veterinário. */
    para: '/veterinarios',
    icone: <MedicalServices fontSize="small" />,
    rotulo: 'Veterinários',
    permissao: 'veterinario:visualizar',
  },
  {
    /* M01: o fluxo é configurado em dados - serviços, tabelas, calendário.
       "Configurações" diz melhor o que se faz ali do que "Administração", que
       se confundia com a gestão de contas logo abaixo. */
    para: '/administracao',
    icone: <Settings fontSize="small" />,
    rotulo: 'Configurações',
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
  const [menuConta, setMenuConta] = useState<HTMLElement | null>(null);

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

  const iniciais = iniciaisDe(sessao.nomeCompleto);
  /** Sem nome (API mais antiga durante um deploy), o avatar cai no genérico. */
  const nomeExibido = sessao.nomeCompleto?.trim() || 'Minha conta';

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

      {/* A conta saiu daqui para o avatar na barra superior: senha e segundo
          fator sao ajustes de quem esta logado, nao lugares do sistema, e
          misturados aos modulos disputavam a mesma leitura vertical. */}

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

          {/* A arte e transparente com traco preto, entao o respaldo claro e
              fixo de proposito: sem ele, o logo desaparece no tema escuro. */}
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
            <Box component="img" src="/logo.webp" alt="LAPATO" sx={{ height: 34 }} />
          </Box>
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

          {/* Conta: senha, segundo fator e saida moram aqui, no canto que todo
              sistema usa para isso - e nao no meio dos modulos. */}
          <Tooltip title={nomeExibido}>
            <IconButton
              onClick={(e) => setMenuConta(e.currentTarget)}
              size="small"
              aria-label="Conta"
              aria-haspopup="menu"
              aria-expanded={Boolean(menuConta)}
              sx={{ ml: 0.5 }}
            >
              <Avatar
                sx={{
                  width: 30,
                  height: 30,
                  fontSize: 12,
                  fontWeight: 600,
                  bgcolor: 'primary.main',
                }}
              >
                {iniciais || <PersonOutline sx={{ fontSize: 18 }} />}
              </Avatar>
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={menuConta}
            open={Boolean(menuConta)}
            onClose={() => setMenuConta(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { minWidth: 220 } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{nomeExibido}</Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                {sessao.exigeSupervisao ? 'Perfil sob supervisão' : 'Sessão ativa'}
              </Typography>
            </Box>

            <Divider />

            <MenuItem
              component={Link}
              to="/conta/senha"
              onClick={() => setMenuConta(null)}
              sx={{ fontSize: 13.5 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Password fontSize="small" />
              </ListItemIcon>
              Trocar senha
            </MenuItem>

            {!sessao.mfaAtivo && (
              /* Blueprint seção 6: oferecer o segundo fator a quem ainda não
                 tem, mesmo quando o perfil não o torna obrigatório. */
              <MenuItem
                component={Link}
                to="/conta/mfa"
                onClick={() => setMenuConta(null)}
                sx={{ fontSize: 13.5 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Security fontSize="small" />
                </ListItemIcon>
                Ativar 2 etapas
              </MenuItem>
            )}

            <Divider />

            <MenuItem
              onClick={() => {
                setMenuConta(null);
                void sair();
              }}
              sx={{ fontSize: 13.5 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Logout fontSize="small" />
              </ListItemIcon>
              Sair
            </MenuItem>
          </Menu>
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
