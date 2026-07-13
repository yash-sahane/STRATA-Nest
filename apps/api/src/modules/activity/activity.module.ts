import { Module } from '@nestjs/common';
import { ActivityLogsController, SavedSearchesController } from './activity.controllers';
import { ActivityLogsService, SavedSearchesService } from './activity.services';
import { AuditSubscriber } from './audit.subscriber';

/**
 * Activity. Append-only ActivityLog + SavedSearch CRUD, plus an AuditSubscriber
 * that appends an audit row for every domain event.
 */
@Module({
  controllers: [ActivityLogsController, SavedSearchesController],
  providers: [ActivityLogsService, SavedSearchesService, AuditSubscriber],
  exports: [ActivityLogsService],
})
export class ActivityModule {}
