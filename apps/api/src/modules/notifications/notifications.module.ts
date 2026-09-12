import { Module } from '@nestjs/common';
import { DeadlineReminderService } from './deadline-reminder.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notifications. CRUD endpoints plus a NotificationSubscriber that turns domain
 * events into server-guaranteed per-user notifications, the per-user delivery
 * preferences both producers consult before writing, and the deadline/overdue
 * reminder scan that used to run in every member's browser.
 *
 * DeadlineReminderService injects MailService, which lives in the @Global
 * MailModule — no import is added here, so the module graph stays acyclic
 * (EmailModule imports this one for the preferences, never the other way).
 */
@Module({
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    NotificationSubscriber,
    DeadlineReminderService,
  ],
  exports: [NotificationsService, NotificationPreferencesService, DeadlineReminderService],
})
export class NotificationsModule {}
