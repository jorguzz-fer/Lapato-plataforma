import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DbModule } from './core/db/db.module.js';
import { IaModule } from './core/ia/ia.module.js';
import { StorageModule } from './core/storage/storage.module.js';
import { ConfigModule } from './core/config/config.module.js';
import { ENV, type Env } from './core/config/env.js';
import { AuthService } from './core/auth/auth.service.js';
import { AuthController } from './core/auth/auth.controller.js';
import { PermissoesGuard, SessaoGuard } from './core/auth/guards.js';
import { ContextoMiddleware } from './core/contexto/contexto.middleware.js';
import { EventosService } from './core/eventos/eventos.service.js';
import { AuditoriaService } from './core/auditoria/auditoria.service.js';
import { SaudeController } from './core/saude/saude.controller.js';
import { NumeracaoService } from './modulos/m01-administracao/numeracao.service.js';
import { AdministracaoService } from './modulos/m01-administracao/administracao.service.js';
import { AdministracaoController } from './modulos/m01-administracao/administracao.controller.js';
import { CasosService } from './modulos/m05-casos/casos.service.js';
import { TriagemService } from './modulos/m06-triagem/triagem.service.js';
import { FluxoService } from './modulos/m07-fluxo/fluxo.service.js';
import { FluxoConsultaService } from './modulos/m07-fluxo/fluxo-consulta.service.js';
import { PainelService } from './modulos/m07-fluxo/painel.service.js';
import { LogisticaService } from './modulos/m19-logistica/logistica.service.js';
import { OrdensService } from './modulos/m20-ordens/ordens.service.js';
import { FinanceiroService } from './modulos/m20-ordens/financeiro.service.js';
import { MacroscopiaService } from './modulos/m08-macroscopia/macroscopia.service.js';
import { ProcessamentoService } from './modulos/m09-processamento/processamento.service.js';
import { LaudosService } from './modulos/m11-laudos/laudos.service.js';
import { CitopatologiaService } from './modulos/m12-citopatologia/citopatologia.service.js';
import { NecropsiaService } from './modulos/m14-necropsia/necropsia.service.js';
import { CadaveresService } from './modulos/m15-cadaveres/cadaveres.service.js';
import { BiotecaService } from './modulos/m18-bioteca/bioteca.service.js';
import { ImagensService } from './modulos/m16-imagens/imagens.service.js';
import { PortalService } from './modulos/m04-portal/portal.service.js';
import { LaudoPdfService } from './modulos/m11-laudos/laudo-pdf.service.js';
import { SolicitacoesService } from './modulos/m10-solicitacoes/solicitacoes.service.js';
import { ClientesService } from './modulos/m03-clientes/clientes.service.js';
import { UsuariosService } from './modulos/m02-usuarios/usuarios.service.js';
import { CatalogoController } from './modulos/m01-administracao/catalogo.controller.js';
import {
  CasosController,
  ClientesController,
  FluxoController,
  PainelController,
  LogisticaController,
  OrdensController,
  PrecosController,
  FinanceiroController,
  CitopatologiaController,
  NecropsiaController,
  BiotecaController,
  CadaveresController,
  ImagensController,
  PortalController,
  LaudosController,
  MacroscopiaController,
  ProcessamentoController,
  SolicitacoesController,
  TriagemController,
  UsuariosController,
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
  imports: [
    ConfigModule,
    /**
     * Blueprint secao 6: rate limiting. O teto aqui e o geral; as rotas de
     * entrada apertam com `@Throttle` (ver `LIMITE_ENTRADA`).
     */
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [
          {
            name: 'padrao',
            ttl: env.RATE_LIMIT_JANELA_SEGUNDOS * 1000,
            limit: env.RATE_LIMIT_REQUISICOES,
          },
        ],
        // A mensagem padrao do pacote e "ThrottlerException: Too many
        // requests" e chegaria assim na tela do usuario.
        errorMessage: 'Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.',
      }),
    }),
    DbModule,
    IaModule,
    StorageModule,
  ],
  controllers: [
    SaudeController,
    AuthController,
    CatalogoController,
    AdministracaoController,
    UsuariosController,
    ClientesController,
    VeterinariosController,
    CasosController,
    TriagemController,
    MacroscopiaController,
    ProcessamentoController,
    LaudosController,
    CitopatologiaController,
    NecropsiaController,
    CadaveresController,
    BiotecaController,
    ImagensController,
    PortalController,
    ValidacaoController,
    SolicitacoesController,
    FluxoController,
    PainelController,
    LogisticaController,
    OrdensController,
    PrecosController,
    FinanceiroController,
  ],
  providers: [
    AuthService,
    EventosService,
    AuditoriaService,

    NumeracaoService,
    AdministracaoService,
    CasosService,
    TriagemService,
    FluxoService,
    FluxoConsultaService,
    PainelService,
    LogisticaService,
    OrdensService,
    FinanceiroService,
    MacroscopiaService,
    ProcessamentoService,
    LaudosService,
    CitopatologiaService,
    NecropsiaService,
    CadaveresService,
    BiotecaService,
    ImagensService,
    PortalService,
    LaudoPdfService,
    SolicitacoesService,
    ClientesService,
    UsuariosService,

    /**
     * Guards globais: negar por padrao (Blueprint secao 1.3). Toda rota exige
     * sessao, a menos que marque `@Publica()`.
     *
     * A ordem importa. O rate limit vem primeiro de proposito: uma enxurrada de
     * requests anonimos precisa ser cortada antes de virar consulta de sessao no
     * banco - se ele rodasse depois, cada tentativa de forca bruta ainda custaria
     * um SELECT. Depois o de sessao, e so entao o de permissao.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
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
