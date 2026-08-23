/**
 * Design tokens do LAPATO.
 *
 * ADR 0008: a linguagem visual vem do template Trezo (Next.js + Material UI),
 * que o dono do produto licenciou. O codigo do template NAO entra neste
 * repositorio - so estes valores, dos quais `@lapato/ui` monta o tema do MUI.
 *
 * A direcao importa: os tokens alimentam o tema, nunca o contrario. E o que
 * mantem os valores de dominio - niveis de intervencao da IA, estados de prazo -
 * fora do alcance de uma atualizacao do template.
 *
 * Trocar a identidade visual do produto passa a custar alterar este arquivo, e
 * nao as telas.
 */

/** Escala de cinzas. Base `#F6F7F9` para fundo de aplicacao. */
export const cinza = {
  50: '#f6f7f9',
  100: '#eceef2',
  200: '#e2e5ea',
  300: '#b1bbc8',
  400: '#9497aa',
  500: '#64748b',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#111827',
} as const;

/**
 * Paleta de marca (Trezo).
 *
 * Cada cor traz a escala usada em fundo suave (50/100), no elemento (500/main)
 * e no estado ativo (600/700). Sem essa escala, cada tela inventaria o proprio
 * tom de fundo para um alerta - foi o que produziu o visual inconsistente antes.
 */
export const marca = {
  primaria: {
    50: '#ecf0ff',
    100: '#dde4ff',
    400: '#757dff',
    main: '#605dff',
    600: '#1f64f1',
    700: '#3e2ad8',
    800: '#3325ae',
  },
  secundaria: {
    100: '#daebff',
    main: '#3584fc',
  },
  sucesso: {
    50: '#eeffe5',
    100: '#d8ffc8',
    main: '#25b003',
    600: '#25b003',
    700: '#1e8308',
  },
  atencao: {
    50: '#fff8e1',
    100: '#fff3cd',
    main: '#ffc107',
    600: '#ffb300',
  },
  perigo: {
    50: '#ffe1dd',
    100: '#ffe8d4',
    main: '#ff4023',
    600: '#ec1f00',
    700: '#c52b09',
  },
  info: {
    100: '#daebff',
    main: '#0dcaf0',
  },
  laranja: {
    50: '#fff2f0',
    100: '#ffe8d4',
    main: '#fe7a36',
    600: '#ec1f00',
  },
  roxo: {
    50: '#faf5ff',
    100: '#f3e8ff',
    main: '#ad63f6',
    600: '#9135e8',
  },
} as const;

/**
 * M17 secao 11: os quatro niveis de intervencao da IA.
 *
 * Token proprio, e nao "use o amarelo", porque o nivel precisa de padrao visual
 * identico em toda tela onde o Copiloto aparece. Uma escolha por tela produziria
 * quatro amarelos diferentes e nenhum significado.
 */
export const nivelIa = {
  informacao: marca.info.main,
  sugestao: marca.roxo.main,
  atencao: marca.atencao.main,
  critico: marca.perigo.main,
} as const;

/**
 * M07: estados de prazo.
 *
 * O modulo exige que o estado seja perceptivel **sem depender de cor** - por
 * isso cada um carrega tambem um rotulo e um simbolo. Daltonismo nao pode
 * esconder um prazo estourado.
 */
export const estadoPrazo = {
  normal: { cor: marca.sucesso.main, fundo: marca.sucesso[50], rotulo: 'No prazo', simbolo: '●' },
  atencao: { cor: marca.atencao[600], fundo: marca.atencao[50], rotulo: 'Atenção', simbolo: '◐' },
  critico: { cor: marca.laranja.main, fundo: marca.laranja[50], rotulo: 'Crítico', simbolo: '◑' },
  atrasado: { cor: marca.perigo.main, fundo: marca.perigo[50], rotulo: 'Atrasado', simbolo: '▲' },
} as const;

export type EstadoPrazo = keyof typeof estadoPrazo;

/** Superficies, por tema. */
export const superficie = {
  claro: {
    fundo: cinza[50],
    papel: '#ffffff',
    borda: '#eceef2',
    texto: '#111827',
    textoSuave: cinza[500],
  },
  escuro: {
    fundo: '#15171c',
    papel: '#1c1f26',
    borda: '#2a2f3a',
    texto: '#f6f7f9',
    textoSuave: cinza[300],
  },
} as const;

/**
 * Tipografia.
 *
 * A base de 12.3px vem do Trezo e e deliberadamente apertada: e o que separa
 * um painel operacional de uma pagina institucional. Um patologista varre
 * dezenas de casos por dia, e cada pixel de entrelinha vira rolagem.
 */
export const tipografia = {
  familia: "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  base: 12.3,
  pesos: { normal: 400, medio: 500, forte: 600, forteMais: 700 },
} as const;

/** Raios. `pilula` para badges e status; `cartao` para superficies. */
export const raio = {
  pequeno: 4,
  medio: 6,
  cartao: 7,
  grande: 10,
  pilula: 100,
} as const;

/**
 * Elevacao.
 *
 * `cartao` e a sombra ampla e suave do Trezo - sugere profundidade sem desenhar
 * borda, o que mantem a tela leve mesmo com muitos cartoes lado a lado.
 */
export const sombra = {
  nenhuma: 'none',
  cartao: '0 4px 45px #0000001a',
  suspenso: 'rgba(149, 157, 165, 0.2) 0px 8px 24px',
} as const;

/** Metricas do shell (M17 secao 8: area de trabalho 70% / Copiloto 30%). */
export const shell = {
  sidebarLargura: 260,
  sidebarLarguraCompacta: 75,
  topbarAltura: 70,
  copilotoLargura: '30%',
} as const;

/** Espacamento padrao de conteudo de cartao, responsivo. */
export const espacamento = {
  cartao: { xs: '18px', sm: '20px', lg: '25px' },
  linhaDensa: '15px 20px',
} as const;
