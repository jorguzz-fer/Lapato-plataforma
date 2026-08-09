import { z } from 'zod';

/**
 * Configuracao por variavel de ambiente (12-factor, Blueprint secao 5).
 *
 * O schema valida na subida do processo: e melhor o container morrer imediato
 * com "SESSION_SECRET ausente" do que aceitar requests com sessao insegura.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1),

  /** Blueprint secao 6: segredo de 32 bytes; nunca versionado. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de ao menos 32 caracteres'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_COOKIE_NAME: z.string().default('lapato_session'),
  SESSION_COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  MFA_ISSUER: z.string().default('LAPATO'),

  /** M17 / ADR 0007: `stub` mantem o sistema funcionando sem LLM. */
  COPILOT_PROVIDER: z.enum(['stub', 'claude']).default('stub'),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function carregarEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const resultado = envSchema.safeParse(fonte);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuracao invalida:\n${problemas}`);
  }

  const env = resultado.data;

  // Em producao, cookie sem Secure significa sessao trafegando em claro.
  if (env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE) {
    throw new Error('Em producao SESSION_COOKIE_SECURE precisa ser true.');
  }

  if (env.COPILOT_PROVIDER === 'claude' && !env.ANTHROPIC_API_KEY) {
    throw new Error('COPILOT_PROVIDER=claude exige ANTHROPIC_API_KEY.');
  }

  return env;
}

export const ENV = Symbol('ENV');
