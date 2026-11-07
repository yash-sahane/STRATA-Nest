'use client';

import * as React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getInitials } from '@/lib/utils';
import { query, resources, type ApiModels } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { useTeamMembers } from '@/hooks/use-team';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CalendarOff,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  FolderKanban,
  GitBranch,
  KeySquare,
  LayoutList,
  ListChecks,
  Loader2,
  LogIn,
  Mail,
  PartyPopper,
  PlayCircle,
  Rocket,
  ShieldCheck,
  Tag,
  Target,
  Timer,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * The `action` values the audit trail actually stores.
 *
 * These are the dotted domain-event names emitted by AuditSubscriber
 * (packages/shared/src/events — `workspace.member.added`, `leave.approved`, …).
 * They are NOT the invented `task_created`-style keys this component used to
 * declare: those matched nothing the server writes, so an unguarded
 * `activityConfig[activity.type]` lookup would have thrown on the first real row
 * had the component ever fetched one.
 */
type ActivityConfig = {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
};

/** The three rows a CRUD-audited entity contributes, so each verb keeps its own
 *  colour without spelling out `created`/`updated`/`deleted` twenty times. */
function crud(
  entity: string,
  icon: React.ComponentType<{ className?: string }>,
  noun: string,
): Record<string, ActivityConfig> {
  return {
    [`${entity}.created`]: { icon, color: 'text-emerald-700 dark:text-emerald-500', label: `${noun} Created` },
    [`${entity}.updated`]: { icon, color: 'text-sky-500', label: `${noun} Updated` },
    [`${entity}.deleted`]: { icon, color: 'text-red-500', label: `${noun} Deleted` },
  };
}

const ACTIVITY_CONFIG: Record<string, ActivityConfig> = {
  'workspace.member.added': { icon: UserPlus, color: 'text-emerald-700 dark:text-emerald-500', label: 'Member Added' },
  'workspace.member.role_changed': {
    icon: ShieldCheck,
    color: 'text-violet-500',
    label: 'Role Changed',
  },
  'workspace.member.removed': { icon: UserMinus, color: 'text-red-500', label: 'Member Removed' },
  'workspace.member.status_changed': { icon: UserMinus, color: 'text-amber-600 dark:text-amber-500', label: 'Member Access Changed' },
  'workspace.invitation.accepted': {
    icon: LogIn,
    color: 'text-sky-500',
    label: 'Invitation Accepted',
  },
  'workspace.join_request.approved': {
    icon: CheckCircle2,
    color: 'text-emerald-700 dark:text-emerald-500',
    label: 'Join Request Approved',
  },
  'workspace.join_request.rejected': {
    icon: XCircle,
    color: 'text-red-500',
    label: 'Join Request Rejected',
  },
  'leave.approved': { icon: CalendarOff, color: 'text-emerald-700 dark:text-emerald-500', label: 'Leave Approved' },
  'leave.rejected': { icon: CalendarOff, color: 'text-red-500', label: 'Leave Rejected' },
  'time_entry.approved': { icon: Timer, color: 'text-emerald-700 dark:text-emerald-500', label: 'Time Approved' },
  'time_entry.rejected': { icon: Timer, color: 'text-red-500', label: 'Time Rejected' },

  // Sprint milestones, emitted by SprintsService (start) and
  // SprintCompletionService (completion).
  'sprint.started': { icon: PlayCircle, color: 'text-sky-500', label: 'Sprint Started' },
  'sprint.completed': { icon: PartyPopper, color: 'text-emerald-700 dark:text-emerald-500', label: 'Sprint Completed' },

  // Plain CRUD on the planning domain, written by ScopedCrudService for every
  // collection that opts in via `auditEntity`. The `<entity>.<created|updated|
  // deleted>` shape means one entry per verb; anything not listed still renders
  // through configFor's fallback.
  ...crud('project', FolderKanban, 'Project'),
  ...crud('epic', Rocket, 'Epic'),
  ...crud('sprint', Target, 'Sprint'),
  ...crud('task', CheckCircle2, 'Task'),
  ...crud('client_requirement', FileText, 'Client Requirement'),
  ...crud('functional_requirement', FileText, 'Functional Requirement'),
  ...crud('holiday', CalendarOff, 'Holiday'),
  ...crud('leave_request', CalendarOff, 'Leave Request'),
  ...crud('leave_balance', CalendarOff, 'Leave Balance'),
  ...crud('workspace_role', ShieldCheck, 'Role'),
  ...crud('invite_code', KeySquare, 'Invite Code'),
  ...crud('join_request', UserPlus, 'Join Request'),
  ...crud('github_integration', GitBranch, 'GitHub Integration'),
  ...crud('gitlab_integration', GitBranch, 'GitLab Integration'),
  ...crud('discord_integration', LayoutList, 'Discord Integration'),

  // Collections that no longer exist. Nothing records them now, but the trail is
  // append-only: the rows written while they did still have to read as words.
  ...crud('retrospective', ListChecks, 'Retrospective'),
  ...crud('label', Tag, 'Label'),
  ...crud('email_invitation', Mail, 'Email Invitation'),
  ...crud('pending_access', UserPlus, 'Access Request'),
};

