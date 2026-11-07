import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { isEditConflict } from '@/lib/api/mutation-error';
import type { ApiModels } from '@/lib/api/client';
import { useAuth } from '@/components/providers/auth-provider';
import { formatDate } from '@/lib/utils';
import { formatDateOnly } from '@/lib/utils/working-days';
import { type LeaveType, type LeaveStatus, requiredBalanceUnits } from '@/lib/leave-utils';
import {
  getBalanceFieldForLeaveType,
  type LeaveBalanceField,
} from '@/lib/leave-balance-mapper';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

/**
 * Helper: Map the API leave resource to LeaveRequest.
 * The API uses "type" while the TypeScript interface uses "leaveType".
 * The API uses "daysCount" while the TypeScript interface uses "days".
 */
function mapToLeaveRequest(doc: LeaveRequestRow): LeaveRequest {
  return {
    ...doc,
    leaveType: doc.type,
    days: doc.daysCount,
  };
}

export interface LeaveRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string; // Workspace id for multi-tenant support
  userId: string;
  userName?: string;
  userEmail?: string;
  createdBy?: string;
  createdByName?: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  /** Decision fields, written server-side by the approve/reject endpoints. */
  approvedBy?: string;
  approvedAt?: string | null;
  rejectionReason?: string;
}

/** A leave request as the API sends it, before mapToLeaveRequest renames its fields. */
type LeaveRequestRow = Omit<LeaveRequest, 'leaveType' | 'days'> & {
  type: LeaveType;
  daysCount: number;
};

export interface LeaveBalance {
  id: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  userId: string;
  year: number;
  paidLeave: number;
  /** Days of unpaid leave TAKEN (a counter, not an allowance). */
  unpaidLeave: number;
  halfDay: number;
  compOff: number;
}

// ============================================================================
// Leave Requests
// ============================================================================

/**
 * Get all leave requests for a user
 */
export function useLeaveRequests(userId?: string, workspaceId?: string, status?: LeaveStatus) {
  return useQuery({
    queryKey: ['leaveRequests', userId, workspaceId, status],
    queryFn: async () => {
      if (!userId) return [];

      const queries = [query.equal('userId', userId), query.orderDesc('createdAt')];

      // Without this the list spans every workspace the user belongs to.
      if (workspaceId) {
        queries.push(query.equal('workspaceId', workspaceId));
      }

      if (status) {
        queries.push(query.equal('status', status));
      }

      const response = await resources.listAll<LeaveRequestRow>('leave_requests', queries);

      return response.items.map(mapToLeaveRequest);
    },
    enabled: !!userId,
  });
}

/**
 * Get all leave requests for team (managers view)
 */
export function useTeamLeaveRequests(workspaceId?: string, status?: LeaveStatus) {
  return useQuery({
    queryKey: ['teamLeaveRequests', workspaceId, status],
    queryFn: async () => {
      if (!workspaceId) return [];

      // The workspace filter is what keeps other workspaces' requests out of
      // this queue — the API scopes reads to every workspace the caller is in.
      const queries = [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
        query.limit(100),
      ];

      if (status) {
        queries.push(query.equal('status', status));
      }

      const response = await resources.listAll<LeaveRequestRow>('leave_requests', queries);

      // Fetch each requester ONCE. Resolving per row issued one request per
      // leave request (up to 100) even though a queue is usually a handful of
      // people with several requests each.
      const userIds = Array.from(
        new Set(response.items.map((request) => request.userId).filter(Boolean))
      ) as string[];
      const users = new Map<string, ApiModels.User>();
      await Promise.all(
        userIds.map(async (id) => {
          try {
            users.set(id, await resources.get<ApiModels.User>('users', id));
          } catch {
            // A requester whose account is gone still shows their request.
          }
        })
      );

      return response.items.map((request) => {
        const requester = users.get(request.userId);
        return mapToLeaveRequest(
          requester
            ? { ...request, userName: requester.name, userEmail: requester.email }
            : request
        );
      });
    },
    enabled: !!workspaceId,
  });
}

/**
 * Create a new leave request
 */
