import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

/** Global email producer — MailModule (and any future sender) injects EmailService.
 *  NotificationsModule is imported for the per-user delivery preferences the
 *  notification mail endpoint honours (one-way: notifications never import email). */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
