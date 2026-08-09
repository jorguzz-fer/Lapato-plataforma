import type { Config } from 'drizzle-kit';

export default {
  /**
   * Aponta para o schema COMPILADO, nao para o fonte.
   *
   * O drizzle-kit carrega o schema em CommonJS e nao resolve os sufixos `.js`
   * que o TypeScript ESM (NodeNext) exige nos imports relativos. Gerar a partir
   * do `dist` evita ter que abrir mao do NodeNext no resto do pacote.
   * Por isso `generate` depende de `build` (ver package.json).
   */
  schema: './dist/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations rodam com o usuario dono do schema, nao com o da aplicacao.
    url: process.env.DATABASE_MIGRATION_URL ?? 'postgres://lapato_owner:lapato@localhost:5432/lapato',
  },
  verbose: true,
  strict: true,
} satisfies Config;
