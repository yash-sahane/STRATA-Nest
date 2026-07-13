import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import { SprintCompletionService } from './sprint-completion.service';
import { RetrospectivesController, SprintsController } from './sprints.controllers';
import { RetrospectivesService, SprintsService } from './sprints.services';

@Module({
  imports: [DeletionModule],
  controllers: [SprintsController, RetrospectivesController],
  providers: [SprintsService, RetrospectivesService, SprintCompletionService],
})
export class SprintsModule {}
