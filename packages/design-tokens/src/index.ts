/**
 * Design tokens do LAPATO.
 *
 * ADR 0006: a identidade visual vem do template Taplox, extraida de
 * `Admin/src/assets/scss/config/_variables.scss` e `_theme-mode.scss`. O
 * template em si (HTML, Bootstrap, SCSS, assets) NAO entra no repositorio - so
 * estes valores, reconstruidos sobre React + Tailwind conforme o Blueprint
 * secoes 2 e 9.
 *
 * Trocar a identidade visual do produto passa a custar alterar este arquivo, e
 * nao as telas.
 */

export const cores = {
  /** Escala de cinzas do Taplox. */
  cinza: {
    50: '#ffffff',
    100: '#f8f9fa',
    200: '#eef2f7',
    300: '#d8dfe7',
    400: '#b0b0bb',
    500: '#8486a7',
    600: '#687d92',
    700: '#424e5a',
    800: '#36404a',
    900: '#21252e',
  },

  /** Paleta de marca. */
  azul: '#1a80f8',
  indigo: '#53389f',
  roxo: '#7942ed',
  rosa: '#ff86c8',
  vermelho: '#f42557',
  laranja: '#f0934e',
  amarelo: '#f4c006',
  verde: '#17c553',
  ciano: '#63b7e6',
} as const;

/**
 * Cores semanticas.
 *
 * Os quatro niveis de intervencao da IA (M17 secao 11) precisam de padrao visual
 * consistente em todo o sistema, e por isso ganham token proprio em vez de cada
 * tela escolher uma cor.
 */
export const semanticas = {
  primaria: cores.azul,
  sucesso: cores.verde,
  atencao: cores.laranja,
  perigo: cores.vermelho,
  info: cores.roxo,

  // M17: informacao | sugestao | atencao | critico
  iaInformacao: cores.ciano,
  iaSugestao: cores.roxo,
  iaAtencao: cores.laranja,
  iaCritico: cores.vermelho,
} as const;

/** Metricas de layout do Taplox. */
export const layout = {
  sidebarLargura: '250px',
  sidebarLarguraCompacta: '75px',
  topbarAltura: '70px',
  rodapeAltura: '60px',
  /**
   * M17 secao 8: o painel do Copiloto ocupa ~30% da tela e a area de trabalho
   * ~70%. E requisito de produto, nao preferencia de layout - por isso vive nos
   * tokens.
   */
  copilotoLargura: '30%',
  trabalhoLargura: '70%',
} as const;

export const tipografia = {
  familia: "'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif",
  familiaMono: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
  tamanhos: {
    xs: '0.75rem',
    sm: '0.8125rem',
    base: '0.875rem',
    lg: '1rem',
    xl: '1.125rem',
    '2xl': '1.375rem',
    '3xl': '1.75rem',
  },
} as const;

export const raios = {
  sm: '0.25rem',
  base: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
} as const;

export const sombras = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  base: '0 2px 4px rgb(15 34 58 / 0.12)',
  md: '0 4px 12px rgb(15 34 58 / 0.15)',
  lg: '0 8px 24px rgb(15 34 58 / 0.18)',
} as const;

/** Preset do Tailwind, para o `tailwind.config` do front consumir. */
export const presetTailwind = {
  theme: {
    extend: {
      colors: {
        cinza: cores.cinza,
        primaria: {
          DEFAULT: semanticas.primaria,
          claro: '#e8f1fe',
        },
        sucesso: semanticas.sucesso,
        atencao: semanticas.atencao,
        perigo: semanticas.perigo,
        info: semanticas.info,
        ia: {
          informacao: semanticas.iaInformacao,
          sugestao: semanticas.iaSugestao,
          atencao: semanticas.iaAtencao,
          critico: semanticas.iaCritico,
        },
      },
      fontFamily: {
        sans: [tipografia.familia],
        mono: [tipografia.familiaMono],
      },
      fontSize: tipografia.tamanhos,
      borderRadius: raios,
      boxShadow: sombras,
      spacing: {
        sidebar: layout.sidebarLargura,
        'sidebar-sm': layout.sidebarLarguraCompacta,
        topbar: layout.topbarAltura,
      },
    },
  },
};
