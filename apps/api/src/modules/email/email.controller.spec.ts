import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { EmailController } from './email.controller';
import type { EmailService } from './email.service';

const caller = { id: 'u1' } as User;

function controller(opts: {
  workspaceIds: string[] | null;
  users?: Array<{ id: string; email: string }>;
  members?: Array<{ userId: string }>;
  /** Per-user email opt-out, keyed by userId; missing = allowed. */
  emailAllowed?: Record<string, boolean>;
}) {
  const send = jest.fn().mockResolvedValue({ success: true, backend: 'queue', sent: true, queued: true });
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(opts.users ?? []) },
    workspaceMember: { findMany: jest.fn().mockResolvedValue(opts.members ?? []) },
  } as unknown as PrismaService;
  const access = {
    accessibleWorkspaceIds: jest.fn().mockResolvedValue(opts.workspaceIds),
  } as unknown as WorkspaceAccessService;
  const allows = jest.fn(async (_w: string, userId: string) => opts.emailAllowed?.[userId] ?? true);
  const preferences = { allows } as unknown as NotificationPreferencesService;
  return {
    ctrl: new EmailController({ send } as unknown as EmailService, prisma, access, preferences),
    send,
    allows,
  };
}

const generic = (to: string[]) => ({ to, subject: 's', html: '<p>hi</p>' });

describe('EmailController recipient allowlist (no authenticated open relay)', () => {
  it('sends to a colleague — an ACTIVE member of a workspace the caller can access', async () => {
    const { ctrl, send } = controller({
      workspaceIds: ['w1'],
      users: [{ id: 'u2', email: 'mate@corp.com' }],
      members: [{ userId: 'u2' }],
    });

    await ctrl.sendLeave(caller, generic(['mate@corp.com']));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses an outsider address (the phishing primitive)', async () => {
    const { ctrl, send } = controller({ workspaceIds: ['w1'] });

    await expect(ctrl.sendNotification(caller, generic(['victim@example.com']))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a member of a workspace the caller is not in', async () => {
    const { ctrl } = controller({
      workspaceIds: ['w1'],
      users: [{ id: 'u3', email: 'stranger@corp.com' }],
      members: [], // no ACTIVE membership in w1
    });

    await expect(ctrl.sendLeave(caller, generic(['stranger@corp.com']))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses the whole batch if one recipient is unreachable', async () => {
    const { ctrl } = controller({
      workspaceIds: ['w1'],
      users: [{ id: 'u2', email: 'mate@corp.com' }],
      members: [{ userId: 'u2' }],
    });

    await expect(
      ctrl.sendLeave(caller, generic(['mate@corp.com', 'victim@example.com'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a platform admin (null scope) send anywhere', async () => {
    const { ctrl, send } = controller({ workspaceIds: null });

    await ctrl.sendLeave(caller, generic(['anyone@example.com']));

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('EmailController honours the recipient’s email opt-out', () => {
  const notif = (to: string[]) => ({
    to,
    subject: 's',
    html: '<p>hi</p>',
    workspaceId: 'w1',
    notificationType: 'TASK_ASSIGNED',
  });

  it('drops a recipient who turned the email channel off for the type', async () => {
    const { ctrl, send } = controller({
      workspaceIds: ['w1'],
      users: [{ id: 'u2', email: 'mate@corp.com' }],
      members: [{ userId: 'u2' }],
      emailAllowed: { u2: false },
    });

    const res = await ctrl.sendNotification(caller, notif(['mate@corp.com']));

    expect(send).not.toHaveBeenCalled();
    expect(res).toEqual({ success: true, backend: 'suppressed', sent: false, queued: false });
  });

  it('still sends to the recipients who did not opt out', async () => {
    const { ctrl, send } = controller({
      workspaceIds: ['w1'],
      users: [
        { id: 'u2', email: 'muted@corp.com' },
        { id: 'u3', email: 'mate@corp.com' },
      ],
      members: [{ userId: 'u2' }, { userId: 'u3' }],
      emailAllowed: { u2: false },
    });

    await ctrl.sendNotification(caller, notif(['muted@corp.com', 'mate@corp.com']));

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['mate@corp.com'] }));
  });

  it('skips the lookup entirely when the caller sends no notification provenance', async () => {
    const { ctrl, send, allows } = controller({
      workspaceIds: ['w1'],
      users: [{ id: 'u2', email: 'mate@corp.com' }],
      members: [{ userId: 'u2' }],
      emailAllowed: { u2: false },
    });

    await ctrl.sendNotification(caller, generic(['mate@corp.com']));

    expect(allows).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('EmailController invitation template', () => {
  it('escapes the interpolated workspace/inviter names', async () => {
    const { ctrl, send } = controller({ workspaceIds: ['w1'] });

    await ctrl.sendInvitation({
      to: 'new@corp.com',
      workspaceName: '<script>alert(1)</script>',
      inviterName: 'A & B',
      inviteCode: 'ABC123',
    });

    const { html } = send.mock.calls[0][0] as { html: string };
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });
});
