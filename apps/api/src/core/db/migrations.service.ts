import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { estadoMigrations, type EstadoMigrations } from '@lapato/db';
import { DbService } from './db.service.js';

export type SituacaoSchema = 'ok' | 'desatualizado' | 'indeterminado';

/**
 * Compara, uma unica vez na subida, o schema que o codigo espera com o que o
 * banco tem (ADR 0010).
 *
 * O resultado fica em memoria: o healthcheck e chamado a cada poucos segundos
 * e o estado so muda com um deploy, entao consultar o banco a cada chamada
 * seria desperdicio.
 *
 * Quem dispara a checagem e o bootstrap, com `verificar()`, ANTES de servir
 * qualquer request. O `onModuleInit` continua aqui para quem sobe a aplicacao
 * por outro caminho (os testes, o worker), mas o guarda do bootstrap nao
 * depende dele - ver o comentario em `main.ts`.
 */
@Injectable()
export class MigrationsService implements OnModuleInit {
  private readonly logger = new Logger(MigrationsService.name);
  private estado: EstadoMigrations = { total: 0, pendentes: [], indeterminado: 'nao verificado' };
  private verificado = false;

  constructor(private readonly db: DbService) {}

  async onModuleInit(): Promise<void> {
    await this.verificar();
  }

  /**
   * Consulta o banco e guarda o resultado. Idempotente: chamar duas vezes nao
   * repete a consulta nem o log, porque o bootstrap chama explicitamente e o
   * ciclo de vida do Nest chama de novo logo depois.
   */
  async verificar(): Promise<SituacaoSchema> {
    if (this.verificado) return this.situacao();

    this.estado = await estadoMigrations(this.db.raw);
    this.verificado = true;

    if (this.situacao() === 'ok') {
      this.logger.log(`Schema em dia: ${this.estado.total} migrations aplicadas.`);
    }
    return this.situacao();
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
