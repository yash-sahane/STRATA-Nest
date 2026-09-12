import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { AcceptInvitationDto } from './dto';
import { closePendingJoinRequests } from './join-request-sync';

export interface JoinResult {
  success: true;
  workspaceId: string;
  role?: string;
  userId?: string;
  membershipId: string;
}

function emit(events: EventEmitter2, name: string, workspaceId: string, payload: Record<string, unknown>): void {
  events.emit(name, { name, workspaceId, payload, occurredAt: new Date().toISOString() });
}

/**
 * Application service: accepting an email invitation or invite code
 * is a cross-aggregate workflow (invitation + membership) — one transaction, one
 * post-commit event, handled entirely server-side.
 */
@Injectable()
export class InvitationAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  async accept(user: User, dto: AcceptInvitationDto): Promise<JoinResult> {
    if (dto.token) return this.acceptEmail(user, dto.token);
    if (dto.code) return this.acceptCode(user, dto.code);
    throw new BadRequestException('Provide an invitation token or an invite code');
  }

  private async ensureNotMember(workspaceId: string, userId: string) {
    return this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  }

  private async acceptEmail(user: User, token: string): Promise<JoinResult> {
    const inv = await this.prisma.emailInvitation.findUnique({ where: { token } });
    if (!inv || inv.status !== 'PENDING') throw new BadRequestException('Invalid or used invitation');
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invitation expired');
    // The invitation is bound to the address it was issued for: a forwarded or
    // scraped token must not let a different account join at the invited role.
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was issued for a different e-mail address');
    }

    const existing = await this.ensureNotMember(inv.workspaceId, user.id);
    // Already a member: nothing to grant, and consuming the invitation would
    // only burn it (the real invitee could never use it afterwards). A request
    // to join can still be sitting in the queue, though, so settle it here too:
    // this is the state the reconciliation exists for, reached by an earlier
    // route.
    if (existing) {
      await closePendingJoinRequests(this.prisma, inv.workspaceId, user.id);
      return {
        success: true,
        workspaceId: inv.workspaceId,
        role: existing.role,
        membershipId: existing.id,
      };
    }

    // The invitation row is the only source of the role that gets written into
    // the membership, and rows predating creation-time validation (or a role
    // deleted since) would land a membership nobody can authorize — it silently
    // falls to the read-only floor. Re-check at the moment of the grant.
    await this.access.assertValidRole(inv.workspaceId, inv.role);

    const membershipId = generateId();
    await this.prisma.$transaction([
      this.prisma.emailInvitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED' } }),
      this.prisma.workspaceMember.create({
        data: { id: membershipId, workspaceId: inv.workspaceId, userId: user.id, role: inv.role, status: 'ACTIVE' },
      }),
      // Same commit as the membership: the queue must never show a pending
      // request for somebody this transaction has just let in.
      closePendingJoinRequests(this.prisma, inv.workspaceId, user.id),
    ]);

    emit(this.events, WorkspaceEvents.InvitationAccepted, inv.workspaceId, {
      workspaceId: inv.workspaceId,
      userId: user.id,
      invitationId: inv.id,
    });
    emit(this.events, WorkspaceEvents.MemberAdded, inv.workspaceId, {
      workspaceId: inv.workspaceId,
      userId: user.id,
      role: inv.role,
      via: 'invite',
    });
    return { success: true, workspaceId: inv.workspaceId, role: inv.role, membershipId };
  }

  private async acceptCode(user: User, code: string): Promise<JoinResult> {
    const invite = await this.prisma.inviteCode.findUnique({ where: { code } });
    if (!invite) throw new BadRequestException('Invalid invite code');
    if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestException('Invite code expired');
    if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
      throw new BadRequestException('Invite code exhausted');
    }

    const existing = await this.ensureNotMember(invite.workspaceId, user.id);
    // Already a member: the code grants nothing, so incrementing `usedCount`
    // only burns capacity the real invitees need — one member re-submitting a
    // code they already redeemed could exhaust `maxUses` for everyone else.
    // Same reasoning as the e-mail path above, which leaves its invitation
    // PENDING. The role reported back is the membership's actual role, not the
    // code's, which may differ.
    if (existing) {
      await closePendingJoinRequests(this.prisma, invite.workspaceId, user.id);
      return {
        success: true,
        workspaceId: invite.workspaceId,
        role: existing.role,
        membershipId: existing.id,
      };
    }

    // Same defence as the e-mail path: never write a role the workspace
    // cannot resolve into a permission set.
    await this.access.assertValidRole(invite.workspaceId, invite.role);

    const membershipId = generateId();
    /**
     * Claim a seat atomically rather than trusting the count read above.
     *
     * The `usedCount >= maxUses` check at the top of this method is a fast, clear
     * rejection — but it is check-then-act: two people redeeming the last seat at
     * the same instant both read the same count, both passed, and both joined.
     * (Reproduced: a maxUses=1 code admitted two members and left usedCount=2.)
     *
     * The conditional UPDATE below re-tests the limit inside the write. Postgres
     * takes a row lock for it, so the second transaction re-evaluates against the
     * committed count, matches no rows, and is refused. Both statements share one
     * transaction, so a membership that cannot be created gives its seat back.
     */
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inviteCode.updateMany({
        where: {
          id: invite.id,
          ...(invite.maxUses !== null ? { usedCount: { lt: invite.maxUses } } : {}),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Invite code exhausted');
      }
      await tx.workspaceMember.create({
        data: { id: membershipId, workspaceId: invite.workspaceId, userId: user.id, role: invite.role, status: 'ACTIVE' },
      });
      await closePendingJoinRequests(tx, invite.workspaceId, user.id);
    });

    emit(this.events, WorkspaceEvents.MemberAdded, invite.workspaceId, {
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
      via: 'invite',
    });
    return { success: true, workspaceId: invite.workspaceId, role: invite.role, membershipId };
  }
}