export function useCreateLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      userId: string;
      leaveType: LeaveType;
      startDate: string;
      endDate: string;
      reason: string;
      createdByName?: string;
    }) => {
      // The server derives daysCount from the range, validates the balance and
      // rejects overlapping requests — no client-side accounting here.
      const leaveRequest = await resources.create<LeaveRequestRow>('leave_requests',
        {
          workspaceId: data.workspaceId,
          type: data.leaveType,
          startDate: data.startDate,
          endDate: data.endDate,
          reason: data.reason,
        }
      );

      return mapToLeaveRequest(leaveRequest);
    },
    onSuccess: async (leaveRequest, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);

      toast.success('Leave Request Submitted', { description: 'Your leave request has been submitted for approval.' });

      // Whoever can approve it is told by the API as part of the request itself —
      // resolved from permissions there, so a custom approver role is included.
    },
    onError: (error: Error) => {
      toast.error('Failed to submit leave request', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

/** Anything that creates or decides a request moves what is bookable: an
 *  approval debits the row, and a rejection or cancellation releases units that
 *  were only committed. Both halves have to be refetched together or the form
 *  keeps quoting a stale "available". */
function invalidateLeaveAllowance(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['leaveBalance'] });
  queryClient.invalidateQueries({ queryKey: ['leaveCommitments'] });
  // The approver's table of everybody's balances reads the same rows. It was
  // refreshed only by an adjustment made from that table, so approving five
  // days and then opening "Adjust" showed — and saved back — the figure from
  // before the approval, handing the five days back.
  queryClient.invalidateQueries({ queryKey: ['teamLeaveBalances'] });
}

/** Approving/cancelling leave writes (or removes) ON_LEAVE attendance rows
 *  server-side, so the attendance views must be refetched too. */
function invalidateAttendance(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['attendance'] });
  queryClient.invalidateQueries({ queryKey: ['teamAttendance'] });
  queryClient.invalidateQueries({ queryKey: ['teamAttendanceRange'] });
}

/** One approved absence, as every member may see it: who, and until when. */
export interface AwayEntry {
  id: string;
  userId: string;
  userName: string;
  /** 'YYYY-MM-DD', inclusive. */
  startDate: string;
  endDate: string;
  /** A single half-day session rather than whole days. */
  halfDay: boolean;
}

/**
 * Who is away — every approved absence in the workspace.
 *
 * The team calendar used to read `useTeamLeaveRequests`, the personal leave
 * list, which gives anybody who does not approve leave only their own. So for
 * most of the team the calendar counted their own absences and said "0 people
 * away" on a day half of them were out. This is a different question with a
 * different answer: that somebody is away, and until when, for everybody — and
 * nothing else about it (no type, no reason).
 *
 * Keyed under 'teamLeaveRequests' so every decision that already refreshes the
 * approval queue refreshes this too.
 *
 * `range` is the span a screen is showing ('YYYY-MM-DD', inclusive). Nothing
 * was sent, and the API's own default window starts about two months back, so
 * a calendar paged back further than that showed nobody away on days the whole
 * team had been out. A screen that pages through dates passes the span it is
 * drawing; the query is keyed on it, so each span is asked for (and cached) on
 * its own, and the previous span stays on screen while the next one loads
 * rather than flashing an empty month. Without one, a year either side of
 * today — the widest span the API answers for.
 */
export function useAwayList(workspaceId?: string, range?: { from: string; to: string }) {
  const span = range ?? yearEitherSide();
  return useQuery({
    queryKey: ['teamLeaveRequests', 'away', workspaceId, span.from, span.to],
    queryFn: async (): Promise<AwayEntry[]> => {
      if (!workspaceId) return [];
      return (await restClient.get('/api/v1/leave_requests/away/', {
        params: { workspaceId, from: span.from, to: span.to },
      })) as AwayEntry[];
    },
    enabled: !!workspaceId,
    // The previous span of THIS workspace only: another workspace's absences
    // must never stand in for this one's, even for a moment.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === workspaceId ? previous : undefined,
  });
}

/** 366 days either side of today, as 'YYYY-MM-DD' — the API caps the span at 732 days. */
function yearEitherSide(): { from: string; to: string } {
  const today = new Date();
  const day = (offset: number) =>
    formatDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  return { from: day(-366), to: day(366) };
}

