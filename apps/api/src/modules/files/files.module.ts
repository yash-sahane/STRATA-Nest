import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/** Files module. StorageService is provided globally by StorageModule. */
@Module({
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
