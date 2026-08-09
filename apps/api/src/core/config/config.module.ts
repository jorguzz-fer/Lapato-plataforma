import { Global, Module } from '@nestjs/common';
import { ENV, carregarEnv } from './env.js';

/**
 * Configuracao validada, disponivel em todo o grafo de modulos.
 *
 * Precisa ser `@Global()` e ser importado antes dos demais: `DbModule`,
 * `AuthService` e o provedor de IA dependem de `ENV` e vivem em modulos
 * diferentes. Declarar o provider apenas no `AppModule` deixaria esses modulos
 * sem enxerga-lo.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => carregarEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
