import { Module } from '@nestjs/common';
import { ActivityLogsController } from './activity.controllers';
import { ActivityLogsService } from './activity.services';
import { AuditSubscriber } from './audit.subscriber';

/**
 * Activity. The append-only ActivityLog, plus an AuditSubscriber that appends
 * an audit row for every domain event.
 */
@Module({
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService, AuditSubscriber],
  exports: [ActivityLogsService],
})
export class ActivityModule {}