/** Who decides leave in this workspace. */
export function useLeaveApprovers(workspaceId?: string) {
  return useQuery({
    queryKey: ['leaveApprovers', workspaceId],
    queryFn: async (): Promise<Array<{ userId: string; name: string }>> => {
      if (!workspaceId) return [];
      return (await restClient.get('/api/v1/leave_requests/approvers/', {
        params: { workspaceId },
      })) as Array<{ userId: string; name: string }>;
    },
    enabled: !!workspaceId,
    // Who holds a role changes rarely; no need to ask on every visit.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Approve leave request
 */
export function useApproveLeave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      leaveRequestId: string;
      approverId: string;
      approverName: string;
    }) => {
      // Dedicated approval endpoint: the server authorizes the manager, blocks
      // self-approval, records approver/timestamp, deducts the balance in one
      // transaction, emits the notification event and mails the requester.
      // The decision email is deliberately NOT sent from here: rendering it in
      // the browser meant posting a recipient and an HTML body to the generic
      // mail endpoint, which is an authenticated relay.
      return mapToLeaveRequest(
        await restClient.post<LeaveRequestRow>(
          `/api/v1/leave_requests/${data.leaveRequestId}/approve/`
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);
      invalidateAttendance(queryClient);

      toast.success('Leave Approved', { description: 'Leave request has been approved and the employee has been notified.' });
    },
    onError: (error: Error) => {
      toast.error('Failed to approve leave request', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

/**
 * Reject leave request
 */
export function useRejectLeave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      leaveRequestId: string;
      approverId: string;
      approverName: string;
      rejectionReason: string;
    }) => {
      // Dedicated rejection endpoint: the server authorizes the manager, stores
      // the reason on the record the employee can see, and mails them (see the
      // note on useApproveLeave — the browser never renders that email).
      return mapToLeaveRequest(
        await restClient.post<LeaveRequestRow>(
          `/api/v1/leave_requests/${data.leaveRequestId}/reject/`,
          { reason: data.rejectionReason }
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);

      toast.success('Leave Rejected', { description: 'Leave request has been rejected and the employee has been notified.' });
    },
    onError: (error: Error) => {
      toast.error('Failed to reject leave request', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

/**
 * Cancel leave request
 */
export function useCancelLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leaveRequestId: string) => {
      // Dedicated cancel endpoint: the server enforces "not started yet" and
      // restores any units already deducted in the same transaction.
      const cancelled = await restClient.post<LeaveRequestRow>(
        `/api/v1/leave_requests/${leaveRequestId}/cancel/`
      );

      return mapToLeaveRequest(cancelled);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);
      invalidateAttendance(queryClient);
      // Leave under way is ended early, not withdrawn: it is still approved,
      // and ends sooner. The same button is pressed either way, and the toast
      // said "cancelled" — to an approver, about somebody else's leave, as
      // "Your leave request".
      const endedEarly = result.status === 'APPROVED';
      toast.success(endedEarly ? 'Leave Ended Early' : 'Leave Cancelled', { description: endedEarly
          ? `It now ends on ${formatDate(result.endDate)}. The days not taken are back on the balance.`
          : 'The leave request has been cancelled.' });
    },
    onError: (error: Error) => {
      toast.error('Failed to cancel leave request', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

// ============================================================================
// Leave Balance
// ============================================================================

/** Units per balance field, keyed the way the balance row is. */
export type LeaveUnitsByField = Record<LeaveBalanceField, number>;

const NO_UNITS: LeaveUnitsByField = { paidLeave: 0, unpaidLeave: 0, halfDay: 0, compOff: 0 };

/**
 * Units the caller has already committed to PENDING requests in a year.
 *
 * Approval is what debits the balance row, so an un-decided request is
 * invisible to `paidLeave` — but the server counts it: `assertAffordable` in
 * leave.services.ts subtracts exactly this before deciding what a new request
 * may draw on. Nothing in the browser did, so the Balance tab read "21 / 21
 * days — Good" with 19 days already spoken for, and the request form green-
 * ticked "✓ Sufficient balance available" for a request the very next POST
 * refused with "Insufficient leave balance: 5 day(s) requested, 2 available."
 *
 * UNPAID is skipped for the same reason the server skips it — unpaid leave has
 * no allowance, and `unpaidLeave` counts days taken rather than days left.
 */
export function usePendingLeaveCommitments(workspaceId?: string, year?: number) {
  const targetYear = year ?? new Date().getFullYear();
  // The SAME subject useLeaveBalance resolves. Taking a userId argument was a
  // trap: this half honoured it while the balance half always read
  // `/leave_balances/me`, so the two would have described different people the
  // moment either was reused for anyone but the signed-in user.
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['leaveCommitments', userId, workspaceId, targetYear],
    queryFn: async (): Promise<LeaveUnitsByField> => {
      const committed: LeaveUnitsByField = { ...NO_UNITS };
      if (!userId || !workspaceId) return committed;

      const response = await resources.listAll<LeaveRequestRow>('leave_requests', [
        query.equal('userId', userId),
        query.equal('workspaceId', workspaceId),
        query.equal('status', 'PENDING'),
      ]);

      response.items.forEach((row) => {
        const type = row.type as LeaveType;
        if (!type || type === 'UNPAID') return;
        // The balance is charged to the year the leave STARTS in — the same
        // rule assertAffordable applies, so the two arithmetics agree.
        //
        // Read straight off the ISO string rather than parsing to a Date: the
        // API renders startDate with `toISOString().slice(0, 10)` and charges
        // the year with `getUTCFullYear()`, so the leading four characters ARE
        // the server's year. Going via a local Date to ask for it invites the
        // reader to wonder whether a Dec 31 / Jan 1 request lands in a
        // different year on the two sides.
        if (Number(String(row.startDate).slice(0, 4)) !== targetYear) return;
        const field = getBalanceFieldForLeaveType(type);
        if (!field) return;
        committed[field] += requiredBalanceUnits(type, Number(row.daysCount) || 0);
      });

      return committed;
    },
    enabled: !!userId && !!workspaceId,
  });
}

/**
 * Units the caller's APPROVED requests took from each balance field in a year —
 * what has actually been used, from the records that used it.
 *
 * The Balance tab used to work "used" out as the default allocation minus what
 * is left. Any approver adjustment made that up: a balance raised to 30 read
 * "30 / 21 days — 0 used". Approval debits exactly requiredUnits(type, days)
 * from the field of the year the leave starts in, and ending early or
 * cancelling rewrites or withdraws the request, so summing approved requests
 * the same way gives the units the row has really lost to leave.
 *
 * Keyed under 'leaveCommitments' so every decision, and the leave realtime
 * subscription, refreshes it with the rest of the availability figures.
 */
export function useApprovedLeaveUnits(workspaceId?: string, year?: number) {
  const targetYear = year ?? new Date().getFullYear();
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['leaveCommitments', 'approved', userId, workspaceId, targetYear],
    queryFn: async (): Promise<LeaveUnitsByField> => {
      const used: LeaveUnitsByField = { ...NO_UNITS };
      if (!userId || !workspaceId) return used;

      const response = await resources.listAll<LeaveRequestRow>('leave_requests', [
        query.equal('userId', userId),
        query.equal('workspaceId', workspaceId),
        query.equal('status', 'APPROVED'),
      ]);

      response.items.forEach((row) => {
        const type = row.type as LeaveType;
        // UNPAID has no allowance; its counter is on the row itself.
        if (!type || type === 'UNPAID') return;
        // Charged to the year the leave STARTS in — read off the date-only
        // string, as usePendingLeaveCommitments does and for the same reason.
        if (Number(String(row.startDate).slice(0, 4)) !== targetYear) return;
        const field = getBalanceFieldForLeaveType(type);
        if (!field) return;
        used[field] += requiredBalanceUnits(type, Number(row.daysCount) || 0);
      });

      return used;
    },
    enabled: !!userId && !!workspaceId,
  });
}

export interface LeaveAvailability {
  balance?: LeaveBalance;
  /** Units locked up by PENDING requests, per balance field. */
  committed: LeaveUnitsByField;
  /** What a new request can actually draw on: balance minus committed. */
  available: LeaveUnitsByField;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** Retry both queries, so an error state can offer a way out of a failed load. */
  refetch: () => void;
}

/**
 * The balance row and what is genuinely bookable against it. Every surface that
 * quotes a remaining allowance reads this rather than the raw row, so the form,
 * the Balance tab and the server cannot disagree about how many days are left.
 */
export function useLeaveAvailability(workspaceId?: string, year?: number): LeaveAvailability {
  const balanceQuery = useLeaveBalance(workspaceId, year);
  const commitmentsQuery = usePendingLeaveCommitments(workspaceId, year);

  const balance = balanceQuery.data;
  const committed = commitmentsQuery.data ?? NO_UNITS;

  // Memoized: consumers put this straight into effect and memo dependency
  // lists, and a fresh object every render would re-run all of them.
  const available: LeaveUnitsByField = useMemo(
    () =>
      balance
        ? {
            paidLeave: (balance.paidLeave || 0) - committed.paidLeave,
            // A counter of days taken, not an allowance — nothing is subtracted.
            unpaidLeave: balance.unpaidLeave || 0,
            halfDay: (balance.halfDay || 0) - committed.halfDay,
            compOff: (balance.compOff || 0) - committed.compOff,
          }
        : { ...NO_UNITS },
    [balance, committed]
  );

  return {
    balance,
    committed,
    available,
    isLoading: balanceQuery.isLoading || commitmentsQuery.isLoading,
    isError: balanceQuery.isError || commitmentsQuery.isError,
    error: balanceQuery.error ?? commitmentsQuery.error,
    /** Both halves, so an error state can offer a retry that actually retries. */
    refetch: () => {
      void balanceQuery.refetch();
      void commitmentsQuery.refetch();
    },
  };
}

/**
 * The caller's own leave balance for a year.
 *
 * Reads `GET /leave_balances/me`, which provisions the row with the default
 * allocation on first use — members cannot POST a balance (that needs
 * `leave:approve`), so lazily creating one from the browser always 403'd.
 *
 * SELF ONLY, and it no longer takes a userId to pretend otherwise: the endpoint
 * resolves the signed-in user whatever the caller passes, so an argument that
 * merely keyed the cache read like a subject you could choose. The id comes
 * from the session, which is also where `usePendingLeaveCommitments` gets the
 * one it filters by — the two halves of `useLeaveAvailability` cannot end up
 * describing different people.
 */
export function useLeaveBalance(workspaceId?: string, year?: number) {
  const targetYear = year ?? new Date().getFullYear();
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: ['leaveBalance', userId, workspaceId, targetYear],
    queryFn: async () => {
      const balance = await restClient.get('/api/v1/leave_balances/me/', {
        params: { workspaceId, year: targetYear },
      });

      return balance as LeaveBalance;
    },
    enabled: !!userId && !!workspaceId,
  });
}

