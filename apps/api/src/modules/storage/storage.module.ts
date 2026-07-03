import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global so any module (files now, exports/imports later) can inject StorageService. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
