import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service.js';
import { MigrationsService } from './migrations.service.js';

@Global()
@Module({
  providers: [DbService, MigrationsService],
  exports: [DbService, MigrationsService],
})
export class DbModule {}
