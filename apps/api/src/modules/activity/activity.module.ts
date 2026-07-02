import { Module } from '@nestjs/common';
import { ActivityLogsController, SavedSearchesController } from './activity.controllers';
import { ActivityLogsService, SavedSearchesService } from './activity.services';
import { AuditSubscriber } from './audit.subscriber';

/**
 * Phase 9 — activity. Append-only ActivityLog + SavedSearch CRUD, plus [NEW]
 * AuditSubscriber that appends an audit row for every Phases 2–8 domain event.
 */
@Module({
  controllers: [ActivityLogsController, SavedSearchesController],
  providers: [ActivityLogsService, SavedSearchesService, AuditSubscriber],
  exports: [ActivityLogsService],
})
export class ActivityModule {}
