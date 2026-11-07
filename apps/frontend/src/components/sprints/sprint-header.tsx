'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarX, CheckCircle2, PlayCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { NoAccess } from '@/components/ui/no-access';
import { ApiError } from '@/lib/api/rest-client';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useHasPermission } from '@/hooks/use-permissions';
import { useIsProjectArchived } from '@/hooks/use-project';
import { ArchivedProjectBanner } from '@/components/projects/archived-project-banner';
import { useCompleteSprint, useSprints, useStartSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import { Permission } from '@/lib/permissions';
import { getSprintStatusConfig } from '@/lib/semantic/status';
import { cn } from '@/lib/utils';
import type { Sprint } from '@/types';

type SprintView = 'board' | 'planning' | 'analytics';

const VIEWS: { key: SprintView; label: string; path: string }[] = [
  { key: 'board', label: 'Board', path: 'board' },
  { key: 'planning', label: 'Planning', path: 'backlog' },
  { key: 'analytics', label: 'Analytics', path: 'analytics' },
];

interface SprintHeaderProps {
  sprint: Sprint;
  current: SprintView;
  /** What this view of the sprint is for. */
  description: string;
}

/**
 * What a sprint's Board, Planning and Analytics show when the sprint cannot be.
 *
 * Every failure used to read "this is a connection problem" with Try again —
 * a deleted sprint included, where trying again fails the same way for ever.
 * A 404 is gone and a 403 is not yours: both get a way back, not a retry. Only
 * a failure that can pass (the network, the server) offers one. No error at all
 * means there was no sprint to read, which is the 404 answer.
 */
export function SprintUnavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === 403) {
    return (
      <NoAccess what="open this sprint" className="mt-10">
        <Button asChild variant="outline" size="sm">
          <Link href="/sprints">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sprints
          </Link>
        </Button>
      </NoAccess>
    );
  }
  if (!error || code === 404) {
    return (
      <EmptyState
        className="mt-10"
        icon={CalendarX}
        title="Sprint not found"
        description="It may have been deleted, or the link may be wrong."
        action={{ label: 'Back to Sprints', href: '/sprints' }}
      />
    );
  }
  return (
    <ErrorState
      className="mt-10"
      title="Couldn't load this sprint"
      description="This is a connection or server problem, not a missing sprint. Try again."
      onRetry={onRetry}
    />
  );
}

/**
 * The head of every page about one sprint: Board, Planning, Analytics.
 *
 * Each page drew its own. "Back to Sprints" forgot which project the list had
 * been on; the planning page was "Backlog" from the board and "Open Backlog"
 * from analytics; and a sprint could be started or completed only from the
 * list — while "this sprint is ready to close" opened its board, which had no
 * way to close it.
 */
export function SprintHeader({ sprint, current, description }: SprintHeaderProps) {
  const confirm = useConfirm();
  // A sprint of an archived project is neither started nor completed (the
  // server refuses both): its project is read-only.
  const projectArchived = useIsProjectArchived(sprint.projectId);
  const canEditSprint = useHasPermission(Permission.EDIT_SPRINT) && !projectArchived;
  const { data: sprints = [] } = useSprints(sprint.projectId);
  const { data: tasks = [] } = useTasks(sprint.projectId);
  const startSprint = useStartSprint();
  const completeSprint = useCompleteSprint();

  const status = getSprintStatusConfig(sprint.status);
  const otherActive = sprints.find((s) => s.status === 'ACTIVE' && s.id !== sprint.id);
  const sprintTasks = tasks.filter((task) => task.sprintId === sprint.id);
  const done = sprintTasks.filter((task) => task.status === 'DONE').length;

  const start = async () => {
    try {
      await startSprint.mutateAsync({ sprintId: sprint.id, projectId: sprint.projectId });
    } catch {
      /* the mutation's own toast says why */
    }
  };

  const complete = async () => {
    const unfinished = sprintTasks.length - done;
    const confirmed = await confirm({
      title: `Complete ${sprint.name}?`,
      description:
        unfinished > 0
          ? `${done} of ${sprintTasks.length} tasks are done. The ${unfinished} unfinished ${unfinished === 1 ? 'task leaves' : 'tasks leave'} the sprint, with ${unfinished === 1 ? 'its requirement' : 'their requirements'}, to be planned into another one. A completed sprint cannot be reopened.`
          : `All ${sprintTasks.length} tasks are done. A completed sprint cannot be reopened.`,
      confirmText: 'Complete Sprint',
    });
    if (!confirmed) return;
    try {
      await completeSprint.mutateAsync({ sprintId: sprint.id, projectId: sprint.projectId });
    } catch {
      /* the mutation's own toast says why */
    }
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/sprints?projectId=${sprint.projectId}`}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Sprints
        </Link>
      </Button>

      <PageHeader
        title={sprint.name}
        description={description}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
            {canEditSprint && sprint.status === 'PLANNING' && (
              <>
                {otherActive && (
                  <span className="text-xs text-muted-foreground">
                    Complete &ldquo;{otherActive.name}&rdquo; first — one sprint runs at a time.
                  </span>
                )}
                <Button onClick={() => void start()} disabled={Boolean(otherActive) || startSprint.isPending}>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Start Sprint
                </Button>
              </>
            )}
            {canEditSprint && sprint.status === 'ACTIVE' && (
              <Button onClick={() => void complete()} disabled={completeSprint.isPending}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Complete Sprint
              </Button>
            )}
          </div>
        }
      />

      {/* Once, here, for the board, planning and analytics of the sprint alike. */}
      <ArchivedProjectBanner projectId={sprint.projectId} />

      {sprint.goal && (
        <p className="text-sm">
          <span className="text-muted-foreground">Goal: </span>
          {sprint.goal}
        </p>
      )}

      {/* The divider is an inset shadow, not a border. The active link's underline
          used to overlap a border-b via `-mb-px` — 1px outside the nav, and in an
          `overflow-x-auto` box that turned overflow-y to auto and drew a ▲▼
          scrollbar beside the tabs. An inset shadow paints under the links, so the
          underline still covers the line with nothing sticking out. */}
      <nav
        aria-label="Sprint views"
        className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_0_var(--color-border)]"
      >
        {VIEWS.map((view) => (
          <Link
            key={view.key}
            href={`/sprints/${sprint.id}/${view.path}`}
            aria-current={current === view.key ? 'page' : undefined}
            className={cn(
              // ring-inset: the scrolling nav clips anything drawn outside a link,
              // which took the top and bottom off the keyboard focus ring.
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              current === view.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {view.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
