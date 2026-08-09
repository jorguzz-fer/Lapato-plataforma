import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * A API precisa do SWC no runner, e nao do esbuild padrao do Vitest.
 *
 * O NestJS resolve dependencias por `design:paramtypes`, metadado que o
 * TypeScript emite com `emitDecoratorMetadata`. O esbuild nao implementa essa
 * emissao, entao os construtores chegam sem tipos e a injecao falha em tempo de
 * execucao com "Cannot read properties of undefined" - mesmo com o `tsc` do
 * build passando sem erro.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Testes de integracao sobem a aplicacao e falam com o Postgres.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Compartilham o mesmo banco: rodar em paralelo geraria interferencia.
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
