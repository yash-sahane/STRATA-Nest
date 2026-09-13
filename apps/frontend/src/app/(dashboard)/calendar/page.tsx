'use client';

import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import { toneStyle } from '@/lib/semantic/tone';

import * as React from 'react';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
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
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Target,
  GitBranch,
  CheckCircle2,
} from 'lucide-react';
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

export default function CalendarPage() {
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: projects = [], isError: projectsError, refetch: refetchProjects } =
    useProjects(currentWorkspace?.id);
  const { data: allTasks = [], isError: tasksError, refetch: refetchTasks } =
    useWorkspaceTasks(currentWorkspace?.id);
  const { data: sprints = [], isError: sprintsError, refetch: refetchSprints } =
    useWorkspaceSprints(currentWorkspace?.id);

  const [selectedMonth, setSelectedMonth] = React.useState(new Date());
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
      return format(new Date(task.dueDate), 'yyyy-MM-dd') === dateStr;
    });

    const sprintsForDay = filteredSprints.filter((sprint) => {
      const startDate = format(new Date(sprint.startDate), 'yyyy-MM-dd');
      const endDate = format(new Date(sprint.endDate), 'yyyy-MM-dd');
      return dateStr >= startDate && dateStr <= endDate;
    });

    return { tasks: tasksForDay, sprints: sprintsForDay };
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
      const dueDate = new Date(task.dueDate);
      return dueDate >= monthStart && dueDate <= monthEnd && task.status !== 'DONE';
    }).length;

    const activeSprints = filteredSprints.filter((sprint) => {
      const now = new Date();
      return (
        new Date(sprint.startDate) <= now &&
        new Date(sprint.endDate) >= now &&
        sprint.status === 'ACTIVE'
      );
    }).length;

    const overdueTasks = filteredTasks.filter((task) => {
      if (!task.dueDate) return false;
      return new Date(task.dueDate) < new Date() && task.status !== 'DONE';
    }).length;

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
          title="Calendar & Schedule"
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
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <CalendarIcon className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to view calendar</p>
        </div>
      </div>
    );
  }

  return (
    // No `container`/`py-6` here: the dashboard layout already wraps every route
    // in <PageContainer>, which owns the width and gutter (page-container.tsx).
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={CalendarIcon}
        title="Calendar & Schedule"
        description="View tasks, sprints, and important dates"
        actions={
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[200px]">
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
                  const hasEvents = events.tasks.length > 0 || events.sprints.length > 0;

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDay(day)}
                      className={`
                        aspect-square rounded-lg p-2 text-sm transition-colors
                        ${isToday ? 'ring-2 ring-primary' : ''}
                        ${isSelected ? 'bg-primary text-primary-foreground' : ''}
                        ${!isSelected && isCurrentMonth ? 'hover:bg-muted' : ''}
                        ${!isCurrentMonth ? 'opacity-40' : ''}
                        ${hasEvents && !isSelected ? 'bg-blue-50 dark:bg-blue-950' : ''}
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
                  ? `${plural(selectedDayEvents.tasks.length, 'task')}, ${plural(selectedDayEvents.sprints.length, 'sprint')}`
                  : 'View events for a selected day'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedDay ? (
                <div className="text-center py-8 text-muted-foreground">
                  Click on a day to view events
                </div>
              ) : !selectedDayEvents ||
                (selectedDayEvents.tasks.length === 0 && selectedDayEvents.sprints.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">No events on this day</div>
              ) : (
                <div className="space-y-4">
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
                            className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950"
                          >
                            <div className="font-medium">{sprint.name}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {project?.name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {format(new Date(sprint.startDate), 'MMM d')} -{' '}
                              {format(new Date(sprint.endDate), 'MMM d')}
                            </div>
                            <Badge
                              className="mt-2"
                              variant={sprint.status === 'ACTIVE' ? 'default' : 'secondary'}
                            >
                              {sprint.status}
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
                        const isOverdue =
                          new Date(task.dueDate!) < new Date() && task.status !== 'DONE';

                        return (
                          <div
                            key={task.id}
                            /* Tone comes from the semantic module, not a raw
                               palette pair: `bg-red-50 dark:bg-red-950` does not
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
                                {task.priority}
                              </Badge>
                              <Badge variant={task.status === 'DONE' ? 'default' : 'outline'}>
                                {task.status.replace('_', ' ')}
                              </Badge>
                              {isOverdue && <Badge variant="destructive">OVERDUE</Badge>}
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
