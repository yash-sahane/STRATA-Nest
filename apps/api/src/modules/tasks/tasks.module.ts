import { Module } from '@nestjs/common';
import { DeletionModule } from '../deletion/deletion.module';
import { SprintCompletedTaskRoller } from './task-roll.subscriber';
import { TaskCommentsController, TasksController } from './tasks.controllers';
import { TasksService } from './tasks.services';
import { TaskCommentsService } from './unscoped.services';
import { WorkerEventsBridge } from './worker-events.bridge';

@Module({
  imports: [DeletionModule],
  controllers: [TasksController, TaskCommentsController],
  providers: [
    TasksService,
    TaskCommentsService,
    SprintCompletedTaskRoller, // @OnEvent('sprint.completed')
    WorkerEventsBridge, // what a commit moved, said by the worker
  ],
})
export class TasksModule {}
