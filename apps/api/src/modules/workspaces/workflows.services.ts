import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { AcceptInvitationDto } from './dto';

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

    const existing = await this.ensureNotMember(inv.workspaceId, user.id);
    const membershipId = existing?.id ?? generateId();
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.emailInvitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED' } }),
    ];
    if (!existing) {
      ops.push(
        this.prisma.workspaceMember.create({
          data: { id: membershipId, workspaceId: inv.workspaceId, userId: user.id, role: inv.role, status: 'ACTIVE' },
        }),
      );
    }
    await this.prisma.$transaction(ops);

    emit(this.events, WorkspaceEvents.InvitationAccepted, inv.workspaceId, {
      workspaceId: inv.workspaceId,
      userId: user.id,
      invitationId: inv.id,
    });
    if (!existing) {
      emit(this.events, WorkspaceEvents.MemberAdded, inv.workspaceId, {
        workspaceId: inv.workspaceId,
        userId: user.id,
        role: inv.role,
        via: 'invite',
      });
    }
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
    const membershipId = existing?.id ?? generateId();
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.inviteCode.update({ where: { id: invite.id }, data: { usedCount: { increment: 1 } } }),
    ];
    if (!existing) {
      ops.push(
        this.prisma.workspaceMember.create({
          data: { id: membershipId, workspaceId: invite.workspaceId, userId: user.id, role: invite.role, status: 'ACTIVE' },
        }),
      );
    }
    await this.prisma.$transaction(ops);

    if (!existing) {
      emit(this.events, WorkspaceEvents.MemberAdded, invite.workspaceId, {
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
        via: 'invite',
      });
    }
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
