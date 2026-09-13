'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMinutesHuman } from '@/lib/utils/time-format';
import { getTimeEntryStatusConfig } from '@/lib/semantic/status';
import { Pencil, Timer, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import type { TimeEntry } from '@/types';

interface TimesheetTableProps {
  entries: TimeEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Rendered as an extra column when supplied (the approvals view). */
  renderActions?: (entry: TimeEntry) => React.ReactNode;
  /** Own-timesheet edit; omitted in the approvals view. */
  onEdit?: (entry: TimeEntry) => void;
  /** Own-timesheet delete; omitted in the approvals view. */
  onDelete?: (entry: TimeEntry) => void;
  showWho?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function TimesheetTable({
  entries,
  isLoading,
  isError,
  onRetry,
  renderActions,
  onEdit,
  onDelete,
  showWho = false,
  emptyTitle = 'No time logged yet',
  emptyDescription = 'Start a timer on a task, or add an entry by hand.',
}: TimesheetTableProps) {
  const hasActions = !!(renderActions || onEdit || onDelete);
  // Date, Task, Description, Duration, Billable, Status + the optional two.
  const columnCount = 6 + (showWho ? 1 : 0) + (hasActions ? 1 : 0);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load time entries"
        description="These entries could not be fetched."
        onRetry={onRetry}
      />
    );
  }

  if (entries.length === 0) {
    return <EmptyState icon={Timer} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    // The table is wide on small screens, so it scrolls inside its own
    // container rather than pushing the page sideways.
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showWho && <TableHead>Member</TableHead>}
            <TableHead>Date</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead>Billable</TableHead>
            <TableHead>Status</TableHead>
            {hasActions && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const status = getTimeEntryStatusConfig(entry.status);
            // A rejected entry is the one the owner most needs to act on, and it
            // used to be the one row with no actions at all: it could not be
            // deleted, corrected or resubmitted, so it sat in the timesheet
            // forever. An approved entry keeps its delete hidden — that record
            // has been signed off — but editing it is still allowed, and the
            // server re-opens it for approval when the numbers change.
            const isDeletable = entry.status === 'PENDING' || entry.status === 'REJECTED';
            return (
              <React.Fragment key={entry.id}>
                <TableRow>
                  {showWho && (
                    <TableCell className="font-medium">{entry.userName || entry.userEmail || '—'}</TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">
                    {entry.startTime ? format(new Date(entry.startTime), 'MMM d, yyyy') : '—'}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate">
                    {entry.taskHierarchyId ? (
                      <span className="text-muted-foreground">{entry.taskHierarchyId} </span>
                    ) : null}
                    {entry.taskTitle || entry.projectName || '—'}
                  </TableCell>
                  <TableCell className="max-w-[20rem]">
                    <div className="truncate">{entry.description || '—'}</div>
                    {/* The Log Time dialog asks for "Tags (comma-separated)", the API
                        stores them and the mapper returns them — and nothing rendered
                        them, so filling the field in was busywork. Under the
                        description rather than in a column of their own, since most
                        entries have none. */}
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entry.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {formatMinutesHuman(entry.duration)}
                  </TableCell>
                  <TableCell>
                    {entry.isBillable ? <Badge variant="secondary">Billable</Badge> : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={status.badgeVariant}>{status.label}</Badge>
                  </TableCell>
                  {hasActions && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {renderActions?.(entry)}
                        {onEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Edit entry"
                            onClick={() => onEdit(entry)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {onDelete && isDeletable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete entry"
                            onClick={() => onDelete(entry)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
                {/* The approver's reason was stored by the API and shown nowhere,
                    so "Rejected" was the whole of the feedback. */}
                {entry.status === 'REJECTED' && entry.rejectionReason && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columnCount} className="pt-0">
                      <div className="rounded-md bg-muted/50 p-3">
                        <p className="text-xs font-medium mb-1">Rejection reason</p>
                        <p className="text-sm text-muted-foreground">{entry.rejectionReason}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
