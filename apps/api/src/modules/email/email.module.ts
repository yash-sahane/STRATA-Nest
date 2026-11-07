import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global email producer — MailModule (and any future sender) injects EmailService.
 *
 * No HTTP surface: every mail is written and addressed by the server. The last
 * endpoint, `email/send-notification`, took a caller-written subject and body,
 * and its one caller — the change-password screen's "your password was changed"
 * — is sent by AuthService now, wherever a password changes.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
