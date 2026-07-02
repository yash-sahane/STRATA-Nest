import { Module } from '@nestjs/common';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Phase 9 — notifications. CRUD (parity) + [NEW] NotificationSubscriber that
 * turns Phases 2–8 domain events into server-guaranteed per-user notifications.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSubscriber],
  exports: [NotificationsService],
})
export class NotificationsModule {}
