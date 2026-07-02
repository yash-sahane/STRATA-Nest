import { Injectable, Logger } from '@nestjs/common';

/**
 * Phase-1 mail STUB. Real transactional email moves to the BullMQ email queue in
 * Phase 10 (M§6.2) — this keeps Auth/Users logic decoupled from transport so
 * responses ({ok:true}, invite results) are already correct. Currently logs only.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');

  async sendPasswordReset(email: string, link: string): Promise<void> {
    this.logger.warn(`[stub] password-reset email to ${email}: ${link}`);
  }

  async sendWelcome(email: string, name: string, tempPassword?: string): Promise<void> {
    this.logger.warn(`[stub] welcome email to ${email} (${name})${tempPassword ? ' with temp password' : ''}`);
  }

  async sendWorkspaceInvitation(
    email: string,
    workspaceName: string,
    inviterName: string,
    inviteCode: string,
  ): Promise<void> {
    this.logger.warn(`[stub] invite email to ${email} for "${workspaceName}" from ${inviterName} (code ${inviteCode})`);
  }
}
