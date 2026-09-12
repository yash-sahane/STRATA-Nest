'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getInitials } from '@/lib/utils';
import { query, resources } from '@/lib/api/client';
import { useTeamMembers } from '@/hooks/use-team';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
    [`${entity}.created`]: { icon, color: 'text-emerald-500', label: `${noun} Created` },
    [`${entity}.updated`]: { icon, color: 'text-sky-500', label: `${noun} Updated` },
    [`${entity}.deleted`]: { icon, color: 'text-red-500', label: `${noun} Deleted` },
  };
}

const ACTIVITY_CONFIG: Record<string, ActivityConfig> = {
  'workspace.member.added': { icon: UserPlus, color: 'text-emerald-500', label: 'Member Added' },
  'workspace.member.role_changed': {
    icon: ShieldCheck,
    color: 'text-violet-500',
    label: 'Role Changed',
  },
  'workspace.member.removed': { icon: UserMinus, color: 'text-red-500', label: 'Member Removed' },
  'workspace.invitation.accepted': {
    icon: LogIn,
    color: 'text-sky-500',
    label: 'Invitation Accepted',
  },
  'workspace.join_request.approved': {
    icon: CheckCircle2,
    color: 'text-emerald-500',
    label: 'Join Request Approved',
  },
  'workspace.join_request.rejected': {
    icon: XCircle,
    color: 'text-red-500',
    label: 'Join Request Rejected',
  },
  'leave.approved': { icon: CalendarOff, color: 'text-emerald-500', label: 'Leave Approved' },
  'leave.rejected': { icon: CalendarOff, color: 'text-red-500', label: 'Leave Rejected' },
  'time_entry.approved': { icon: Timer, color: 'text-emerald-500', label: 'Time Approved' },
  'time_entry.rejected': { icon: Timer, color: 'text-red-500', label: 'Time Rejected' },

  // Sprint milestones, emitted by SprintsService (start) and
  // SprintCompletionService (completion).
  'sprint.started': { icon: PlayCircle, color: 'text-sky-500', label: 'Sprint Started' },
  'sprint.completed': { icon: PartyPopper, color: 'text-emerald-500', label: 'Sprint Completed' },

  // Plain CRUD on the planning domain, written by ScopedCrudService for every
  // collection that opts in via `auditEntity`. The `<entity>.<created|updated|
  // deleted>` shape means one entry per verb; anything not listed still renders
  // through configFor's fallback.
  ...crud('project', FolderKanban, 'Project'),
  ...crud('epic', Rocket, 'Epic'),
  ...crud('sprint', Target, 'Sprint'),
  ...crud('retrospective', ListChecks, 'Retrospective'),
  ...crud('task', CheckCircle2, 'Task'),
  ...crud('label', Tag, 'Label'),
  ...crud('client_requirement', FileText, 'Client Requirement'),
  ...crud('functional_requirement', FileText, 'Functional Requirement'),
  ...crud('holiday', CalendarOff, 'Holiday'),
  ...crud('leave_request', CalendarOff, 'Leave Request'),
  ...crud('leave_balance', CalendarOff, 'Leave Balance'),
  ...crud('workspace_role', ShieldCheck, 'Role'),
  ...crud('invite_code', KeySquare, 'Invite Code'),
  ...crud('email_invitation', Mail, 'Email Invitation'),
  ...crud('join_request', UserPlus, 'Join Request'),
  ...crud('pending_access', UserPlus, 'Access Request'),
  ...crud('github_integration', GitBranch, 'GitHub Integration'),
  ...crud('gitlab_integration', GitBranch, 'GitLab Integration'),
  ...crud('discord_integration', LayoutList, 'Discord Integration'),
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

export function ActivityFeed({ workspaceId, showFilters = true, className }: ActivityFeedProps) {
  const [filterAction, setFilterAction] = React.useState<string>('all');

  const {
    data: activities = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['activity-logs', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) return [];
      const response = await resources.list<ActivityLog>('activity_logs', [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
        query.limit(PAGE_SIZE),
      ]);
      return response.items;
    },
  });

  // The log stores a userId; the roster is where the display name lives. It is
  // the same `['team-members', workspaceId]` query the header already holds, so
  // this costs no extra request.
  const { data: teamMembers = [] } = useTeamMembers(workspaceId);
  const nameOf = React.useMemo(() => {
    const byId = new Map(teamMembers.map((m) => [m.userId, m.name || m.email || 'Someone']));
    return (userId: string) => byId.get(userId) ?? 'Someone';
  }, [teamMembers]);

  // Only the actions actually present, so the picker never offers an empty filter.
  const availableActions = React.useMemo(
    () => [...new Set(activities.map((a) => a.action))].sort(),
    [activities]
  );

  const filteredActivities = React.useMemo(() => {
    if (filterAction === 'all') return activities;
    return activities.filter((activity) => activity.action === filterAction);
  }, [activities, filterAction]);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Activity Feed
            </CardTitle>
            <CardDescription>Recent activity across this workspace</CardDescription>
          </div>
          {showFilters && availableActions.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger aria-label="Filter the activity feed" className="w-[220px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Activities</SelectItem>
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
          ) : isError ? (
            <ErrorState
              title="Couldn't load activity"
              description="The workspace activity trail could not be fetched."
              onRetry={() => refetch()}
            />
          ) : filteredActivities.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No activities yet"
              description="Activity will appear here as your team works in this workspace"
            />
          ) : (
            <div className="space-y-4">
              {filteredActivities.map((activity) => {
                const config = configFor(activity.action);
                const Icon = config.icon;
                const userName = nameOf(activity.userId);

                return (
                  <div
                    key={activity.id}
                    className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
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
                        <div className="flex items-center gap-2 flex-wrap">
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
                                className="text-sm font-medium truncate max-w-[22rem]"
                                title={activity.metadata.label}
                              >
                                {activity.metadata.label}
                              </span>
                            )}
                        </div>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {activity.entityType}
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
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