/** Total lookup. The audit trail is append-only and open-ended: an action added
 *  server-side must render as an ordinary row, never as `config.icon of
 *  undefined`. The label falls back to the raw action so nothing is invisible. */
function configFor(action: string) {
  return (
    ACTIVITY_CONFIG[action] ?? {
      icon: Clock,
      color: 'text-muted-foreground',
      label: action.replace(/[._]/g, ' '),
    }
  );
}

interface ActivityLog {
  id: string;
  workspaceId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ActivityFeedProps {
  workspaceId?: string;
  showFilters?: boolean;
  className?: string;
}

const PAGE_SIZE = 100;
const ALL_ACTIONS = 'all';

/**
 * The audit row's entity type is the server's table-ish key ("leave_request",
 * "functional_requirement"), and the badge printed it raw — snake_case on a
 * screen people read. Named here for the types the API audits; anything new
 * falls back to the key with its underscores turned into spaces.
 */
const ENTITY_TYPE_LABELS: Record<string, string> = {
  task: 'Task',
  functional_requirement: 'Functional requirement',
  client_requirement: 'Client requirement',
  epic: 'Epic',
  sprint: 'Sprint',
  retrospective: 'Retrospective',
  project: 'Project',
  leave_request: 'Leave request',
  holiday: 'Holiday',
  time_entry: 'Time entry',
  attendance: 'Attendance',
  workspace: 'Workspace',
  workspace_member: 'Member',
  workspace_role: 'Role',
  invite_code: 'Invite code',
  join_request: 'Join request',
  file: 'File',
  integration: 'Integration',
};

function entityTypeLabel(entityType: string): string {
  const known = ENTITY_TYPE_LABELS[entityType];
  if (known) return known;
  const spaced = entityType.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Item';
}

export function ActivityFeed({ workspaceId, showFilters = true, className }: ActivityFeedProps) {
  const [filterAction, setFilterAction] = React.useState<string>(ALL_ACTIONS);

  /**
   * The trail a page at a time, filtered by the server.
   *
   * It was one request for the newest hundred rows, and the action filter ran
   * over those hundred in the browser: nothing older could be reached at all,
   * and filtering for an action showed only the instances that happened to be
   * among the newest hundred of everything. The filter is part of the key — each
   * is its own list on the server — and "Load more" reads the next page of it.
   */
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    queryKey: ['activity-logs', workspaceId, filterAction],
    enabled: Boolean(workspaceId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      workspaceId
        ? resources.list<ActivityLog>('activity_logs', [
            query.equal('workspaceId', workspaceId),
            ...(filterAction === ALL_ACTIONS ? [] : [query.equal('action', filterAction)]),
            query.orderDesc('createdAt'),
            query.limit(PAGE_SIZE),
            query.page(pageParam),
          ])
        : Promise.resolve<ApiModels.ResourceList<ActivityLog>>({
            items: [],
            total: 0,
            page: 1,
            pageSize: PAGE_SIZE,
          }),
    getNextPageParam: (last) =>
      last.items.length > 0 && last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });

