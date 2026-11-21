import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DbService } from './core/db/db.service.js';
import { MigrationsService } from './core/db/migrations.service.js';
import type { Env } from './core/config/env.js';

/**
 * ADR 0010: a API recusa subir com o schema desatualizado.
 *
 * Este arquivo existe por causa de um incidente. A API subiu em producao com
 * cinco migrations atrasadas, respondeu healthcheck como saudavel e quebrou na
 * primeira coluna que faltava - com `MIGRACOES_PENDENTES=bloquear`, que
 * deveria ter impedido exatamente isso.
 *
 * A causa nao estava na regra, e sim em QUANDO ela era lida.
 * `NestFactory.create()` monta o grafo de dependencias mas nao roda
 * `onModuleInit`; isso acontece em `app.init()`, disparado pelo `listen()`. O
 * bootstrap lia `situacao()` logo depois do `create()` e, por isso, enxergava
 * sempre o estado inicial - "nao verificado" -, que cai no ramo de AVISO. O
 * bloqueio nunca rodava.
 *
 * O teste abaixo fixa as duas metades do conserto: o estado inicial e mesmo
 * indeterminado (ninguem deve confiar nele) e `verificar()` responde pelo
 * banco de verdade, sem depender do ciclo de vida do Nest.
 */

let db: DbService;

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://lapato_app:lapato@127.0.0.1:5432/lapato';

  db = new DbService({
    DATABASE_URL: process.env.DATABASE_URL_TESTE ?? process.env.DATABASE_URL,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
  } as Env);
});

afterAll(async () => {
  await db.onModuleDestroy();
});

describe('guarda do schema (ADR 0010)', () => {
  test('antes de verificar, o estado é indeterminado — não dá para confiar nele', () => {
    const migrations = new MigrationsService(db);

    /**
     * Este é o estado que o bootstrap antigo lia. Se um dia alguém voltar a
     * consultar `situacao()` sem chamar `verificar()` (ou sem esperar o
     * `onModuleInit`), é ISTO que vai receber — e não a verdade sobre o banco.
     */
    expect(migrations.situacao()).toBe('indeterminado');
    expect(migrations.descricao()).toContain('nao verificado');
  });

  test('verificar() responde pelo banco de verdade, sem depender do ciclo de vida', async () => {
    const migrations = new MigrationsService(db);

    // O banco dos testes está migrado; o que importa aqui é que a resposta
    // deixou de ser "indeterminado" por falta de checagem.
    expect(await migrations.verificar()).toBe('ok');
    expect(migrations.situacao()).toBe('ok');
    expect(migrations.atual.total).toBeGreaterThan(0);
    expect(migrations.atual.pendentes).toHaveLength(0);
    expect(migrations.descricao()).toContain('Schema em dia');
  });

  test('verificar() é idempotente: o bootstrap chama, o onModuleInit repete', async () => {
    const migrations = new MigrationsService(db);

    expect(await migrations.verificar()).toBe('ok');
    const depoisDoPrimeiro = migrations.atual;

    // A segunda chamada (a do ciclo de vida) não refaz a consulta: devolve o
    // mesmo objeto de estado.
    expect(await migrations.verificar()).toBe('ok');
    expect(migrations.atual).toBe(depoisDoPrimeiro);

    // E o onModuleInit, que é quem chama de novo na vida real, não explode.
    await expect(migrations.onModuleInit()).resolves.toBeUndefined();
    expect(migrations.atual).toBe(depoisDoPrimeiro);
  });
});
