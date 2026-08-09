import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * Em desenvolvimento o front chama `/api` no proprio host e o Vite
     * repassa para a API. Isso mantem o cookie de sessao como same-site,
     * igual ao que acontece em producao atras do Caddy - evitando que o
     * ambiente de dev precise de uma configuracao de CORS mais frouxa.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