/**
 * Application service: approving/rejecting a join request spans the
 * request + membership. Approver must hold `join:manage`.
 */
@Injectable()
export class JoinRequestApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async load(user: User, requestId: string) {
    const req = await this.prisma.joinRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, req.workspaceId, Permission.JoinManage);
    if (req.status !== 'PENDING') throw new BadRequestException('Join request already handled');
    return req;
  }

  async approve(user: User, requestId: string): Promise<JoinResult> {
    const req = await this.load(user, requestId);
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: req.workspaceId, userId: req.userId },
    });
    const membershipId = existing?.id ?? generateId();
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.joinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', handledById: user.id },
      }),
    ];
    if (!existing) {
      ops.push(
        this.prisma.workspaceMember.create({
          data: { id: membershipId, workspaceId: req.workspaceId, userId: req.userId, role: 'MEMBER', status: 'ACTIVE' },
        }),
      );
    }
    await this.prisma.$transaction(ops);

    emit(this.events, WorkspaceEvents.JoinRequestApproved, req.workspaceId, {
      workspaceId: req.workspaceId,
      userId: req.userId,
      requestId,
    });
    if (!existing) {
      emit(this.events, WorkspaceEvents.MemberAdded, req.workspaceId, {
        workspaceId: req.workspaceId,
        userId: req.userId,
        role: 'MEMBER',
        via: 'join',
      });
    }
    return { success: true, workspaceId: req.workspaceId, userId: req.userId, membershipId };
  }

  async reject(user: User, requestId: string): Promise<{ success: true }> {
    const req = await this.load(user, requestId);
    await this.prisma.joinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', handledById: user.id },
    });
    emit(this.events, WorkspaceEvents.JoinRequestRejected, req.workspaceId, {
      workspaceId: req.workspaceId,
      userId: req.userId,
      requestId,
    });
    return { success: true };
  }
}
