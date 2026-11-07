'use client';

import { getSprintStatusConfig } from '@/lib/semantic/status';
import { PageHeader } from '@/components/layout/page-header';
import { cn, parseWireDate } from '@/lib/utils';
import { formatLeaveDateRange } from '@/lib/leave-utils';
import { plural } from '@/lib/plural';
import { toneStyle } from '@/lib/semantic/tone';

import * as React from 'react';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useAwayList } from '@/hooks/use-leave';
import { useProjects } from '@/hooks/use-project';
import { useWorkspaceTasks } from '@/hooks/use-task';
import { useWorkspaceSprints } from '@/hooks/use-sprint';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar as CalendarIcon, CheckCircle2, ChevronLeft, ChevronRight, GitBranch, Plane, Target } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  subMonths,
  isSameMonth,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import { humanizeEnum } from '@/lib/semantic/status';
import {
  useLeaveRequestsRealtime,
  useSprintsRealtime,
  useTasksRealtime,
} from '@/hooks/use-realtime';
import { isTaskOverdue } from '@/lib/task-dates';

export default function CalendarPage() {
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: projects = [], isError: projectsError, refetch: refetchProjects } =
    useProjects(currentWorkspace?.id);
  const { data: allTasks = [], isError: tasksError, refetch: refetchTasks } =
    useWorkspaceTasks(currentWorkspace?.id);
  const { data: sprints = [], isError: sprintsError, refetch: refetchSprints } =
    useWorkspaceSprints(currentWorkspace?.id);
  /**
   * Approved leave, so the calendar can say who is away.
   *
   * This page had no notion of leave at all, which is the single thing a team calendar
   * is most often opened to check. APPROVED only: a pending request is a request, and
   * drawing it here would tell the team somebody is away before anybody agreed.
   *
   * From the away list, not the leave requests: those are personal, so anybody who
   * does not approve leave was shown only their own and told "0 people away" on a day
   * half the team was out. The away list is the same for everybody, and carries who
   * and until when — not what kind of leave, which is nobody else's business.
   */
  const [selectedMonth, setSelectedMonth] = React.useState(new Date());
  // The weeks the grid draws, not a window around today: with no range the server
  // answered for ~62 days back, so stepping back to August showed "0 people away"
  // on days people were on approved leave.
  const awayRange = React.useMemo(
    () => ({
      from: format(startOfWeek(startOfMonth(selectedMonth)), 'yyyy-MM-dd'),
      to: format(endOfWeek(endOfMonth(selectedMonth)), 'yyyy-MM-dd'),
    }),
    [selectedMonth],
  );
  const { data: approvedLeave = [] } = useAwayList(currentWorkspace?.id, awayRange);
  // A calendar is read to plan around: a due date moved, a sprint started or
  // somebody's leave approved after it was opened has to appear on it.
  useTasksRealtime(currentWorkspace?.id);
  useSprintsRealtime(currentWorkspace?.id);
  useLeaveRequestsRealtime(currentWorkspace?.id);

  const [selectedProject, setSelectedProject] = React.useState<string>('ALL');
  const [selectedDay, setSelectedDay] = React.useState<Date | null>(null);

  // Filter events by selected project
  const filteredTasks = React.useMemo(() => {
    if (selectedProject === 'ALL') return allTasks;
    return allTasks.filter((task) => task.projectId === selectedProject);
  }, [allTasks, selectedProject]);

  const filteredSprints = React.useMemo(() => {
    if (selectedProject === 'ALL') return sprints;
    return sprints.filter((sprint) => sprint.projectId === selectedProject);
  }, [sprints, selectedProject]);

  // Get tasks and sprints for a specific day
  const getEventsForDay = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');

    const tasksForDay = filteredTasks.filter((task) => {
      if (!task.dueDate) return false;
      return format(parseWireDate(task.dueDate), 'yyyy-MM-dd') === dateStr;
    });

    const sprintsForDay = filteredSprints.filter((sprint) => {
      const startDate = format(parseWireDate(sprint.startDate), 'yyyy-MM-dd');
      const endDate = format(parseWireDate(sprint.endDate), 'yyyy-MM-dd');
      return dateStr >= startDate && dateStr <= endDate;
    });

    // Leave spans a range, like a sprint, so a day inside it counts.
    const leaveForDay = approvedLeave.filter((leave) => {
      const start = String(leave.startDate).slice(0, 10);
      const end = String(leave.endDate).slice(0, 10);
      return dateStr >= start && dateStr <= end;
    });

    return { tasks: tasksForDay, sprints: sprintsForDay, leave: leaveForDay };
  };

  // Get calendar days
  const calendarDays = React.useMemo(() => {
    const monthStart = startOfMonth(selectedMonth);
    const monthEnd = endOfMonth(selectedMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [selectedMonth]);

  // Get selected day events
  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : null;

  // Calculate stats
  const stats = React.useMemo(() => {
    const monthStart = startOfMonth(selectedMonth);
    const monthEnd = endOfMonth(selectedMonth);

    const upcomingTasks = filteredTasks.filter((task) => {
      if (!task.dueDate) return false;
      const dueDate = parseWireDate(task.dueDate);
      return dueDate >= monthStart && dueDate <= monthEnd && task.status !== 'DONE';
    }).length;

    // Started is active: comparing the dates to this instant dropped a sprint
    // on its last day, whose end date is that day's midnight.
    const activeSprints = filteredSprints.filter((sprint) => sprint.status === 'ACTIVE').length;

    const overdueTasks = filteredTasks.filter((task) => isTaskOverdue(task)).length;

    return { upcomingTasks, activeSprints, overdueTasks };
  }, [filteredTasks, filteredSprints, selectedMonth]);

  if (workspacesLoading) {
    return <PageLoader message="Loading calendar..." />;
  }

  // These three queries feed every cell on the calendar. Without this branch a
  // failed request rendered an empty month that looked like a free schedule.
  if (projectsError || tasksError || sprintsError) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={CalendarIcon}
          title="Calendar"
          description="We couldn't load your schedule."
        />
        <ErrorState
          onRetry={() => {
            if (projectsError) refetchProjects();
            if (tasksError) refetchTasks();
            if (sprintsError) refetchSprints();
          }}
        />
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={CalendarIcon}
        title="No workspace found"
        description="Create a workspace to view the calendar."
      />
    );
  }

  return (
    // No `container`/`py-6` here: the dashboard layout already wraps every route
    // in <PageContainer>, which owns the width and gutter (page-container.tsx).
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={CalendarIcon}
        title="Calendar"
        description="View tasks, sprints, and important dates"
        actions={
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Upcoming Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.upcomingTasks}</div>
            <p className="text-xs text-muted-foreground mt-1">Due this month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Active Sprints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeSprints}</div>
            <p className="text-xs text-muted-foreground mt-1">Currently running</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Overdue Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive-text">{stats.overdueTasks}</div>
            <p className="text-xs text-muted-foreground mt-1">Need attention</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{format(selectedMonth, 'MMMM yyyy')}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Previous month"
                    onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedMonth(new Date())}>
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Next month"
                    onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div
                    key={day}
                    className="text-center text-sm font-medium text-muted-foreground p-2"
                  >
                    {day}
                  </div>
                ))}
                {calendarDays.map((day, idx) => {
                  const events = getEventsForDay(day);
                  const isToday = isSameDay(day, new Date());
                  const isCurrentMonth = isSameMonth(day, selectedMonth);
                  const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                  const hasEvents =
                    events.tasks.length > 0 || events.sprints.length > 0 || events.leave.length > 0;

                  return (
                    <button
                      key={idx}
                      type="button"
                      // "18" told a screen reader nothing: which day, and what is on it.
                      aria-label={[
                        format(day, 'EEEE, MMMM d'),
                        events.tasks.length ? `${events.tasks.length} due` : '',
                        events.sprints.length ? `${events.sprints.length} sprint${events.sprints.length === 1 ? '' : 's'}` : '',
                        events.leave.length ? `${events.leave.length} away` : '',
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDay(day)}
                      className={`
                        aspect-square rounded-lg p-2 text-sm transition-colors
                        ${isToday ? 'ring-2 ring-primary' : ''}
                        ${isSelected ? 'bg-primary text-primary-foreground' : ''}
                        ${!isSelected && isCurrentMonth ? 'hover:bg-muted' : ''}
                        ${!isCurrentMonth ? 'opacity-40' : ''}
                        ${hasEvents && !isSelected ? 'bg-info/10' : ''}
                      `}
                    >
                      <div className="font-medium">{format(day, 'd')}</div>
                      {hasEvents && (
                        <div className="flex justify-center gap-1 mt-1">
                          {events.tasks.length > 0 && (
                            <div className="w-1 h-1 rounded-full bg-green-500" />
                          )}
                          {events.sprints.length > 0 && (
                            <div className="w-1 h-1 rounded-full bg-blue-500" />
                          )}
                          {events.leave.length > 0 && (
                            <div className="w-1 h-1 rounded-full bg-amber-500" />
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 mt-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>Tasks Due</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>Sprints</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <span className="text-muted-foreground">Away</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Events List */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedDay ? format(selectedDay, 'MMMM d, yyyy') : 'Select a day'}
              </CardTitle>
              <CardDescription>
                {selectedDayEvents
                  ? [
                      plural(selectedDayEvents.tasks.length, 'task'),
                      plural(selectedDayEvents.sprints.length, 'sprint'),
                      plural(selectedDayEvents.leave.length, 'person', 'people') + ' away',
                    ].join(', ')
                  : 'View events for a selected day'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedDay ? (
                <div className="text-center py-8 text-muted-foreground">
                  Click on a day to view events
                </div>
              ) : !selectedDayEvents ||
                (selectedDayEvents.tasks.length === 0 &&
                  selectedDayEvents.sprints.length === 0 &&
                  selectedDayEvents.leave.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">No events on this day</div>
              ) : (
                <div className="space-y-4">
                  {/* Who is away. First in the panel on purpose: it is the thing a
                      team calendar is usually opened to check, and this page showed
                      it nowhere at all. */}
                  {selectedDayEvents.leave.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Plane className="h-4 w-4" />
                        Away
                      </h3>
                      {selectedDayEvents.leave.map((leave) => (
                        <div
                          key={leave.id}
                          className="p-3 rounded-lg border bg-warning/10"
                        >
                          <div className="font-medium">{leave.userName || 'A team member'}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {leave.halfDay ? 'Away for half the day' : 'Away'}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatLeaveDateRange(leave.startDate, leave.endDate)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedDayEvents.sprints.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <GitBranch className="h-4 w-4" />
                        Sprints
                      </h3>
                      {selectedDayEvents.sprints.map((sprint) => {
                        const project = projects.find((p) => p.id === sprint.projectId);
                        return (
                          <div
                            key={sprint.id}
                            className="p-3 rounded-lg border bg-info/10"
                          >
                            <div className="font-medium">{sprint.name}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {project?.name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {format(parseWireDate(sprint.startDate), 'MMM d')} -{' '}
                              {format(parseWireDate(sprint.endDate), 'MMM d')}
                            </div>
                            <Badge
                              className="mt-2"
                              variant={sprint.status === 'ACTIVE' ? 'default' : 'secondary'}
                            >
                              {getSprintStatusConfig(sprint.status).label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedDayEvents.tasks.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Tasks Due
                      </h3>
                      {selectedDayEvents.tasks.map((task) => {
                        const project = projects.find((p) => p.id === task.projectId);
                        const isOverdue = isTaskOverdue(task);

                        return (
                          <div
                            key={task.id}
                            /* Tone comes from the semantic module, not a raw
                               palette pair: `bg-destructive/10` does not
                               track the token theme the rest of the app uses. */
                            className={cn(
                              'p-3 rounded-lg border-l-4 border bg-muted/40',
                              isOverdue
                                ? toneStyle.destructive.borderLeft
                                : toneStyle.success.borderLeft
                            )}
                          >
                            <div className="font-medium">{task.title}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {project?.name} • {task.hierarchyId}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge
                                variant={
                                  task.priority === 'CRITICAL'
                                    ? 'destructive'
                                    : task.priority === 'HIGH'
                                      ? 'default'
                                      : 'secondary'
                                }
                              >
                                {humanizeEnum(task.priority)}
                              </Badge>
                              <Badge variant={task.status === 'DONE' ? 'default' : 'outline'}>
                                {humanizeEnum(task.status)}
                              </Badge>
                              {isOverdue && <Badge variant="destructive">Overdue</Badge>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
