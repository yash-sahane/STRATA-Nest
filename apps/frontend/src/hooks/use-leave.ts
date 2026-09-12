import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { type LeaveType, type LeaveStatus, requiredBalanceUnits } from '@/lib/leave-utils';
import {
  getBalanceFieldForLeaveType,
  type LeaveBalanceField,
} from '@/lib/leave-balance-mapper';
import { Permission, hasPermission, type Role } from '@/lib/permissions';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Helper: Map the API leave resource to LeaveRequest.
 * The API uses "type" while the TypeScript interface uses "leaveType".
 * The API uses "daysCount" while the TypeScript interface uses "days".
 */
function mapToLeaveRequest(doc: any): LeaveRequest {
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

      const response = await resources.listAll('leave_requests', queries);

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

      const response = await resources.listAll('leave_requests', queries);

      // Fetch each requester ONCE. Resolving per row issued one request per
      // leave request (up to 100) even though a queue is usually a handful of
      // people with several requests each.
      const userIds = Array.from(
        new Set(response.items.map((request: any) => request.userId).filter(Boolean))
      ) as string[];
      const users = new Map<string, any>();
      await Promise.all(
        userIds.map(async (id) => {
          try {
            users.set(id, await resources.get('users', id));
          } catch {
            // A requester whose account is gone still shows their request.
          }
        })
      );

      return response.items.map((request: any) => {
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
      const leaveRequest = await resources.create('leave_requests', id.unique(),
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

      toast({
        title: 'Leave Request Submitted',
        description: 'Your leave request has been submitted for approval.',
      });

      // Notify managers about new leave request
      if (variables.workspaceId) {
        try {
          // Who can APPROVE this, resolved from the permission set each role
          // actually carries — not from what the role happens to be CALLED.
          //
          // The old test was `role.includes('manager') || role.includes('admin')`,
          // which had three independent faults: a custom role holding
          // leave:approve but named 'Team Lead' / 'HR' / 'Approver' was never
          // notified (so the request sat in a queue nobody was told about); any
          // role whose name merely contained 'manager' WAS notified whether or
          // not it could act; and it read `role` off the row without checking
          // `status`, so deactivated and still-invited members were paged.
          //
          // listAll, not list: approvers past the first page were silently
          // skipped in any workspace larger than one page.
          const membersResponse = await resources.listAll('workspace_members', [
            query.equal('workspaceId', variables.workspaceId),
            query.equal('status', 'ACTIVE'),
          ]);

          const managers = membersResponse.items
            .filter((member: { role?: string }) =>
              hasPermission((member.role ?? 'MEMBER') as Role, Permission.APPROVE_LEAVE)
            )
            .map((member: { userId?: string }) => member.userId)
            .filter((userId?: string): userId is string =>
              Boolean(userId) && userId !== variables.userId
            ); // Exclude the requester

          // Send notifications to managers
          if (managers.length > 0) {
            const { createBulkNotifications } = await import('@/hooks/use-notification');
            await createBulkNotifications({
              workspaceId: variables.workspaceId,
              userIds: managers,
              type: 'LEAVE_REQUESTED',
              data: {
                leaveId: leaveRequest.id,
                employeeName: variables.createdByName || 'Employee',
                leaveType: variables.leaveType,
                days: leaveRequest.days,
                startDate: variables.startDate,
                endDate: variables.endDate,
                entityType: 'LEAVE',
              },
            });
          }
        } catch (error) {
          // Don't fail the leave request if notification fails
          logger.error('Failed to notify managers', { error });
        }
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to submit leave request',
        variant: 'destructive',
      });
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
}

/** Approving/cancelling leave writes (or removes) ON_LEAVE attendance rows
 *  server-side, so the attendance views must be refetched too. */
function invalidateAttendance(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['attendance'] });
  queryClient.invalidateQueries({ queryKey: ['teamAttendance'] });
  queryClient.invalidateQueries({ queryKey: ['teamAttendanceRange'] });
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
        await restClient.post(`/api/v1/leave_requests/${data.leaveRequestId}/approve/`)
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);
      invalidateAttendance(queryClient);

      toast({
        title: 'Leave Approved',
        description: 'Leave request has been approved and the employee has been notified.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to approve leave request',
        variant: 'destructive',
      });
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
        await restClient.post(`/api/v1/leave_requests/${data.leaveRequestId}/reject/`, {
          reason: data.rejectionReason,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);

      toast({
        title: 'Leave Rejected',
        description: 'Leave request has been rejected and the employee has been notified.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to reject leave request',
        variant: 'destructive',
      });
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
      const cancelled = await restClient.post(
        `/api/v1/leave_requests/${leaveRequestId}/cancel/`
      );

      return mapToLeaveRequest(cancelled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['teamLeaveRequests'] });
      invalidateLeaveAllowance(queryClient);
      invalidateAttendance(queryClient);
      toast({
        title: 'Leave Cancelled',
        description: 'Your leave request has been cancelled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to cancel leave request',
        variant: 'destructive',
      });
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

      const response = await resources.listAll('leave_requests', [
        query.equal('userId', userId),
        query.equal('workspaceId', workspaceId),
        query.equal('status', 'PENDING'),
      ]);

      response.items.forEach((row: any) => {
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

export interface LeaveAvailability {
  balance?: LeaveBalance;
  /** Units locked up by PENDING requests, per balance field. */
  committed: LeaveUnitsByField;
  /** What a new request can actually draw on: balance minus committed. */
  available: LeaveUnitsByField;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
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
