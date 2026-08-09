import { Global, Module } from '@nestjs/common';
import { CopilotoFactory, CopilotoStubProvider } from './copiloto.provider.js';
import { IaController } from './ia.controller.js';
import { SugestoesService } from './sugestoes.service.js';
import { GuardianService } from '../guardian/guardian.service.js';

/**
 * M17 - Inteligencia Artificial.
 *
 * Global porque a IA e camada TRANSVERSAL (DIRETRIZES secao 9): todos os
 * modulos consomem Copiloto e Guardian, e nenhum implementa o seu proprio.
 */
@Global()
@Module({
  controllers: [IaController],
  providers: [CopilotoStubProvider, CopilotoFactory, SugestoesService, GuardianService],
  exports: [CopilotoFactory, SugestoesService, GuardianService],
})
export class IaModule {}
