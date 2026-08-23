import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { estadoMigrations, type EstadoMigrations } from '@lapato/db';
import { DbService } from './db.service.js';

export type SituacaoSchema = 'ok' | 'desatualizado' | 'indeterminado';

/**
 * Compara, uma unica vez na subida, o schema que o codigo espera com o que o
 * banco tem (ADR 0010).
 *
 * A checagem e feita no `onModuleInit` e o resultado fica em memoria: o
 * healthcheck e chamado a cada poucos segundos e o estado so muda com um
 * deploy, entao consultar o banco a cada chamada seria desperdicio.
 */
@Injectable()
export class MigrationsService implements OnModuleInit {
  private readonly logger = new Logger(MigrationsService.name);
  private estado: EstadoMigrations = { total: 0, pendentes: [], indeterminado: 'nao verificado' };

  constructor(private readonly db: DbService) {}

  async onModuleInit(): Promise<void> {
    this.estado = await estadoMigrations(this.db.raw);
    if (this.situacao() === 'ok') {
      this.logger.log(`Schema em dia: ${this.estado.total} migrations aplicadas.`);
    }
  }

  get atual(): EstadoMigrations {
    return this.estado;
  }

  situacao(): SituacaoSchema {
    if (this.estado.pendentes.length > 0) return 'desatualizado';
    if (this.estado.indeterminado) return 'indeterminado';
    return 'ok';
  }

  /** Frase pronta para log e para o operador - inclui o comando que resolve. */
  descricao(): string {
    if (this.estado.pendentes.length > 0) {
      return (
        `Banco desatualizado: ${this.estado.pendentes.length} de ${this.estado.total} ` +
        `migrations pendentes (${this.estado.pendentes.join(', ')}). ` +
        'Aplique com: node node_modules/@lapato/db/dist/cli/migrate.js'
      );
    }
    if (this.estado.indeterminado) {
      return `Nao foi possivel verificar o schema do banco: ${this.estado.indeterminado}`;
    }
    return `Schema em dia (${this.estado.total} migrations).`;
  }
}
