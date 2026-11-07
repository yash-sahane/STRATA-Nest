import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
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

  /** Whether these mails can reach an inbox — see EmailService.delivers. */
  get delivers(): boolean {
    return this.email.delivers;
  }

  /** Whether mail is set up to be sent at all — see EmailService.configured. */
  get configured(): boolean {
    return this.email.configured;
  }

  /** Why mail will not arrive, or null — see EmailService.undeliverableBecause. */
  get undeliverableBecause(): string | null {
    return this.email.undeliverableBecause;
  }

  async sendPasswordReset(email: string, link: string): Promise<void> {
    await this.email.enqueue({
      kind: EmailKind.PasswordReset,
      to: email,
      subject: 'Reset your STRATA password',
      // The link is single-use and lives an hour (PasswordResetStore.TTL). It
      // used to arrive as one bare line, saying neither, nor what to do with a
      // mail somebody else asked for — the commonest way one lands in an inbox.
      text:
        `Somebody asked to reset the password for the STRATA account ${email}. ` +
        `To choose a new password, open this link within the next hour; it works once: ${link} ` +
        `If you did not ask for this, ignore this mail. Your password stays as it is.`,
      context: { link },
      // A digest of the link, never the link: this key becomes the queue's
      // job id, which the worker prints in its logs and Redis keeps for a
      // failed job — and the link carries a live reset token.
      idempotencyKey: `reset:${email}:${createHash('sha256').update(link).digest('hex').slice(0, 24)}`,
    });
  }

  /**
   * A replacement temporary password. Not `sendWelcome`: that one is keyed by
   * address so a retried create cannot mail two welcomes, which would also
   * swallow this — the second password would be set and never sent. Keyed by a
   * digest of the password instead, never the password itself: the key becomes
   * the queue's job id, which the worker logs.
   */
  /**
   * "Your password was changed", sent whenever it is and however it was done —
   * so the owner hears of a change made with somebody else's copy of their
   * session as well as of their own.
   */
  async sendPasswordChanged(email: string, name: string, via: 'change' | 'reset'): Promise<void> {
    const how = via === 'reset' ? 'with a password reset link' : 'from a signed-in session';
    await this.email.enqueue({
      kind: EmailKind.Notification,
      to: email,
      subject: 'Your STRATA password was changed',
      text: `Hi ${name || email}, the password for your STRATA account (${email}) was just changed ${how}, and every other session was signed out. If this was you, there is nothing more to do. If it was not, reset your password now at ${this.frontend}/forgot-password and tell your workspace administrator.`,
      context: { via },
    });
  }

  async sendTemporaryPassword(
    email: string,
    name: string,
    tempPassword: string,
    issuedBy: string,
  ): Promise<void> {
    const login = `${this.frontend}/login`;
    await this.email.enqueue({
      kind: EmailKind.Welcome,
      to: email,
      subject: 'Your new temporary password',
      text: `Hi ${name}, ${issuedBy} issued you a new temporary password: ${tempPassword}. Sign in at ${login} — you will be asked to choose your own. Your earlier password no longer works.`,
      context: { name, hasTempPassword: true },
      idempotencyKey: `temp-password:${email}:${createHash('sha256').update(tempPassword).digest('hex').slice(0, 24)}`,
    });
  }

  async sendWelcome(email: string, name: string, tempPassword?: string): Promise<void> {
    const login = `${this.frontend}/login`;
    await this.email.enqueue({
      kind: EmailKind.Welcome,
      to: email,
      subject: 'Welcome to STRATA',
      text: tempPassword
        ? `Hi ${name}, your account is ready. Temporary password: ${tempPassword}. Sign in at ${login}.`
        : `Hi ${name}, your account is ready. Sign in at ${login}.`,
      context: { name, hasTempPassword: Boolean(tempPassword) },
      idempotencyKey: `welcome:${email}`,
    });
  }

  /**
   * Tell somebody who ALREADY has an account that they were added to a
   * workspace — by a platform administrator, or in answer to their own request
   * to join. Anybody else's add is an invitation, and the invitation notice
   * carries its own mail (WorkNotificationSubscriber.onMemberInvited).
   *
   * It used to say "use invite code X", quoting `Workspace.inviteCode` — a
   * column nothing redeems — to a person who by then was already a member. So
   * the one instruction in the mail was both unnecessary and guaranteed to fail.
   */
  async sendWorkspaceInvitation(
    email: string,
    workspaceName: string,
    inviterName: string,
    workspaceId: string,
  ): Promise<void> {
    await this.email.enqueue({
      kind: EmailKind.WorkspaceInvitation,
      to: email,
      subject: `You've been added to ${workspaceName}`,
      text: `${inviterName} added you to "${workspaceName}". Sign in at ${this.frontend}/login to open it.`,
      context: { workspaceName, inviterName, workspaceId },
      idempotencyKey: `invite:${email}:${workspaceId}`,
    });
  }

  /**
   * The line that takes the reader to where the mail is acted on. A notice
   * mailed without one ("accept it on your Workspaces page") left them to find
   * the app, sign in and hunt for the page. Signed out, the app sends them
   * through sign-in and back to this path.
   */
  private openIn(path?: string): string {
    return path ? `\n\nOpen it in STRATA: ${this.frontend}${path}` : '';
  }

  /** The mail copy of an in-app notification. Title and body are rendered by
   *  the caller, so the two channels can never say different things. */
  async sendNotification(input: {
    to: string;
    name: string;
    title: string;
    message: string;
    /** Where the notice is acted on — see appPathFor. */
    path?: string;
  }): Promise<void> {
    await this.email.enqueue({
      kind: EmailKind.Notification,
      to: input.to,
      subject: input.title,
      text: `Hi ${input.name}, ${input.message}${this.openIn(input.path)}`,
      context: { name: input.name, title: input.title },
    });
  }

  /**
   * Task deadline / overdue reminder. Sent by the server-side scan in
   * DeadlineReminderService — the title and body are already rendered there so
   * the in-app notification and the mail can never say different things. The
   * caller supplies the idempotency key (recipient + task + type + day) so a
   * re-run of the scan re-enqueues the same job id and is ignored.
   */
  async sendTaskDeadlineReminder(input: {
    to: string;
    name: string;
    title: string;
    message: string;
    idempotencyKey: string;
    /** The task's place in the app — see appPathFor. */
    path?: string;
  }): Promise<void> {
    await this.email.enqueue({
      kind: EmailKind.Notification,
      to: input.to,
      subject: input.title,
      text: `Hi ${input.name}, ${input.message}${this.openIn(input.path)}`,
      context: { name: input.name, title: input.title },
      idempotencyKey: input.idempotencyKey,
      // One reminder per task, person and day. The key already says so, but a
      // finished job used to be forgotten at once, so the hourly scan mailed
      // the same reminder again an hour later to anyone whose in-app copy was
      // switched off (the only other record of it having gone out).
      dedupeForSeconds: 36 * 60 * 60,
    });
  }
}