  // Pages are read by offset while new rows arrive at the top, so a row can be
  // pushed from the end of one page onto the start of the next: show it once.
  const activities = React.useMemo(() => {
    const seen = new Set<string>();
    const rows: ActivityLog[] = [];
    for (const row of (data?.pages ?? []).flatMap((page) => page.items)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }, [data]);
  const total = data?.pages[0]?.total ?? 0;

  // Every action in the part of the trail this member can read, from the server:
  // the rows on screen are only ever the first page or two. Not under the
  // 'activity-logs' root, so a new row does not re-read it — an action new
  // enough not to be in it yet is picked up from the rows below.
  const { data: recordedActions = [] } = useQuery({
    queryKey: ['activity-log-actions', workspaceId],
    enabled: Boolean(workspaceId) && showFilters,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      (
        await restClient.get<{ actions: string[] }>('/api/v1/activity_logs/actions/', {
          params: { workspaceId },
        })
      ).actions,
  });

  // The log stores a userId; the roster is where the display name lives. It is
  // the same `['team-members', workspaceId]` query the header already holds, so
  // this costs no extra request.
  const { data: teamMembers = [] } = useTeamMembers(workspaceId);
  const nameOf = React.useMemo(() => {
    const byId = new Map(teamMembers.map((m) => [m.userId, m.name || m.email || 'Someone']));
    return (userId: string) => byId.get(userId) ?? 'Someone';
  }, [teamMembers]);

  // Only actions that have actually been recorded, so the picker never offers an
  // empty filter — and the one picked stays listed whatever has loaded.
  const availableActions = React.useMemo(() => {
    const actions = new Set([...recordedActions, ...activities.map((a) => a.action)]);
    if (filterAction !== ALL_ACTIONS) actions.add(filterAction);
    return [...actions].sort();
  }, [recordedActions, activities, filterAction]);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Activity
            </CardTitle>
            <CardDescription>Recent activity across this workspace</CardDescription>
          </div>
          {showFilters && availableActions.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger
                  aria-label="Filter the activity feed"
                  className="w-full min-w-0 sm:w-[220px]"
                >
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACTIONS}>All Activities</SelectItem>
                  {availableActions.map((action) => (
                    <SelectItem key={action} value={action}>
                      {configFor(action).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 rounded-lg border p-3">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError && activities.length === 0 ? (
            // Only when there is nothing to show: a failed refresh or a failed
            // "Load more" keeps the rows already read on screen.
            <ErrorState
              title="Couldn't load activity"
              description="The workspace activity trail could not be fetched."
              onRetry={() => refetch()}
            />
          ) : activities.length === 0 ? (
            filterAction === ALL_ACTIONS ? (
              <EmptyState
                icon={Clock}
                title="No activities yet"
                description="Activity will appear here as your team works in this workspace"
              />
            ) : (
              <EmptyState
                icon={Filter}
                title={`No "${configFor(filterAction).label}" activity`}
                description="Nothing of this kind is in the part of the trail you can see."
                action={{ label: 'Show all activity', onClick: () => setFilterAction(ALL_ACTIONS) }}
              />
            )
          ) : (
            <div className="space-y-4">
              {activities.map((activity) => {
                const config = configFor(activity.action);
                const Icon = config.icon;
                const userName = nameOf(activity.userId);

                return (
                  <div
                    key={activity.id}
                    className="flex gap-3 p-3 rounded-lg border bg-card"
                  >
                    {/* Activity Icon */}
                    <div className="shrink-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <Icon className={`h-5 w-5 ${config.color}`} />
                      </div>
                    </div>

                    {/* Activity Content */}
                    <div className="flex-1 space-y-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        {/* min-w-0 so this can shrink below its content: without
                            it the nowrap label below refuses to narrow and drags
                            the row out to 466px on a 390px screen, where nothing
                            scrolls sideways and the timestamp and badge are lost. */}
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-xs">
                              {getInitials(userName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">{userName}</span>
                          <span className="text-sm text-muted-foreground">
                            {config.label.toLowerCase()}
                          </span>
                          {/* Which epic, which task. The server records a
                              title/name on the row it audits, and without this
                              every entry read "someone created a task" with no
                              way to tell which one. */}
                          {typeof activity.metadata?.label === 'string' &&
                            activity.metadata.label && (
                              <span
                                // max-w-[22rem] was a 352px cap, not a floor — but
                                // `truncate` implies white-space:nowrap, and a flex
                                // item will not shrink below its content width
                                // without min-w-0. So the span sat AT the cap and
                                // overflowed the phone viewport. It now shrinks to
                                // whatever the row can spare and truncates there.
                                className="min-w-0 max-w-full truncate text-sm font-medium"
                                title={activity.metadata.label}
                              >
                                {activity.metadata.label}
                              </span>
                            )}
                        </div>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {entityTypeLabel(activity.entityType)}
                        </Badge>
                      </div>

                      {/* Timestamp */}
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-col items-center gap-2 py-2">
                <p className="text-xs text-muted-foreground">
                  Showing {activities.length.toLocaleString()} of {total.toLocaleString()}
                </p>
                {isFetchNextPageError && (
                  <p className="text-xs text-destructive-text">Couldn&apos;t load older activity.</p>
                )}
                {hasNextPage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isFetchNextPageError ? 'Try again' : 'Load more'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
