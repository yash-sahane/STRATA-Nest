import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HrEvents } from '@lt/shared';
import { PrismaService } from '@lt/prisma';
import type { LeaveRequest, Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { LEAVE_TYPE_TO_BALANCE_FIELD, requiredUnits } from './leave-balance';
import { leaveRequestResponse } from './mappers';

/**
 * Application service (arch §3.1) — [NEW] server-side leave approval (D9):
 * approve → mark APPROVED + **deduct the mapped LeaveBalance field** in one
 * transaction, then emit `leave.approved`. Self-approval is blocked even for
 * managers. (Was a client-side PATCH with no balance effect, A§6.8.)
 */
@Injectable()
export class LeaveApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async load(user: User, id: string): Promise<LeaveRequest> {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, req.workspaceId, Permission.LeaveApprove);
    if (req.status !== 'PENDING') throw new BadRequestException('Leave request already handled');
    return req;
  }

  async approve(user: User, id: string) {
    const req = await this.load(user, id);
    if (req.userId === user.id) {
      throw new ForbiddenException('Cannot approve your own leave request'); // self-approval block (D9)
    }

    const year = new Date(req.startDate).getUTCFullYear();
    const balance = await this.prisma.leaveBalance.findFirst({
      where: { workspaceId: req.workspaceId, userId: req.userId, year },
    });
    const field = LEAVE_TYPE_TO_BALANCE_FIELD[req.type] ?? 'paidLeave';
    const units = requiredUnits(req.type, req.daysCount);

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.leaveRequest.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date() },
      }),
    ];
    if (balance) {
      // UNPAID has no limit → increment the used counter; others deduct.
      const delta =
        req.type === 'UNPAID'
          ? { unpaidLeave: { increment: units } }
          : { [field]: { decrement: units } };
      ops.push(
        this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: delta as Prisma.LeaveBalanceUpdateInput,
        }),
      );
    }
    const [updated] = await this.prisma.$transaction(ops);

    this.events.emit(HrEvents.LeaveApproved, {
      name: HrEvents.LeaveApproved,
      workspaceId: req.workspaceId,
      payload: {
        workspaceId: req.workspaceId,
        userId: req.userId,
        leaveRequestId: id,
        type: req.type,
        daysCount: req.daysCount,
      },
      occurredAt: new Date().toISOString(),
    });
    return leaveRequestResponse(updated as LeaveRequest);
  }

  async reject(user: User, id: string, reason?: string) {
    const req = await this.load(user, id);
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectionReason: reason ?? '',
      },
    });
    this.events.emit(HrEvents.LeaveRejected, {
      name: HrEvents.LeaveRejected,
      workspaceId: req.workspaceId,
      payload: {
        workspaceId: req.workspaceId,
        userId: req.userId,
        leaveRequestId: id,
        type: req.type,
        daysCount: req.daysCount,
      },
      occurredAt: new Date().toISOString(),
    });
    return leaveRequestResponse(updated);
  }
}
