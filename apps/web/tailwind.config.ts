import type { Config } from 'tailwindcss';
import { presetTailwind } from '@lapato/design-tokens';

/**
 * O tema vem de `@lapato/design-tokens` (ADR 0006). Nenhuma cor ou metrica
 * literal deve aparecer nas telas: trocar a identidade visual precisa custar
 * um arquivo, nao uma varredura pelo front.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-tema="escuro"]'],
  theme: presetTailwind.theme,
  plugins: [],
} satisfies Config;
