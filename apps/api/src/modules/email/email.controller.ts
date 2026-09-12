import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmailKind } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DENY_MESSAGE, WorkspaceAccessService } from '../authz/workspace-access.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { SendGenericEmailDto, SendInvitationEmailDto } from './dto';
import { EmailService } from './email.service';

/** Interpolated values are user-controlled free text (a workspace name, a
 *  rejection reason), so they must be escaped or they reach the recipient's
 *  inbox as markup. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The `email/send-*` endpoints (frozen request/response contract). They
 * ENQUEUE and return an optimistic `{success, backend, sent, queued}` —
 * delivery is async + retried.
 */
@ApiTags('email')
@Controller('email')
export class EmailController {
  constructor(
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Post('send-invitation')
  @HttpCode(200)
  sendInvitation(@Body() d: SendInvitationEmailDto) {
    const html = `
    <h2>Hi,</h2>
    <p>${escapeHtml(d.inviterName)} has invited you to join the <strong>${escapeHtml(d.workspaceName)}</strong>
    workspace on STRATA.</p>
    <p>Your invitation code is: <code>${escapeHtml(d.inviteCode)}</code></p>
    `;
    return this.email.send({
      kind: EmailKind.WorkspaceInvitation,
      to: d.to,
      subject: `You've been invited to join ${d.workspaceName}`,
      text: `${d.inviterName} invited you to join ${d.workspaceName}. Invite code: ${d.inviteCode}`,
      html,
      context: { workspaceName: d.workspaceName, inviterName: d.inviterName, inviteCode: d.inviteCode },
    });
  }

  @Post('send-leave')
  @HttpCode(200)
  async sendLeave(@CurrentUser() u: User, @Body() d: SendGenericEmailDto) {
    await this.assertRecipientsAreReachable(u, d.to);
    return this.email.send({
      kind: EmailKind.Notification,
      to: d.to,
      subject: d.subject,
      text: d.text ?? '',
      html: d.html,
    });
  }

  @Post('send-notification')
  @HttpCode(200)
  async sendNotification(@CurrentUser() u: User, @Body() d: SendGenericEmailDto) {
    await this.assertRecipientsAreReachable(u, d.to);
    // The sender is the ACTOR's browser, so the RECIPIENT's email opt-out can
    // only be applied here. Muted addresses are dropped silently — an opt-out is
    // not an error for the caller.
    const to = await this.recipientsAllowingEmail(d);
    if (to.length === 0) {
      return { success: true, backend: 'suppressed', sent: false, queued: false };
    }
    return this.email.send({
      kind: EmailKind.Notification,
      to,
      subject: d.subject,
      text: d.text ?? '',
      html: d.html,
    });
  }

  /** Drop recipients who turned the email channel off for this notification
   *  type. Without `workspaceId` + `notificationType` there is nothing to look
   *  up, and an address that belongs to no user has no preference to honour. */
  private async recipientsAllowingEmail(d: SendGenericEmailDto): Promise<string[]> {
    if (!d.workspaceId || !d.notificationType) return d.to;
    const users = await this.prisma.user.findMany({
      where: { email: { in: d.to } },
      select: { id: true, email: true },
    });
    const userIdByEmail = new Map(users.map((r) => [r.email, r.id]));
    const allowed: string[] = [];
    for (const address of d.to) {
      const userId = userIdByEmail.get(address);
      if (!userId) {
        allowed.push(address);
        continue;
      }
      if (await this.preferences.allows(d.workspaceId, userId, d.notificationType, 'email')) {
        allowed.push(address);
      }
    }
    return allowed;
  }

  /**
   * These two endpoints take a caller-supplied recipient AND a caller-supplied
   * HTML body, which without a recipient allowlist makes any logged-in user an
   * authenticated open relay sending from the product's domain. Restrict them to
   * addresses the caller can already reach in-product: ACTIVE members of a
   * workspace the caller belongs to. (`send-invitation` is deliberately exempt —
   * an invitee is by definition not a member yet.)
   */
  private async assertRecipientsAreReachable(user: User, to: string[]): Promise<void> {
    const workspaceIds = await this.access.accessibleWorkspaceIds(user);
    if (workspaceIds === null) return; // platform admin
    const recipients = await this.prisma.user.findMany({
      where: { email: { in: to } },
      select: { id: true, email: true },
    });
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        userId: { in: recipients.map((r) => r.id) },
        status: 'ACTIVE',
      },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    const reachable = new Set(recipients.filter((r) => memberIds.has(r.id)).map((r) => r.email));
    if (to.some((address) => !reachable.has(address))) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
  }
}
