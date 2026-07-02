import { Module } from '@nestjs/common';
import {
  ClientRequirementsController,
  FunctionalRequirementsController,
} from './requirements.controllers';
import {
  ClientRequirementsService,
  FunctionalRequirementsService,
} from './requirements.services';

@Module({
  controllers: [ClientRequirementsController, FunctionalRequirementsController],
  providers: [ClientRequirementsService, FunctionalRequirementsService],
})
export class RequirementsModule {}
