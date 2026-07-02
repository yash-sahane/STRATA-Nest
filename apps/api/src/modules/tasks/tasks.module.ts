import { Module } from '@nestjs/common';
import { SprintCompletedTaskRoller } from './task-roll.subscriber';
import {
  KanbanColumnsController,
  LabelsController,
  TaskCommentsController,
  TasksController,
} from './tasks.controllers';
import { LabelsService, TasksService } from './tasks.services';
import { KanbanColumnsService, TaskCommentsService } from './unscoped.services';

@Module({
  controllers: [TasksController, LabelsController, TaskCommentsController, KanbanColumnsController],
  providers: [
    TasksService,
    LabelsService,
    TaskCommentsService,
    KanbanColumnsService,
    SprintCompletedTaskRoller, // @OnEvent('sprint.completed')
  ],
})
export class TasksModule {}
