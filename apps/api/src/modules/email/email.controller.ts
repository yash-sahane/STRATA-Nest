import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmailKind } from '@strata/shared';
import { SendGenericEmailDto, SendInvitationEmailDto } from './dto';
import { EmailService } from './email.service';

/**
 * The `email/send-*` endpoints (frozen request/response contract). They
 * ENQUEUE and return an optimistic `{success, backend, sent, queued}` —
 * delivery is async + retried.
 */
@ApiTags('email')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Post('send-invitation')
  @HttpCode(200)
  sendInvitation(@Body() d: SendInvitationEmailDto) {
    const html = `
    <h2>Hi,</h2>
    <p>${d.inviterName} has invited you to join the <strong>${d.workspaceName}</strong>
    workspace on STRATA.</p>
    <p>Your invitation code is: <code>${d.inviteCode}</code></p>
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
  sendLeave(@Body() d: SendGenericEmailDto) {
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
  sendNotification(@Body() d: SendGenericEmailDto) {
    return this.email.send({
      kind: EmailKind.Notification,
      to: d.to,
      subject: d.subject,
      text: d.text ?? '',
      html: d.html,
    });
  }
}
