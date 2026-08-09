import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.js', '**/drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    /**
     * A API roda sobre NestJS, que resolve dependencias por `design:paramtypes`.
     *
     * `consistent-type-imports` transformaria em `import type` classes que sao
     * usadas apenas como tipo de parametro de construtor - e o TypeScript nao
     * emite metadado para import de tipo. O resultado seria injecao quebrando em
     * tempo de execucao, com o lint verde. Por isso a regra fica desligada aqui.
     */
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    /**
     * Testes falam com a API por HTTP e inspecionam JSON de resposta. Tipar cada
     * corpo de resposta duplicaria os contratos sem ganho - o valor do teste
     * esta em exercitar a API de fora, como um cliente real.
     */
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
