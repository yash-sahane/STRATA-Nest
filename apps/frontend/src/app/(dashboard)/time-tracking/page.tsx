'use client';

import * as React from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { TimesheetTable } from '@/components/time-tracking/timesheet-table';
import { ManualTimeEntryDialog } from '@/components/time-tracking/manual-time-entry-dialog';
import { RejectTimeEntryDialog } from '@/components/time-tracking/reject-time-entry-dialog';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTimeEntriesRealtime } from '@/hooks/use-realtime';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import {
  useTimeEntries,
  usePendingTimeEntries,
  useDeleteTimeEntry,
  useApproveTimeEntry,
  useRejectTimeEntry,
  useTimeApprovers,
} from '@/hooks/use-time-entry';
import { formatMinutesHuman } from '@/lib/utils/time-format';
import { Check, Timer, X } from 'lucide-react';
import type { TimeEntry, TimeEntryStatus } from '@/types';
import { useTabParam } from '@/hooks/use-tab-param';

const STATUS_FILTERS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const;

const TIME_TABS = ['mine', 'approvals'] as const;
type TimeTab = (typeof TIME_TABS)[number];

function TimeTrackingContent() {
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useCurrentWorkspace();
  // Realtime: a timer started on another device was invisible here until a refresh.
  useTimeEntriesRealtime(currentWorkspace?.id);
  const confirm = useConfirm();
  const canApprove = useHasPermission(Permission.APPROVE_TIME);
  // In the URL, so "time waiting for your approval" can open Approvals.
  const [activeTab, setActiveTab] = useTabParam<TimeTab>(TIME_TABS, 'mine');
  // Your own entries wait on another approver — unless there is none.
  const { data: timeApprovers = [] } = useTimeApprovers(canApprove ? currentWorkspace?.id : undefined);
  const soleApprover = canApprove && !timeApprovers.some((a) => a.userId !== user?.id);

  const [statusFilter, setStatusFilter] = React.useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [editingEntry, setEditingEntry] = React.useState<TimeEntry | null>(null);
  const [rejectingEntry, setRejectingEntry] = React.useState<TimeEntry | null>(null);

  // Every entry of the caller's, filtered for the table below rather than at
  // the API: the cards above it are totals of the caller's whole timesheet, and
  // filtering the table to "Approved" used to turn "awaiting approval" into 0.
  const mine = useTimeEntries(user?.id, { workspaceId: currentWorkspace?.id });
  const shownEntries = React.useMemo(
    () =>
      statusFilter === 'ALL'
        ? (mine.data ?? [])
        : (mine.data ?? []).filter((e) => e.status === (statusFilter as TimeEntryStatus)),
    [mine.data, statusFilter]
  );
  const pending = usePendingTimeEntries(canApprove ? currentWorkspace?.id : undefined);

  const deleteEntry = useDeleteTimeEntry();
  const approve = useApproveTimeEntry();
  const reject = useRejectTimeEntry();

  const totals = React.useMemo(() => {
    const rows = mine.data ?? [];
    // Rejected hours are hours an approver threw out, so they are not time this
    // workspace owes anyone. Summing every row regardless of status made the
    // timesheet claim a total that included the very entry a manager refused.
    const counted = rows.filter((e) => e.status !== 'REJECTED');
    const minutes = counted.reduce((sum, e) => sum + (e.duration || 0), 0);
    const billable = counted
      .filter((e) => e.isBillable)
      .reduce((sum, e) => sum + (e.duration || 0), 0);
    return {
      entries: rows.length,
      minutes,
      billable,
      awaiting: rows.filter((e) => e.status === 'PENDING').length,
      rejected: rows.length - counted.length,
    };
  }, [mine.data]);

  if (workspaceLoading) {
    return <PageLoader message="Loading timesheet..." />;
  }

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Timer}
          title="Time Tracking"
          description="Review the time you have logged"
        />
        <ErrorState
          title="No workspace selected"
          description="Choose a workspace to see its timesheet."
        />
      </div>
    );
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this entry?',
      description: 'The logged time is removed permanently. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteEntry.mutateAsync({ id, userId: user!.id });
  };

  const handleReject = async (id: string, rejectionReason: string) => {
    try {
      await reject.mutateAsync({ id, workspaceId: currentWorkspace.id, rejectionReason });
    } catch {
      // The mutation toasts on failure; keep the dialog open with the typed reason.
      return;
    }
    setRejectingEntry(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Timer}
        title="Time Tracking"
        description={`Timesheet and approvals for ${currentWorkspace.name}`}
        actions={
          user ? (
            <ManualTimeEntryDialog
              userId={user.id}
            />
          ) : null
        }
      />

      {/* Whose figures these are, in each label. "Awaiting approval 0" sat
          above a tab reading "Approvals 2" — the same words for the caller's
          own entries and for the team's entries waiting on the caller. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'My entries', value: String(totals.entries), excludesRejected: false },
          { label: 'My time logged', value: formatMinutesHuman(totals.minutes), excludesRejected: true },
          { label: 'My billable time', value: formatMinutesHuman(totals.billable), excludesRejected: true },
          {
            label: 'My entries awaiting approval',
            value: String(totals.awaiting),
            excludesRejected: false,
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
              {/* Say so on the card rather than leaving the arithmetic to look wrong. */}
              {stat.excludesRejected && totals.rejected > 0 && (
                <p className="text-xs text-muted-foreground">
                  Excludes {totals.rejected} rejected{' '}
                  {totals.rejected === 1 ? 'entry' : 'entries'}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs
        value={canApprove ? activeTab : 'mine'}
        onValueChange={(v) => setActiveTab(v as TimeTab)}
        className="space-y-6"
      >
        <TabsList className={canApprove ? 'grid w-full grid-cols-2 sm:w-fit' : 'grid w-full grid-cols-1 sm:w-fit'}>
          <TabsTrigger value="mine">My Timesheet</TabsTrigger>
          {/* Gated on the same permission the API enforces for
              POST /time_entries/:id/approve, so the tab never offers a
              control whose submit would 403. */}
          {canApprove && (
            <TabsTrigger value="approvals">
              Approvals
              {(pending.data?.length ?? 0) > 0 && (
                // h-5 py-0: the badge sits inside the trigger's 20px line. At its
                // default 22px it made this tab 34px against its neighbour's 32px.
                <Badge variant="secondary" className="ml-2 h-5 px-1.5 py-0">
                  {pending.data?.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="mine">
          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">My Timesheet</CardTitle>
                <CardDescription>Every entry you have logged in this workspace</CardDescription>
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as (typeof STATUS_FILTERS)[number])}
              >
                <SelectTrigger className="w-[170px]" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === 'ALL' ? 'All statuses' : s.charAt(0) + s.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <TimesheetTable
                entries={shownEntries}
                isLoading={mine.isLoading}
                isError={mine.isError}
                onRetry={() => mine.refetch()}
                onEdit={(entry) => setEditingEntry(entry)}
                onDelete={(entry) => handleDelete(entry.id)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {canApprove && (
          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending Approvals</CardTitle>
                <CardDescription>
                  {soleApprover
                    ? 'Time submitted by the team. You are the only approver here, so your own entries are yours to approve.'
                    : 'Time submitted by the team. Your own entries are approved by another approver.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TimesheetTable
                  entries={pending.data ?? []}
                  isLoading={pending.isLoading}
                  isError={pending.isError}
                  onRetry={() => pending.refetch()}
                  showWho
                  emptyTitle="Nothing awaiting approval"
                  emptyDescription="Time entries submitted by the team will appear here."
                  renderActions={(entry) => {
                    const busy =
                      (approve.isPending && approve.variables?.id === entry.id) ||
                      (reject.isPending && reject.variables?.id === entry.id);
                    const isOwn = entry.userId === user?.id;
                    // Said in words beside the entry: a title on a disabled
                    // button is shown to nobody.
                    if (isOwn && !soleApprover) {
                      return (
                        <span className="text-xs text-muted-foreground">
                          Another approver decides your own time
                        </span>
                      );
                    }
                    return (
                      <>
                        {!isOwn && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setRejectingEntry(entry)}
                          >
                            <X className="h-4 w-4" />
                            Reject
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            approve.mutateAsync({
                              id: entry.id,
                              workspaceId: currentWorkspace.id,
                              approvedBy: user!.id,
                            })
                          }
                        >
                          <Check className="h-4 w-4" />
                          Approve
                        </Button>
                      </>
                    );
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Keyed on the entry so the form is seeded from the row that was clicked
          rather than from whichever entry was edited first. */}
      {editingEntry && user && (
        <ManualTimeEntryDialog
          key={editingEntry.id}
          entry={editingEntry}
          userId={user.id}
          open
          onOpenChange={(open) => !open && setEditingEntry(null)}
        />
      )}

      {rejectingEntry && (
        <RejectTimeEntryDialog
          key={rejectingEntry.id}
          entry={rejectingEntry}
          open
          onOpenChange={(open) => !open && setRejectingEntry(null)}
          onConfirm={(reason) => handleReject(rejectingEntry.id, reason)}
          isPending={reject.isPending}
        />
      )}
    </div>
  );
}

// useTabParam reads useSearchParams(), which needs a Suspense boundary above it.
export default function TimeTrackingPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading time tracking..." />}>
      <TimeTrackingContent />
    </React.Suspense>
  );
}
