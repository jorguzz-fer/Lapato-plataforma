import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { Publica } from '../auth/guards.js';

/** Healthcheck (Blueprint secao 11). Usado pelo Docker e pelo Caddy. */
@ApiTags('Infraestrutura')
@Controller('health')
export class SaudeController {
  constructor(private readonly db: DbService) {}

  @Publica()
  @Get()
  @ApiOperation({ summary: 'Verifica a saúde da API e do banco' })
  async saude(): Promise<{ status: string; banco: string }> {
    try {
      await this.db.raw.execute(sql`select 1`);
      return { status: 'ok', banco: 'ok' };
    } catch {
      // Nao expõe o erro do banco: mensagem de conexao costuma vazar host e usuario.
      return { status: 'degradado', banco: 'indisponivel' };
    }
  }
}
