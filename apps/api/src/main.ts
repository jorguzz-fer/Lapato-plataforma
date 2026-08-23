import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './core/config/env.js';
import { MigrationsService } from './core/db/migrations.service.js';
import { ProblemaFilter } from './core/http/problema.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  /**
   * Schema do banco antes de qualquer request (ADR 0010).
   *
   * Fica antes do `listen` de proposito: um container que sobe e responde
   * healthcheck com o banco atrasado passa por saudavel, e o proxy comeca a
   * mandar trafego para uma API que vai dar 500 na primeira coluna que falta.
   */
  // `bufferLogs` segura os logs ate o `listen`. Se a checagem abaixo derrubar o
  // processo antes disso, o motivo morreria no buffer - justamente a mensagem
  // que o operador precisa ler.
  app.flushLogs();

  const migrations = app.get(MigrationsService);
  if (migrations.situacao() === 'desatualizado') {
    if (env.MIGRACOES_PENDENTES === 'bloquear') {
      await app.close();
      throw new Error(
        `${migrations.descricao()}\n` +
          'Para subir mesmo assim (emergencia), defina MIGRACOES_PENDENTES=avisar.',
      );
    }
    Logger.warn(migrations.descricao(), 'Bootstrap');
  } else if (migrations.situacao() === 'indeterminado') {
    Logger.warn(migrations.descricao(), 'Bootstrap');
  }

  /**
   * Quem e o cliente, atras do proxy.
   *
   * Em producao o request chega pelo Traefik do Coolify, entao sem isto
   * `req.ip` e o IP do proxy - identico para todo mundo. Isso quebraria as duas
   * coisas que dependem de saber quem chamou: o rate limit por IP (um balde
   * unico, um usuario derrubando os demais) e o `audit_log`, que gravaria o
   * proxy no lugar de quem agiu.
   *
   * Fica em `0` por padrao porque confiar em `X-Forwarded-For` sem proxy na
   * frente e pior que nao ter IP: qualquer cliente escolheria o proprio.
   */
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  } else if (env.NODE_ENV === 'production') {
    Logger.warn(
      'TRUST_PROXY=0 em producao: o IP registrado na auditoria e usado no rate ' +
        'limit sera o do proxy, nao o do usuario. Atras do Coolify, use 1.',
      'Bootstrap',
    );
  }

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
