import { Module } from '@nestjs/common';
import { ActiveTimersController, TimeEntriesController } from './time-tracking.controllers';
import { ActiveTimersService, TimeEntriesService } from './time-tracking.services';
import { TimeApprovalService, TimerService } from './time-tracking.workflows';

@Module({
  controllers: [TimeEntriesController, ActiveTimersController],
  providers: [TimeEntriesService, ActiveTimersService, TimerService, TimeApprovalService],
})
export class TimeTrackingModule {}