// ============================================================================
// Allocation: every member's balance, for whoever approves leave
// ============================================================================

/** A member's balance row with who it belongs to — `GET /leave_balances/team`. */
export interface TeamLeaveBalance extends LeaveBalance {
  userName: string;
  userEmail: string;
  role: string;
}

/**
 * Every active member's balance for a year. Requires `leave:approve`.
 *
 * The server provisions a row for anyone who has never opened their own Leave
 * page, so this is the whole team rather than whoever happened to look.
 */
export function useTeamLeaveBalances(workspaceId?: string, year?: number, enabled = true) {
  const targetYear = year ?? new Date().getFullYear();
  return useQuery({
    queryKey: ['teamLeaveBalances', workspaceId, targetYear],
    queryFn: async () =>
      (await restClient.get('/api/v1/leave_balances/team/', {
        params: { workspaceId, year: targetYear },
      })) as TeamLeaveBalance[],
    enabled: Boolean(workspaceId) && enabled,
  });
}

/** Set one member's allowance. The server refuses a caller's own row. */
export function useAdjustLeaveBalance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      userId: string;
      year: number;
      paidLeave?: number;
      halfDay?: number;
      compOff?: number;
      /**
       * What the figures being changed held when the editor was filled. The
       * figures are absolute and approvals move the same row, so without this
       * an adjustment typed over a stale figure handed back days an approval
       * had just taken. Sent, the API refuses a figure that has moved (409).
       */
      basedOn?: { paidLeave?: number; halfDay?: number; compOff?: number };
    }) => (await restClient.post('/api/v1/leave_balances/adjust/', data)) as LeaveBalance,
    onSuccess: () => {
      // The table, and the member's own view of the same row.
      invalidateLeaveAllowance(queryClient);
      toast.success('Balance updated');
    },
    onError: (error: unknown) => {
      // A refusal because the figure moved is answered with the figures as
      // they are now, so the table must show them too.
      if (isEditConflict(error)) invalidateLeaveAllowance(queryClient);
      toast.error("Couldn't update the balance", { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}
