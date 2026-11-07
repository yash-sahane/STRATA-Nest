import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import { SprintCompletionService } from './sprint-completion.service';
import { SprintsController } from './sprints.controllers';
import { SprintsService } from './sprints.services';

@Module({
  imports: [DeletionModule],
  controllers: [SprintsController],
  providers: [SprintsService, SprintCompletionService],
})
export class SprintsModule {}
