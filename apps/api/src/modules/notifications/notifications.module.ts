import { Module } from '@nestjs/common';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notifications. CRUD endpoints plus a NotificationSubscriber that turns domain
 * events into server-guaranteed per-user notifications.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSubscriber],
  exports: [NotificationsService],
})
export class NotificationsModule {}
