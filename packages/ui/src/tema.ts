import { createTheme, type Theme } from '@mui/material/styles';
import {
  cinza,
  marca,
  raio,
  sombra,
  superficie,
  tipografia,
} from '@lapato/design-tokens';

/**
 * Tema do MUI, montado a partir de `@lapato/design-tokens` (ADR 0008).
 *
 * Nenhum valor literal aqui: cor, raio e tipografia vem dos tokens. A regra
 * existe para que trocar a identidade visual seja uma alteracao em um arquivo,
 * e nao uma caca a hexadecimais espalhados por componentes.
 */

declare module '@mui/material/styles' {
  interface Palette {
    laranja: Palette['primary'];
    roxo: Palette['primary'];
  }
  interface PaletteOptions {
    laranja?: PaletteOptions['primary'];
    roxo?: PaletteOptions['primary'];
  }
}

function criarTema(modo: 'light' | 'dark'): Theme {
  const s = modo === 'light' ? superficie.claro : superficie.escuro;

  return createTheme({
    palette: {
      mode: modo,
      background: { default: s.fundo, paper: s.papel },
      text: { primary: s.texto, secondary: s.textoSuave },
      divider: s.borda,
      primary: marca.primaria,
      secondary: marca.secundaria,
      success: marca.sucesso,
      warning: marca.atencao,
      error: marca.perigo,
      info: marca.info,
      laranja: marca.laranja,
      roxo: marca.roxo,
      grey: cinza,
    },

    typography: {
      fontFamily: tipografia.familia,
      // Base apertada: painel operacional, nao pagina institucional.
      fontSize: tipografia.base,
      h1: { fontSize: '24px', fontWeight: tipografia.pesos.forteMais },
      h2: { fontSize: '20px', fontWeight: tipografia.pesos.forteMais },
      h3: { fontSize: '18px', fontWeight: tipografia.pesos.forteMais },
      h4: { fontSize: '16px', fontWeight: tipografia.pesos.forte },
      h5: { fontSize: '15px', fontWeight: tipografia.pesos.forte },
      h6: { fontSize: '14px', fontWeight: tipografia.pesos.forte },
      button: { textTransform: 'none', fontWeight: tipografia.pesos.forte },
    },

    shape: { borderRadius: raio.medio },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          /**
           * Blueprint secao 15: foco sempre visivel. O laboratorio opera muito
           * por teclado, com leitor de codigo de barras entre as maos - e o
           * anel de foco e o unico jeito de saber onde a leitura vai cair.
           */
          '*:focus-visible': {
            outline: `2px solid ${marca.primaria.main}`,
            outlineOffset: 2,
          },
          body: { WebkitFontSmoothing: 'antialiased' },
        },
      },

      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: raio.cartao,
            boxShadow: sombra.cartao,
            backgroundImage: 'none',
          },
        },
      },

      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: raio.medio, padding: '9px 18px' },
          sizeSmall: { padding: '5px 12px' },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: { borderRadius: raio.pilula, fontWeight: tipografia.pesos.forte },
          sizeSmall: { height: 22, fontSize: '11px' },
        },
      },

      MuiTextField: { defaultProps: { size: 'small' } },

      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: raio.medio } },
      },

      MuiTableCell: {
        styleOverrides: {
          root: { padding: '12px 16px', borderColor: s.borda },
          head: {
            fontWeight: tipografia.pesos.forte,
            color: s.textoSuave,
            backgroundColor: modo === 'light' ? cinza[50] : s.fundo,
            whiteSpace: 'nowrap',
          },
        },
      },

      // A densidade da navegacao mora aqui, e nao repetida em cada item: assim
      // ajustar a escala do menu inteiro e uma linha.
      MuiListItemText: {
        styleOverrides: { primary: { fontSize: 13.5 } },
      },

      MuiTooltip: {
        defaultProps: { arrow: true },
      },
    },
  });
}

export const temaClaro = criarTema('light');
export const temaEscuro = criarTema('dark');
