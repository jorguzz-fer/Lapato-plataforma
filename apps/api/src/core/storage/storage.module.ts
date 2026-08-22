import { Global, Module } from '@nestjs/common';
import { StorageFactory, StorageLocalProvider } from './storage.provider.js';

/**
 * Armazenamento de arquivos. Global pelo mesmo motivo do `IaModule`: e camada
 * transversal - o M11 usa para o PDF do laudo hoje, o M16 reutiliza para
 * imagens e laminas depois, e nenhum modulo deveria montar seu proprio cliente
 * de storage.
 */
@Global()
@Module({
  providers: [StorageLocalProvider, StorageFactory],
  exports: [StorageFactory],
})
export class StorageModule {}
