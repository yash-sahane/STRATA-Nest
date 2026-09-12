import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import {
  ClientRequirementsController,
  FunctionalRequirementsController,
} from './requirements.controllers';
import {
  ClientRequirementsService,
  FunctionalRequirementsService,
} from './requirements.services';

@Module({
  imports: [DeletionModule],
  controllers: [ClientRequirementsController, FunctionalRequirementsController],
  providers: [ClientRequirementsService, FunctionalRequirementsService],
})
export class RequirementsModule {}
