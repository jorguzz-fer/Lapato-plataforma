/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API. Em produção o Caddy serve front e API no mesmo host. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
