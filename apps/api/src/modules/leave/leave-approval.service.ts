import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { EmailKind, HrEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { LeaveRequest, Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { DENY_MESSAGE, WorkspaceAccessService } from '../authz/workspace-access.service';
import { EmailService } from '../email/email.service';
import {
  LEAVE_TYPE_TO_BALANCE_FIELD,
  MAX_LEAVE_RANGE_DAYS,
  ensureLeaveBalance,
  isNonWorkingDay,
  requiredUnits,
} from './leave-balance';
import { renderLeaveDecisionEmail } from './leave-decision-email';
import { leaveRequestResponse } from './mappers';

/** The working days a leave actually covers, as date-only UTC-midnight markers
 *  matching the `date` column — a range spanning a weekend must not mark the
 *  weekend as leave. */
function leaveWorkingDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start.getTime());
  for (let i = 0; i <= MAX_LEAVE_RANGE_DAYS && cursor <= end; i += 1) {
    if (!isNonWorkingDay(cursor)) days.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Server-side leave decisions: approve → mark APPROVED + **deduct the mapped
 * LeaveBalance field** in one transaction, then emit `leave.approved`; reject
 * records the reason; cancel withdraws a request and gives back any units
 * already deducted. Self-approval is blocked even for managers. Both decisions
 * mail the requester from here, so no recipient or mail body is ever authored
 * by the browser.
 */
@Injectable()
export class LeaveApprovalService {
  private readonly logger = new Logger('Leave');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
    private readonly email: EmailService,
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
      throw new ForbiddenException('Cannot approve your own leave request'); // self-approval block
    }

    // The leave is charged to the year it is TAKEN in, not the year it is
    // decided in, so a December booking for January debits the January row.
    const year = req.startDate.getUTCFullYear();
    const field = LEAVE_TYPE_TO_BALANCE_FIELD[req.type] ?? 'paidLeave';
    const units = requiredUnits(req.type, req.daysCount);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the request FIRST, conditionally on it still being pending.
      //
      // `load()` read the status on an earlier statement, so two approvals fired
      // at the same instant both saw PENDING and both ran this body: the
      // allowance was debited twice for one day of leave, and cancelling
      // refunded it once, so the member was permanently short with nothing in
      // the record to show where the day went. The conditional UPDATE is the
      // gate — the second transaction blocks on the row lock, re-evaluates the
      // predicate against the committed row, matches nothing and rolls back
      // before touching the balance.
      const claimed = await tx.leaveRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date() },
      });
      if (claimed.count === 0) throw new BadRequestException('Leave request already handled');
      const balance = await ensureLeaveBalance(tx, req.workspaceId, req.userId, year);
      if (req.type === 'UNPAID') {
        // UNPAID has no allowance → unpaidLeave counts the days taken.
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { unpaidLeave: { increment: units } },
        });
      } else if (units > 0) {
        // Conditional decrement: the row only moves while it still covers the
        // units, so concurrent approvals can never overdraw it.
        const { count } = await tx.leaveBalance.updateMany({
          where: { id: balance.id, [field]: { gte: units } } as Prisma.LeaveBalanceWhereInput,
          data: { [field]: { decrement: units } } as Prisma.LeaveBalanceUpdateInput,
        });
        if (count === 0) {
          throw new BadRequestException(
            `Insufficient leave balance: ${units} day(s) required, ${balance[field]} available.`,
          );
        }
      }
      await this.materializeLeaveAttendance(tx, req);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    });

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
    const response = leaveRequestResponse(updated);
    await this.sendDecisionEmail('approved', response, user);
    return response;
  }

  async reject(user: User, id: string, reason?: string) {
    const req = await this.load(user, id);
    // Same compare-and-swap as approve: whoever wins the race decides, the loser
    // is told the request was already handled rather than overwriting the
    // decision (and the reason) that is already recorded.
    const claimed = await this.prisma.leaveRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectionReason: reason ?? '',
      },
    });
    if (claimed.count === 0) throw new BadRequestException('Leave request already handled');
    const updated = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
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
    const response = leaveRequestResponse(updated);
    await this.sendDecisionEmail('rejected', response, user, reason);
    return response;
  }

  /**
   * Withdraw a request that has not started yet. The requester may cancel their
   * own; anybody else needs `leave:approve`. An approved leave gives its units
   * back in the same transaction that flips the status, so the balance can
   * never drift from the record.
   */
  async cancel(user: User, id: string) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, req.workspaceId, Permission.HrWrite);
    if (
      req.userId !== user.id &&
      !(await this.access.can(user, req.workspaceId, Permission.LeaveApprove))
    ) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
    if (req.status !== 'PENDING' && req.status !== 'APPROVED') {
      throw new BadRequestException('Leave request already handled');
    }
    const today = new Date();
    const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (req.startDate.getTime() < startOfToday) {
      throw new BadRequestException('Cannot cancel leave that has already started.');
    }

    const wasApproved = req.status === 'APPROVED';
    const year = req.startDate.getUTCFullYear();
    const field = LEAVE_TYPE_TO_BALANCE_FIELD[req.type] ?? 'paidLeave';
    const units = requiredUnits(req.type, req.daysCount);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim on the status this cancellation was decided against, so two
      // simultaneous cancellations cannot both refund the allowance and a
      // cancellation cannot race an approval into refunding a debit that the
      // approval had not yet made.
      const claimed = await tx.leaveRequest.updateMany({
        where: { id, status: req.status },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          'This leave request changed while you were cancelling it. Refresh and try again.',
        );
      }
      if (wasApproved && units > 0) {
        const balance = await ensureLeaveBalance(tx, req.workspaceId, req.userId, year);
        const delta =
          req.type === 'UNPAID'
            ? { unpaidLeave: { decrement: Math.min(units, balance.unpaidLeave) } }
            : { [field]: { increment: units } };
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: delta as Prisma.LeaveBalanceUpdateInput,
        });
      }
      if (wasApproved) {
        // Withdraw the markers the approval wrote. Scoped to ON_LEAVE so a real
        // check-in filed during the leave is never deleted.
        await tx.attendance.deleteMany({
          where: {
            workspaceId: req.workspaceId,
            userId: req.userId,
            status: 'ON_LEAVE',
            date: { gte: req.startDate, lte: req.endDate },
          },
        });
      }
      return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    });
    return leaveRequestResponse(updated);
  }

  /**
   * Persist an approved leave as ON_LEAVE attendance rows. Nothing else in the
   * product ever writes that status, so the team view's "On Leave" filter and
   * the per-day team analytics could never see leave at all.
   *
   * `skipDuplicates` keeps an existing row (a real check-in) untouched, and
   * HALF_DAY is excluded because the member still works — and must still be able
   * to check in — for the other half of the day.
   */
  private async materializeLeaveAttendance(
    tx: Prisma.TransactionClient,
    req: LeaveRequest,
  ): Promise<void> {
    if (req.type === 'HALF_DAY') return;
    const days = leaveWorkingDays(req.startDate, req.endDate);
    if (days.length === 0) return;
    await tx.attendance.createMany({
      data: days.map((date) => ({
        id: generateId(),
        workspaceId: req.workspaceId,
        userId: req.userId,
        date,
        // The column is non-null and a leave day has no real check-in, so it is
        // pinned to the day marker; workHours/checkOutTime stay null.
        checkInTime: date,
        status: 'ON_LEAVE',
        notes: `Approved ${req.type} leave`,
        createdById: req.userId,
        createdByName: req.createdByName,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Mail the requester the decision. Rendered and addressed here, from the
   * stored record — the browser used to POST both the recipient and the HTML to
   * the generic mail endpoint. A mail failure must never fail the decision the
   * database has already committed.
   */
  private async sendDecisionEmail(
    decision: 'approved' | 'rejected',
    req: ReturnType<typeof leaveRequestResponse>,
    approver: User,
    rejectionReason?: string,
  ): Promise<void> {
    try {
      const employee = await this.prisma.user.findUnique({
        where: { id: req.userId },
        select: { email: true, name: true },
      });
      if (!employee?.email) return;
      const { subject, text, html } = renderLeaveDecisionEmail(decision, {
        employeeName: employee.name || employee.email,
        leaveType: req.type,
        startDate: req.startDate,
        endDate: req.endDate,
        daysCount: req.daysCount,
        approverName: approver.name || 'your manager',
        rejectionReason,
      });
      await this.email.send({
        kind: EmailKind.Notification,
        to: employee.email,
        subject,
        text,
        html,
        context: { leaveRequestId: req.id, decision },
        idempotencyKey: `leave-${decision}:${req.id}`,
      });
    } catch (err) {
      this.logger.warn(`leave ${decision} email for ${req.id}: ${(err as Error).message}`);
    }
  }
}
