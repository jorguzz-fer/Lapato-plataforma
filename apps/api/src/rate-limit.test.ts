import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ProblemaFilter } from './core/http/problema.filter.js';

/**
 * Blueprint secao 6, "Protecoes de fluxo": rate limiting.
 *
 * O lockout por conta ja existia e nao cobre o que este arquivo cobre. O
 * lockout defende UMA conta de muitas tentativas; credential stuffing faz o
 * contrario - tenta uma senha em milhares de contas diferentes e nunca esbarra
 * no limite de nenhuma delas. Quem barra isso e o teto por IP.
 *
 * Os limites sao apertados AQUI, no topo do arquivo, porque `@Throttle` e
 * metadado de decorador: e lido quando a classe do controller carrega. Dai o
 * `AppModule` entrar por `import()` dentro do `beforeAll`, e nao no topo. Cada
 * arquivo de teste roda em ambiente isolado, entao isto nao vaza para os
 * demais.
 */
const LIMITE_ENTRADA = 4;

process.env.RATE_LIMIT_JANELA_SEGUNDOS = '60';
process.env.RATE_LIMIT_LOGIN = String(LIMITE_ENTRADA);
process.env.RATE_LIMIT_REQUISICOES = '100000';

const BASE = '/api/v1';

let app: INestApplication;
let servidor: string;

async function tentarLogin(email: string): Promise<number> {
  const r = await fetch(`${servidor}${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instituicao: 'demo', email, senha: 'senha-errada-de-proposito' }),
  });
  await r.text();
  return r.status;
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://lapato_app:lapato@127.0.0.1:5432/lapato';
  process.env.SESSION_SECRET ??= 'x'.repeat(48);
  process.env.COPILOT_PROVIDER = 'stub';
  process.env.NODE_ENV = 'test';

  const { AppModule } = await import('./app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemaFilter());

  await app.listen(0);
  servidor = await app.getUrl();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('rate limiting nas rotas de entrada', () => {
  test('o teto por IP corta a rajada mesmo sem nenhuma conta ser bloqueada', async () => {
    const respostas: number[] = [];

    // Um e-mail diferente a cada tentativa: nenhuma conta chega perto das 5
    // falhas do lockout, e ainda assim a rajada precisa ser cortada.
    for (let i = 0; i < LIMITE_ENTRADA + 2; i += 1) {
      respostas.push(await tentarLogin(`alvo-${i}@lapato.local`));
    }

    expect(respostas.slice(0, LIMITE_ENTRADA)).toEqual(
      Array.from({ length: LIMITE_ENTRADA }, () => 401),
    );
    expect(respostas.at(-1)).toBe(429);
  });

  test('a resposta 429 explica em português e segue o formato de erro da API', async () => {
    const r = await fetch(`${servidor}${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instituicao: 'demo', email: 'x@lapato.local', senha: 'errada' }),
    });

    expect(r.status).toBe(429);

    const corpo = (await r.json()) as { status: number; detail: string };
    expect(corpo.status).toBe(429);
    expect(corpo.detail).toContain('Muitas requisições');
  });

  test('a validação pública de laudo também tem teto - o código é o único segredo', async () => {
    /**
     * Balde proprio: o `@nestjs/throttler` conta por rota, nao por aplicacao.
     * E o comportamento desejado - estourar o login nao pode derrubar o resto
     * da API para o mesmo IP - mas significa que esta rota precisa da propria
     * rajada para provar que tambem tem teto.
     */
    const respostas: number[] = [];
    for (let i = 0; i < LIMITE_ENTRADA + 2; i += 1) {
      const r = await fetch(`${servidor}${BASE}/validar/demo/codigo-inexistente-${i}`);
      await r.text();
      respostas.push(r.status);
    }

    expect(respostas[0]).toBe(404);
    expect(respostas.at(-1)).toBe(429);
  });
});
