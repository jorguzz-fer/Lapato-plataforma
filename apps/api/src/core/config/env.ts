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
  /**
   * Prefixo das rotas, do ponto de vista do processo.
   *
   * O navegador sempre chama `/api/v1/...`. O que varia e quanto disso sobra
   * quando o request chega aqui: um proxy que roteia por caminho pode consumir
   * o `/api` antes de repassar. Coolify e Traefik fazem isso por padrao; o Caddy
   * do compose local nao faz.
   *
   * Padrao `api/v1` (nada e consumido). Com um proxy que remove o `/api`, use
   * `v1`. Errar isso da 404 em tudo - e o primeiro `curl` do runbook detecta.
   */
  API_GLOBAL_PREFIX: z.string().default('api/v1'),
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

  /**
   * Rate limiting (Blueprint secao 6, "Protecoes de fluxo").
   *
   * Complementa o lockout por conta, nao substitui: o lockout defende UMA conta
   * de muitas tentativas; o rate limit defende o SERVICO de um cliente que
   * dispara em volume - inclusive credential stuffing, que tenta uma senha em
   * milhares de contas diferentes e nunca chega ao limite de nenhuma delas.
   *
   * Contagem em memoria do processo. Com mais de uma replica cada uma tem seu
   * proprio balde e o limite efetivo multiplica pelo numero de replicas; quando
   * houver replica, isto passa a precisar do Redis que ja esta na stack.
   */
  RATE_LIMIT_JANELA_SEGUNDOS: z.coerce.number().int().positive().default(60),
  /** Teto geral por IP na janela. Generoso: navegar numa tela dispara varias chamadas. */
  RATE_LIMIT_REQUISICOES: z.coerce.number().int().positive().default(300),
  /** Teto por IP nas rotas de entrada (login, MFA, validacao publica de laudo). */
  RATE_LIMIT_LOGIN: z.coerce.number().int().positive().default(10),

  /**
   * Quantos proxies existem entre o cliente e este processo.
   *
   * Sem isto, `req.ip` e o IP do Traefik do Coolify - o mesmo para todo mundo.
   * Duas consequencias: o rate limit por IP viraria um balde unico compartilhado
   * (um usuario derruba todos), e o `audit_log` gravaria o IP do proxy no lugar
   * do IP de quem agiu, esvaziando a trilha exigida pelo Blueprint secao 6.
   *
   * O valor e a quantidade de saltos confiaveis contados da direita para a
   * esquerda no `X-Forwarded-For`. `1` = so o proxy imediato. Confiar demais
   * deixa o cliente forjar o proprio IP; `0` desliga.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  /**
   * O que fazer quando o banco esta com migrations pendentes (ADR 0010).
   *
   * `bloquear` (padrao): a API recusa subir. Codigo novo contra schema velho
   * nao falha na subida - falha depois, no primeiro request que toca a coluna
   * que nao existe, com 500 para o usuario e o motivo escondido no log do
   * Postgres. Foi exatamente assim que o M16 quebrou em producao.
   *
   * `avisar`: sobe e loga. Valvula de escape para emergencia (por exemplo,
   * subir a API so para consultar dados enquanto a migration nao pode rodar).
   * Nao e para ficar ligado.
   */
  MIGRACOES_PENDENTES: z.enum(['bloquear', 'avisar']).default('bloquear'),

  /** M17 / ADR 0007: `stub` mantem o sistema funcionando sem LLM. */
  COPILOT_PROVIDER: z.enum(['stub', 'claude']).default('stub'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Modelo servindo o Copiloto. Registrado junto de cada sugestao (M17 secao 109). */
  COPILOT_MODELO: z.string().default('claude-opus-5'),

  /**
   * Armazenamento de arquivos (M11: PDF do laudo; M16 reutiliza depois).
   *
   * `local` grava em disco e nao exige credencial - e o padrao de dev e teste,
   * no mesmo espirito do `COPILOT_PROVIDER=stub`: a ausencia de um servico
   * externo nao pode impedir rodar a suite nem subir localmente.
   */
  STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.storage-local'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  /**
   * Base publica do front - usada para montar a URL que o QR Code do laudo
   * aponta (M11 secao 88). Nao e o mesmo que `API_CORS_ORIGINS`: aqui e so a
   * origem que o QR leva, sem lista.
   */
  WEB_PUBLIC_URL: z.string().default('http://localhost:5173'),
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

  if (
    env.STORAGE_PROVIDER === 'r2' &&
    (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET)
  ) {
    throw new Error(
      'STORAGE_PROVIDER=r2 exige R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET.',
    );
  }

  return env;
}

export const ENV = Symbol('ENV');
