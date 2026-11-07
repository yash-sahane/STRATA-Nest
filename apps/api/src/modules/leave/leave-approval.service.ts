import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { EmailKind, HrEvents } from '@strata/shared';
import { businessDayMarker, workScheduleOf } from '@strata/config';
import { PrismaService } from '@strata/prisma';
import type { LeaveRequest, Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { DENY_MESSAGE, WorkspaceAccessService } from '../authz/workspace-access.service';
import { EmailService } from '../email/email.service';
import {
  LEAVE_TYPE_TO_BALANCE_FIELD,
  MAX_LEAVE_RANGE_DAYS,
  countWorkingDays,
  dateOnlyKey,
  ensureLeaveBalance,
  isNonWorkingDay,
  requiredUnits,
} from './leave-balance';
import { renderLeaveDecisionEmail } from './leave-decision-email';
import { leaveRequestResponse } from './mappers';
import { tellPeople } from '../notifications/notice';
import { shareCalendar } from './calendar-lock';
import type { WorkingWeek } from './leave-balance';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The working days a leave actually covers, as date-only UTC-midnight markers
 *  matching the `date` column — a range spanning a weekend must not mark the
 *  weekend as leave. */
function leaveWorkingDays(start: Date, end: Date, schedule: WorkingWeek): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start.getTime());
  for (let i = 0; i <= MAX_LEAVE_RANGE_DAYS && cursor <= end; i += 1) {
    if (!isNonWorkingDay(cursor, schedule)) days.push(new Date(cursor.getTime()));
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
      // Nobody decides their own leave — unless nobody else can. In a workspace
      // with one approver, that person's own requests had nowhere to go: they
      // sat pending for good, the dates reserved and never charged. The only
      // approver decides them; the record shows who approved whose.
      const others = (
        await this.access.membersHolding(req.workspaceId, Permission.LeaveApprove)
      ).filter((id) => id !== user.id);
      if (others.length > 0) {
        throw new ForbiddenException(
          'You cannot approve your own leave request. Somebody else who approves leave here has to.',
        );
      }
    }

    // What approving it costs, from the very figures the claim below matches.
    const units = requiredUnits(req.type, req.daysCount);
    const updated = await this.prisma.$transaction(async (tx) => {
      // The calendar held still while this charges by its days: a holiday
      // being declared across the request waits for the decision, then
      // re-counts it (see calendar-lock.ts).
      await shareCalendar(tx, req.workspaceId);
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
      //
      // ...and on the dates, type and days the decision was made against. On
      // the status alone, the requester could change 1 day to 5 between load()
      // and this claim: the request went on record APPROVED for 5 days with 1
      // debited, and cancelling it later refunded 5.
      const claimed = await tx.leaveRequest.updateMany({
        where: {
          id,
          status: 'PENDING',
          type: req.type,
          startDate: req.startDate,
          endDate: req.endDate,
          daysCount: req.daysCount,
        },
        // What it was charged is kept with it: every refund gives back exactly
        // this, never a figure worked out again from the day count (see the
        // leave_charged_units migration). The debit below rolls it back if the
        // balance no longer covers it.
        data: { status: 'APPROVED', approvedBy: user.id, approvedAt: new Date(), chargedUnits: units },
      });
      if (claimed.count === 0) throw await this.notClaimed(tx, id);
      // Everything below reads the row as CLAIMED, never the copy load() made.
      const approved = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      // The leave is charged to the year it is TAKEN in, not the year it is
      // decided in, so a December booking for January debits the January row.
      const year = approved.startDate.getUTCFullYear();
      const field = LEAVE_TYPE_TO_BALANCE_FIELD[approved.type] ?? 'paidLeave';
      const balance = await ensureLeaveBalance(tx, approved.workspaceId, approved.userId, year);
      if (approved.type === 'UNPAID') {
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
      await this.materializeLeaveAttendance(tx, approved);
      return approved;
    });

    this.events.emit(HrEvents.LeaveApproved, {
      name: HrEvents.LeaveApproved,
      workspaceId: updated.workspaceId,
      payload: {
        workspaceId: updated.workspaceId,
        userId: updated.userId,
        leaveRequestId: id,
        type: updated.type,
        daysCount: updated.daysCount,
        approverId: user.id,
      },
      occurredAt: new Date().toISOString(),
    });
    // The decision was a conditional `updateMany`, which the realtime hook
    // cannot see: the requester got the notification while their Leave page
    // still said Pending, and a second approver still saw it waiting.
    this.prisma.announceWrite?.('LeaveRequest', 'update', updated);
    const response = leaveRequestResponse(updated);
    await this.sendDecisionEmail('approved', response, user);
    return response;
  }

  /**
   * Why a claim matched nothing: decided by somebody else first, or changed by
   * its requester since it was read. Read inside the same transaction, so it
   * describes the row that beat the claim.
   */
  private async notClaimed(tx: Prisma.TransactionClient, id: string): Promise<Error> {
    const current = await tx.leaveRequest.findUnique({ where: { id }, select: { status: true } });
    if (current?.status === 'PENDING') {
      return new ConflictException(
        'This request was changed while you were deciding it. Refresh to see the dates and days it asks for now, then decide again.',
      );
    }
    return new BadRequestException('Leave request already handled');
  }

  async reject(user: User, id: string, reason?: string) {
    const req = await this.load(user, id);
    // Your own request is withdrawn, not rejected: rejecting it sent you a
    // "leave rejected" notice about your own decision.
    if (req.userId === user.id) {
      throw new ForbiddenException('Withdraw your own request instead of rejecting it.');
    }
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
    this.prisma.announceWrite?.('LeaveRequest', 'update', updated);
    this.events.emit(HrEvents.LeaveRejected, {
      name: HrEvents.LeaveRejected,
      workspaceId: req.workspaceId,
      payload: {
        workspaceId: req.workspaceId,
        userId: req.userId,
        leaveRequestId: id,
        type: req.type,
        daysCount: req.daysCount,
        approverId: user.id,
        reason: reason ?? '',
      },
      occurredAt: new Date().toISOString(),
    });
    const response = leaveRequestResponse(updated);
    await this.sendDecisionEmail('rejected', response, user, reason);
    return response;
  }

  /**
   * Withdraw a request, or end a leave that is under way.
   *
   * - Not started (pending, or approved for a later day): the requester may
   *   withdraw their own, an approver anybody's. An approved leave gives its
   *   units back in the same transaction that flips the status, so the balance
   *   can never drift from the record. A PENDING request whose dates have
   *   passed is still withdrawable — nobody approved it and it was not taken.
   * - Under way (approved, begun today or earlier, ending today or later):
   *   ended early — see endEarly. That is an approver's call, as approving it
   *   was.
   * - Over: a record of time taken, not changed here.
   */
  async cancel(user: User, id: string) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, req.workspaceId, Permission.HrWrite);
    const own = req.userId === user.id;
    const approves = await this.access.can(user, req.workspaceId, Permission.LeaveApprove);
    if (!own && !approves) throw new ForbiddenException(DENY_MESSAGE);
    if (req.status !== 'PENDING' && req.status !== 'APPROVED') {
      throw new BadRequestException('Leave request already handled');
    }
    const today = await this.businessToday(req.workspaceId);
    // Its first day counts as begun. `<` made a leave starting today still
    // "not started", so its owner could withdraw it in the morning of the day
    // they were off and have that day handed back to their balance too.
    if (req.status === 'APPROVED' && req.startDate.getTime() <= today.getTime()) {
      if (req.endDate.getTime() < today.getTime()) {
        throw new BadRequestException(
          'This leave is over: it is a record of time taken. A balance can be corrected on Team Balances.',
        );
      }
      // Nobody ends their own leave and takes the days back — unless nobody
      // else can (the rule approve() has).
      const othersApprove =
        own &&
        (await this.access.membersHolding(req.workspaceId, Permission.LeaveApprove)).some(
          (approver) => approver !== user.id,
        );
      if (!approves || othersApprove) {
        throw new ForbiddenException(
          'This leave has started. Somebody who approves leave can end it early.',
        );
      }
      return this.endEarly(user, req, today);
    }
    return this.withdraw(user, req);
  }

  /** The workspace's working week, as `countWorkingDays` takes it. */
  private async workingWeekOf(workspaceId: string): Promise<WorkingWeek> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    return workScheduleOf(workspace?.settings);
  }

  /** The workspace's business day, as the date-only marker the `date` columns hold. */
  private async businessToday(workspaceId: string): Promise<Date> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    return businessDayMarker(workScheduleOf(workspace?.settings).timeZone);
  }

  /** Put `units` back where the approval took them from. */
  private async giveBack(tx: Prisma.TransactionClient, req: LeaveRequest, units: number) {
    if (units <= 0) return;
    const balance = await ensureLeaveBalance(tx, req.workspaceId, req.userId, req.startDate.getUTCFullYear());
    const field = LEAVE_TYPE_TO_BALANCE_FIELD[req.type] ?? 'paidLeave';
    const delta =
      req.type === 'UNPAID'
        ? { unpaidLeave: { decrement: Math.min(units, balance.unpaidLeave) } }
        : { [field]: { increment: units } };
    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: delta as Prisma.LeaveBalanceUpdateInput,
    });
  }

  /**
   * End a leave under way: it now ends yesterday. The days not taken go back to
   * the balance and their ON_LEAVE markers come off the calendar. Somebody back
   * early used to stay "on leave" on every screen to the last day, charged for
   * days they worked. A leave none of whose working days has passed yet (it
   * begins today — they are back already — or began on a weekend) was not
   * taken at all, and is withdrawn instead.
   */
  private async endEarly(user: User, req: LeaveRequest, today: Date) {
    const lastDay = new Date(today.getTime() - MS_PER_DAY);
    const schedule = await this.workingWeekOf(req.workspaceId);
    const holidays = await this.prisma.holiday.findMany({
      where: {
        workspaceId: req.workspaceId,
        isOptional: false,
        date: { gte: req.startDate, lte: lastDay },
      },
      select: { date: true },
    });
    const taken = countWorkingDays(
      req.startDate,
      lastDay,
      new Set(holidays.map((holiday) => dateOnlyKey(holiday.date))),
      schedule,
    );
    if (taken === 0) return this.withdraw(user, req);
    // What was charged, less what the days taken cost — never more than was
    // charged: a re-count that could only partly be charged left the day count
    // above the charge, and refunding the difference of day counts gave back a
    // day nobody had paid for.
    const refund = Math.max(0, req.chargedUnits - requiredUnits(req.type, taken));

    const updated = await this.prisma.$transaction(async (tx) => {
      await shareCalendar(tx, req.workspaceId);
      // Claimed on the end, the days and the charge it was decided against: two
      // people ending it at once cannot both give the days back, and the refund
      // is worked out from exactly the figures the claim matched.
      const claimed = await tx.leaveRequest.updateMany({
        where: {
          id: req.id,
          status: 'APPROVED',
          endDate: req.endDate,
          daysCount: req.daysCount,
          chargedUnits: req.chargedUnits,
        },
        data: { endDate: lastDay, daysCount: taken, chargedUnits: req.chargedUnits - refund },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          'This leave request changed while you were ending it. Refresh and try again.',
        );
      }
      await this.giveBack(tx, req, refund);
      await tx.attendance.deleteMany({
        where: {
          workspaceId: req.workspaceId,
          userId: req.userId,
          status: 'ON_LEAVE',
          date: { gte: today, lte: req.endDate },
        },
      });
      return tx.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    });
    this.prisma.announceWrite?.('LeaveRequest', 'update', updated);
    if (user.id !== req.userId) {
      const until = lastDay.toISOString().slice(0, 10);
      tellPeople(this.events, {
        workspaceId: req.workspaceId,
        recipients: [req.userId],
        actorId: user.id,
        type: 'LEAVE_CANCELLED',
        title: 'Your leave was ended early',
        message:
          `${user.name || user.email} ended your leave early: it now ends on ${until}.` +
          (refund > 0 ? ` ${refund} ${refund === 1 ? 'day is' : 'days are'} back on your balance.` : ''),
        relatedEntityId: req.id,
        relatedEntityType: 'LEAVE',
        email: true,
      });
    }
    return leaveRequestResponse(updated);
  }

  /** Withdraw a request that has not started: see cancel. */
  private async withdraw(user: User, req: LeaveRequest) {
    const id = req.id;
    const wasApproved = req.status === 'APPROVED';
    // Exactly what approving it took — see the leave_charged_units migration.
    const units = wasApproved ? req.chargedUnits : 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      await shareCalendar(tx, req.workspaceId);
      // Claim on the status this cancellation was decided against, so two
      // simultaneous cancellations cannot both refund the allowance and a
      // cancellation cannot race an approval into refunding a debit that the
      // approval had not yet made — and on the end, days and charge the refund
      // below is worked out from, so an early end landing first cannot be
      // refunded twice.
      const claimed = await tx.leaveRequest.updateMany({
        where: {
          id,
          status: req.status,
          endDate: req.endDate,
          daysCount: req.daysCount,
          chargedUnits: req.chargedUnits,
        },
        data: { status: 'CANCELLED', chargedUnits: 0 },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          'This leave request changed while you were cancelling it. Refresh and try again.',
        );
      }
      if (wasApproved) await this.giveBack(tx, req, units);
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
    this.prisma.announceWrite?.('LeaveRequest', 'update', updated);
    await this.announceCancelled(user, req, wasApproved);
    return leaveRequestResponse(updated);
  }

  /**
   * A request withdrawn. Whoever did not do it is told: the approvers when its
   * owner takes it back (they were holding it, or had planned around it), the
   * owner when an approver cancels it for them. Nobody was told either way —
   * an approved absence could vanish from the calendar without a word.
   */
  private async announceCancelled(
    actor: User,
    req: LeaveRequest,
    wasApproved: boolean,
  ): Promise<void> {
    const range =
      req.startDate.getTime() === req.endDate.getTime()
        ? req.startDate.toISOString().slice(0, 10)
        : `${req.startDate.toISOString().slice(0, 10)} to ${req.endDate.toISOString().slice(0, 10)}`;
    const byOwner = actor.id === req.userId;
    const who = actor.name || actor.email;
    tellPeople(this.events, {
      workspaceId: req.workspaceId,
      recipients: byOwner
        ? await this.access.membersHolding(req.workspaceId, Permission.LeaveApprove)
        : [req.userId],
      actorId: actor.id,
      type: 'LEAVE_CANCELLED',
      title: byOwner ? `Leave cancelled: ${who}` : 'Your leave was cancelled',
      message: byOwner
        ? `${who} cancelled their ${wasApproved ? 'approved leave' : 'leave request'} for ${range}.`
        : `${who} cancelled your ${wasApproved ? 'approved leave' : 'leave request'} for ${range}.${wasApproved ? ' The days are back on your balance.' : ''}`,
      relatedEntityId: req.id,
      // The approvers' copy opens their queue; the requester's, their own list.
      relatedEntityType: byOwner ? 'LEAVE_REQUEST' : 'LEAVE',
      email: true,
    });
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
    // A declared holiday inside the range is not a leave day — the request was
    // not charged for it, and the office is shut. The markers used to be laid
    // without consulting the calendar, so the team view showed somebody "on
    // leave" on a day nobody was working.
    const holidays = new Set(
      (
        await tx.holiday.findMany({
          where: {
            workspaceId: req.workspaceId,
            isOptional: false,
            date: { gte: req.startDate, lte: req.endDate },
          },
          select: { date: true },
        })
      ).map((holiday) => dateOnlyKey(holiday.date)),
    );
    const workspace = await tx.workspace.findUnique({
      where: { id: req.workspaceId },
      select: { settings: true },
    });
    const days = leaveWorkingDays(req.startDate, req.endDate, workScheduleOf(workspace?.settings)).filter(
      (day) => !holidays.has(dateOnlyKey(day)),
    );
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
    // The only approver deciding their own request needs no mail about it.
    if (req.userId === approver.id) return;
    try {
      const employee = await this.prisma.user.findUnique({
        where: { id: req.userId },
        select: { email: true, name: true },
      });
      if (!employee?.email) return;
      // The recipient's own choice for this notification's mail. Decisions used
      // to be mailed whatever it said, and the preferences screen listed them
      // as "not sent by email".
      const preference = await this.prisma.notificationPreference.findUnique({
        where: {
          workspaceId_userId_type: {
            workspaceId: req.workspaceId,
            userId: req.userId,
            type: decision === 'approved' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
          },
        },
        select: { email: true },
      });
      if (preference && !preference.email) return;
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
