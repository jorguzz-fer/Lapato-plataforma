import { Throttle } from '@nestjs/throttler';

/**
 * Teto apertado para as rotas de entrada (Blueprint secao 6).
 *
 * Login, segundo fator e validacao publica de laudo sao as portas que um
 * desconhecido consegue bater. O teto geral do `ThrottlerModule` (centenas por
 * minuto, dimensionado para navegacao normal) e largo demais para elas.
 *
 * Os valores vem de `process.env` e nao do `ENV` injetado porque `@Throttle` e
 * metadado de decorador: e avaliado quando a classe do controller e carregada,
 * antes de existir container de injecao. Os mesmos nomes de variavel do
 * `env.ts` sao usados de proposito - quem configurar o ambiente configura os
 * dois lugares de uma vez. Os limites ficam no `env.ts`, que e quem valida.
 */
const janelaMs = Number(process.env.RATE_LIMIT_JANELA_SEGUNDOS ?? 60) * 1000;
const limite = Number(process.env.RATE_LIMIT_LOGIN ?? 10);

export const LimiteEntrada = (): MethodDecorator & ClassDecorator =>
  Throttle({ padrao: { ttl: janelaMs, limit: limite } });
