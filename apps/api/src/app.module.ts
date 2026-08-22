import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './core/db/db.module.js';
import { IaModule } from './core/ia/ia.module.js';
import { StorageModule } from './core/storage/storage.module.js';
import { ConfigModule } from './core/config/config.module.js';
import { AuthService } from './core/auth/auth.service.js';
import { AuthController } from './core/auth/auth.controller.js';
import { PermissoesGuard, SessaoGuard } from './core/auth/guards.js';
import { ContextoMiddleware } from './core/contexto/contexto.middleware.js';
import { EventosService } from './core/eventos/eventos.service.js';
import { AuditoriaService } from './core/auditoria/auditoria.service.js';
import { SaudeController } from './core/saude/saude.controller.js';
import { NumeracaoService } from './modulos/m01-administracao/numeracao.service.js';
import { CasosService } from './modulos/m05-casos/casos.service.js';
import { TriagemService } from './modulos/m06-triagem/triagem.service.js';
import { FluxoService } from './modulos/m07-fluxo/fluxo.service.js';
import { FluxoConsultaService } from './modulos/m07-fluxo/fluxo-consulta.service.js';
import { MacroscopiaService } from './modulos/m08-macroscopia/macroscopia.service.js';
import { ProcessamentoService } from './modulos/m09-processamento/processamento.service.js';
import { LaudosService } from './modulos/m11-laudos/laudos.service.js';
import { LaudoPdfService } from './modulos/m11-laudos/laudo-pdf.service.js';
import { SolicitacoesService } from './modulos/m10-solicitacoes/solicitacoes.service.js';
import { ClientesService } from './modulos/m03-clientes/clientes.service.js';
import { CatalogoController } from './modulos/m01-administracao/catalogo.controller.js';
import {
  CasosController,
  ClientesController,
  FluxoController,
  LaudosController,
  MacroscopiaController,
  ProcessamentoController,
  SolicitacoesController,
  TriagemController,
  ValidacaoController,
  VeterinariosController,
} from './modulos/controllers.js';

/**
 * Monolito modular (ADR 0001).
 *
 * Os modulos de dominio nao se chamam diretamente: eles publicam eventos e o
 * M07 decide as transicoes (DIRETRIZES secao 17). O que aparece aqui como
 * dependencia direta e sempre a infraestrutura compartilhada - eventos,
 * auditoria, IA, numeracao - nunca regra de negocio de outro modulo.
 */
@Module({
  imports: [ConfigModule, DbModule, IaModule, StorageModule],
  controllers: [
    SaudeController,
    AuthController,
    CatalogoController,
    ClientesController,
    VeterinariosController,
    CasosController,
    TriagemController,
    MacroscopiaController,
    ProcessamentoController,
    LaudosController,
    ValidacaoController,
    SolicitacoesController,
    FluxoController,
  ],
  providers: [
    AuthService,
    EventosService,
    AuditoriaService,

    NumeracaoService,
    CasosService,
    TriagemService,
    FluxoService,
    FluxoConsultaService,
    MacroscopiaService,
    ProcessamentoService,
    LaudosService,
    LaudoPdfService,
    SolicitacoesService,
    ClientesService,

    /**
     * Guards globais: negar por padrao (Blueprint secao 1.3). Toda rota exige
     * sessao, a menos que marque `@Publica()`.
     *
     * A ordem importa - o de sessao roda antes do de permissao.
     */
    { provide: APP_GUARD, useClass: SessaoGuard },
    { provide: APP_GUARD, useClass: PermissoesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Abre o AsyncLocalStorage para toda a cadeia do request.
    consumer.apply(ContextoMiddleware).forRoutes('*');
  }
}
