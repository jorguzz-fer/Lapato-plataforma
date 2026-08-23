import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { MigrationsService, type SituacaoSchema } from '../db/migrations.service.js';
import { Publica } from '../auth/guards.js';

/** Healthcheck (Blueprint secao 11). Usado pelo Docker e pelo Caddy. */
@ApiTags('Infraestrutura')
@Controller('health')
export class SaudeController {
  constructor(
    private readonly db: DbService,
    private readonly migrations: MigrationsService,
  ) {}

  @Publica()
  @Get()
  @ApiOperation({ summary: 'Verifica a saúde da API e do banco' })
  async saude(): Promise<{ status: string; banco: string; schema: SituacaoSchema }> {
    // `schema` vem da checagem feita na subida (ADR 0010). Com
    // MIGRACOES_PENDENTES=avisar a API sobe desatualizada de proposito; aqui e
    // onde isso fica visivel sem precisar caçar log de container.
    const schema = this.migrations.situacao();

    try {
      await this.db.raw.execute(sql`select 1`);
      return { status: schema === 'ok' ? 'ok' : 'degradado', banco: 'ok', schema };
    } catch {
      // Nao expõe o erro do banco: mensagem de conexao costuma vazar host e usuario.
      return { status: 'degradado', banco: 'indisponivel', schema };
    }
  }
}
