'use client';

import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';

import * as React from 'react';
import { Calendar, Users, BarChart3 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LeaveRequestForm } from '@/components/leave/leave-request-form';
import { LeaveApprovalCard } from '@/components/leave/leave-approval-card';
import { LeaveBalanceDisplay } from '@/components/leave/leave-balance-display';
import { LeaveStatusBadge } from '@/components/leave/leave-status-badge';
import {
  useCancelLeaveRequest,
  useLeaveBalance,
  useLeaveRequests,
  useTeamLeaveRequests,
  type LeaveRequest,
} from '@/hooks/use-leave';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useLeaveRequestsRealtime } from '@/hooks/use-realtime';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { formatLeaveDateRange } from '@/lib/leave-utils';
import { parseDateOnly, todayDateOnly } from '@/lib/utils/working-days';
import { ApiError } from '@/lib/api/rest-client';

export default function LeavePage() {
  const { user } = useAuth();
  const { currentWorkspaceId } = useCurrentWorkspace();
  // Live updates: the gateway already broadcasts every write on this
  // collection, this page just never subscribed — so another member's
  // change only appeared after a manual navigation.
  useLeaveRequestsRealtime(currentWorkspaceId || undefined);
  const [activeTab, setActiveTab] = React.useState('my-leaves');
  const [isLeaveFormOpen, setIsLeaveFormOpen] = React.useState(false);

  // isError as well as isLoading: `data = []` is what React Query leaves behind
  // after a failed fetch too, so branching on length alone told a user with
  // live requests "No leave requests yet" and a manager "There are no pending
  // leave requests from your team members" — with no error and nothing to retry.
  const {
    data: myLeaves = [],
    isLoading: myLeavesLoading,
    isError: myLeavesError,
    refetch: refetchMyLeaves,
  } = useLeaveRequests(user?.id, currentWorkspaceId || undefined);
  const {
    data: teamLeaves = [],
    isLoading: teamLeavesLoading,
    isError: teamLeavesError,
    refetch: refetchTeamLeaves,
  } = useTeamLeaveRequests(currentWorkspaceId || undefined);
  const cancelLeaveRequest = useCancelLeaveRequest();
  // Taking leave is an entitlement of MEMBERSHIP, not of role — managers take
  // leave too, so this is not role-gated. But `GET /leave_balances/me` 403s for
  // somebody who holds no membership here (a platform admin browsing another
  // team's workspace), and they have no allowance to spend: offering them the
  // form would only ever end in a failed submit. Same cache entry the form and
  // the Balance tab read, so it costs no extra request.
  //
  // ONLY the 403 disables the button. `isError` is true for any terminal
  // failure — a 5xx, an offline blip, a 400 from a bad workspaceId — and React
  // Query leaves it set after its retries are exhausted, so a member with a
  // perfectly good allowance got the primary action greyed out under the
  // affirmatively wrong explanation "You have no leave balance". For anything
  // else, keep the button live and let the submit report the real error.
  const { error: leaveBalanceError } = useLeaveBalance(currentWorkspaceId || undefined);
  const noLeaveEntitlement = leaveBalanceError instanceof ApiError && leaveBalanceError.code === 403;

  // A request can be withdrawn while it has not started and has not been
  // decided against; the server restores any deducted balance.
  /**
   * A PENDING request can always be withdrawn; an APPROVED one only before it
   * starts.
   *
   * Both used to require `startDate >= today`, which left a pending request whose
   * start date had passed unwithdrawable forever — nobody had approved it, the
   * leave had not been taken, and there was no control to remove it. It also
   * stayed approvable, so an approver could later debit the balance for days
   * already in the past. The server enforces the same distinction.
   */
  const isCancellable = (leave: LeaveRequest) => {
    if (leave.status === 'PENDING') return true;
    return (
      leave.status === 'APPROVED' &&
      parseDateOnly(leave.startDate) >= parseDateOnly(todayDateOnly())
    );
  };

  // Filter team leaves (exclude own requests)
  const teamLeaveRequests = teamLeaves.filter((leave) => leave.userId !== user?.id);

  // Approving leave is a WORKSPACE permission, not a global account role: the
  // old check read User.role (and an 'ADMIN' value no role matrix defines), so
  // it both offered the queue to people the server 403s and hid it from a
  // manager of this workspace. The server is the enforcement point either way
  // (leave-approval.service asserts leave:approve).
  const canApproveLeave = useHasPermission(Permission.APPROVE_LEAVE);

  // Count pending requests
  const pendingCount = myLeaves.filter((leave) => leave.status === 'PENDING').length;
  const teamPendingCount = teamLeaveRequests.filter(
    (leave) => leave.status === 'PENDING'
  ).length;

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-muted-foreground">Please log in to view leave management</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Leave Management"
        description="Manage your leave requests and view your leave balance"
        actions={
          <Button
            onClick={() => setIsLeaveFormOpen(true)}
            disabled={!currentWorkspaceId || noLeaveEntitlement}
            title={
              noLeaveEntitlement
                ? 'You have no leave balance in this workspace.'
                : undefined
            }
          >
            <Calendar className="mr-2 h-4 w-4" />
            Request Leave
          </Button>
        }
      />

      {/* Leave Request Form Dialog — needs a workspace to read a balance against. */}
      {currentWorkspaceId && (
        <LeaveRequestForm
          open={isLeaveFormOpen}
          onOpenChange={setIsLeaveFormOpen}
          userId={user.id}
          workspaceId={currentWorkspaceId}
        />
      )}

      {/* Tabs */}
      {/* Switching to a workspace where the caller cannot approve removes the
          team tab, so fall back rather than render an empty panel. */}
      <Tabs
        value={!canApproveLeave && activeTab === 'team-leaves' ? 'my-leaves' : activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList
          className={`grid w-full max-w-md ${canApproveLeave ? 'grid-cols-3' : 'grid-cols-2'}`}
        >
          <TabsTrigger value="my-leaves" className="relative">
            <Calendar className="h-4 w-4 mr-2" />
            My Leaves
            {pendingCount > 0 && (
              // `variant="warning"` (bg-warning + a near-black foreground), not
              // a raw bg-yellow-500: with no variant the badge kept
              // `text-primary-foreground`, which is near-white in light theme —
              // 1.83:1 on that yellow, so the count was unreadable in one theme
              // and fine in the other (bg-warning + warning-foreground measures
              // 8.39:1 in both). The PENDING status badges on the cards below
              // now resolve to the same token through LeaveStatusBadge — they
              // were `bg-yellow-100` (hue ~55) against this amber (hue 38), two
              // different colours for the same fact 40px apart.
              <Badge
                variant="warning"
                className="ml-2 h-5 w-5 p-0 flex items-center justify-center"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          {canApproveLeave && (
            <TabsTrigger value="team-leaves" className="relative">
              <Users className="h-4 w-4 mr-2" />
              Team Leaves
              {teamPendingCount > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-2 h-5 w-5 p-0 flex items-center justify-center"
                >
                  {teamPendingCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="balance">
            <BarChart3 className="h-4 w-4 mr-2" />
            Balance
          </TabsTrigger>
        </TabsList>

        {/* My Leaves Tab */}
        <TabsContent value="my-leaves" className="space-y-4 mt-6">
          {myLeavesLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}>
                  <CardHeader className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : myLeavesError ? (
            <ErrorState
              title="Couldn't load your leave requests"
              description="Your requests are still there — this is a connection problem."
              onRetry={() => void refetchMyLeaves()}
            />
          ) : myLeaves.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No leave requests yet"
              description="Use the Request Leave button above to submit your first leave request."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {myLeaves.map((leave) => (
                <Card key={leave.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">
                          {formatLeaveDateRange(leave.startDate, leave.endDate)}
                        </CardTitle>
                        <CardDescription>
                          {leave.leaveType === 'HALF_DAY'
                            ? 'Half day'
                            : `${leave.days} ${leave.days === 1 ? 'day' : 'days'}`}
                        </CardDescription>
                      </div>
                      <LeaveStatusBadge status={leave.status} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {/* Clamped to two lines with no way to read the rest, on the
                          screen where somebody decides whether to approve it. The
                          full text is right here, so it is available on hover and to
                          a screen reader, and the clamp lifts on focus for anyone
                          working from the keyboard. */}
                      <p
                        className="text-sm text-muted-foreground line-clamp-2 focus-visible:line-clamp-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        title={leave.reason}
                        tabIndex={0}
                      >
                        {leave.reason}
                      </p>
                      {leave.rejectionReason && (
                        <div className="mt-3 p-3 bg-muted/30 rounded-md">
                          <p className="text-xs font-medium mb-1">Rejection Reason:</p>
                          <p className="text-sm text-muted-foreground">
                            {leave.rejectionReason}
                          </p>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground pt-2">
                        Requested on {new Date(leave.createdAt).toLocaleDateString()}
                      </div>
                      {isCancellable(leave) && (
                        <div className="pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={cancelLeaveRequest.isPending}
                            onClick={() => cancelLeaveRequest.mutate(leave.id)}
                          >
                            Cancel Request
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Team Leaves Tab (Managers only) */}
        {canApproveLeave && (
          <TabsContent value="team-leaves" className="space-y-4 mt-6">
            {teamLeavesLoading ? (
              <div className="grid gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardHeader className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-32 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : teamLeavesError ? (
              <ErrorState
                title="Couldn't load your team's leave requests"
                description="Pending approvals may be waiting — this is a connection problem, not an empty queue."
                onRetry={() => void refetchTeamLeaves()}
              />
            ) : teamLeaveRequests.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No team leave requests"
                description="There are no pending leave requests from your team members."
              />
            ) : (
              <>
                {/* Pending Requests */}
                {teamLeaveRequests.filter((leave) => leave.status === 'PENDING').length >
                  0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      Pending Approvals
                      <Badge variant="secondary">{teamPendingCount}</Badge>
                    </h3>
                    <div className="grid gap-4">
                      {teamLeaveRequests
                        .filter((leave) => leave.status === 'PENDING')
                        .map((leave) => (
                          <LeaveApprovalCard
                            key={leave.id}
                            leaveRequest={leave}
                            approverId={user.id}
                            approverName={user.name || user.email}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Processed Requests */}
                {teamLeaveRequests.filter(
                  (leave) => leave.status === 'APPROVED' || leave.status === 'REJECTED'
                ).length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Recently Processed</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {teamLeaveRequests
                        .filter(
                          (leave) =>
                            leave.status === 'APPROVED' || leave.status === 'REJECTED'
                        )
                        .slice(0, 6)
                        .map((leave) => (
                          <LeaveApprovalCard
                            key={leave.id}
                            leaveRequest={leave}
                            approverId={user.id}
                            approverName={user.name || user.email}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        )}

        {/* Leave Balance Tab */}
        <TabsContent value="balance" className="space-y-4 mt-6">
          <LeaveBalanceDisplay />
        </TabsContent>
      </Tabs>
    </div>
  );
}
