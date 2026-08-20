import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './core/config/env.js';
import { ProblemaFilter } from './core/http/problema.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  // Blueprint secao 6: cabecalhos de seguranca e CSP estrita.
  app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' }));
  app.use(cookieParser());

  /**
   * CORS com `credentials: true` porque a sessao viaja em cookie httpOnly.
   * A lista de origens e explicita - `*` seria incompativel com credenciais e
   * abriria a API a qualquer site.
   */
  app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true });

  app.setGlobalPrefix(env.API_GLOBAL_PREFIX);
  // Sem ValidationPipe do Nest: a validacao e feita com Zod em `validarCorpo`,
  // o mesmo vocabulario de schema usado no restante do monorepo.
  app.useGlobalFilters(new ProblemaFilter());

  // Blueprint secao 1.6: contrato como fonte de verdade.
  const config = new DocumentBuilder()
    .setTitle('LAPATO API')
    .setDescription(
      'Sistema Integrado de Gestão Anatomopatológica Veterinária. ' +
        'Autenticação por sessão em cookie httpOnly; toda rota exige permissão explícita.',
    )
    .setVersion('1.0')
    .addCookieAuth(env.SESSION_COOKIE_NAME)
    .build();

  const documento = SwaggerModule.createDocument(app, config);
  // Sob o mesmo prefixo das rotas: um proxy que roteia por caminho leva as duas
  // coisas junto. Fora dele, a documentacao daria 404 justamente em producao.
  SwaggerModule.setup(`${env.API_GLOBAL_PREFIX}/docs`, app, documento);

  await app.listen(env.API_PORT);
  Logger.log(`API ouvindo em :${env.API_PORT} (${env.NODE_ENV})`, 'Bootstrap');
  Logger.log(`Copiloto: ${env.COPILOT_PROVIDER}`, 'Bootstrap');
}

bootstrap().catch((erro: unknown) => {
  Logger.error(erro instanceof Error ? erro.stack : String(erro), 'Bootstrap');
  process.exit(1);
});
