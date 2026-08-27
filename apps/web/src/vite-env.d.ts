/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API. Em produção o Caddy serve front e API no mesmo host. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Slug da instituicao quando o produto opera com um tenant so. Definido,
   * esconde o campo "Instituição" do login. Vazio, o campo volta.
   */
  readonly VITE_INSTITUICAO_PADRAO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
