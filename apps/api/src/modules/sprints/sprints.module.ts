import { Module } from '@nestjs/common';
import { SprintCompletionService } from './sprint-completion.service';
import { RetrospectivesController, SprintsController } from './sprints.controllers';
import { RetrospectivesService, SprintsService } from './sprints.services';

@Module({
  controllers: [SprintsController, RetrospectivesController],
  providers: [SprintsService, RetrospectivesService, SprintCompletionService],
})
export class SprintsModule {}
