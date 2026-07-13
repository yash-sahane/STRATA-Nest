import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailKind } from '@strata/shared';
import { EmailService } from '../email/email.service';

/**
 * Transactional mail. Delivery goes through the BullMQ email queue via
 * EmailService. Idempotency keys keep retries/double-submits from sending
 * twice. The worker renders + delivers (Resend, else logs).
 */
@Injectable()
export class MailService {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private get frontend(): string {
    return this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  async sendPasswordReset(email: string, link: string): Promise<void> {
    await this.email.enqueue({
      kind: EmailKind.PasswordReset,
      to: email,
      subject: 'Reset your password',
      text: `Reset your password using this link: ${link}`,
      context: { link },
      idempotencyKey: `reset:${email}:${link}`,
    });
  }

  async sendWelcome(email: string, name: string, tempPassword?: string): Promise<void> {
    const login = `${this.frontend}/login`;
    await this.email.enqueue({
      kind: EmailKind.Welcome,
      to: email,
      subject: 'Welcome to L-T Connect',
      text: tempPassword
        ? `Hi ${name}, your account is ready. Temporary password: ${tempPassword}. Sign in at ${login}.`
        : `Hi ${name}, your account is ready. Sign in at ${login}.`,
      context: { name, hasTempPassword: Boolean(tempPassword) },
      idempotencyKey: `welcome:${email}`,
    });
  }

  async sendWorkspaceInvitation(
    email: string,
    workspaceName: string,
    inviterName: string,
    inviteCode: string,
  ): Promise<void> {
    await this.email.enqueue({
      kind: EmailKind.WorkspaceInvitation,
      to: email,
      subject: `You're invited to ${workspaceName}`,
      text: `${inviterName} invited you to join "${workspaceName}". Use invite code ${inviteCode} at ${this.frontend}.`,
      context: { workspaceName, inviterName, inviteCode },
      idempotencyKey: `invite:${email}:${inviteCode}`,
    });
  }
}
