'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useWorkspaceTasks } from '@/hooks/use-task';
import { AttendanceWidget } from '@/components/attendance/attendance-widget';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageLoader } from '@/components/ui/page-loader';
import { PageHeader } from '@/components/layout/page-header';
import {
  CheckCircle2,
  Clock,
  FolderKanban,
  GitBranch,
  Users,
  Calendar,
  Target,
  ArrowRight,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { Task } from '@/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  const { data: projects = [], isLoading: projectsLoading } = useProjects(currentWorkspace?.id);

  // Get all tasks in the workspace (single query, no hook violations)
  const { data: allTasks = [], isLoading: tasksLoading } = useWorkspaceTasks(currentWorkspace?.id);

  // Calculate real stats
  const stats = React.useMemo(() => {
    const activeProjects = projects.filter(
      (p) => p.status === 'ACTIVE' || p.status === 'PLANNING'
    ).length;
    const completedTasks = allTasks.filter((t) => t.status === 'DONE').length;
    const myTasks = allTasks.filter((t) => t.assigneeIds?.includes(user?.id || '')).length;

    // Count unique team members across all projects
    const allMembers = new Set<string>();
    projects.forEach((p) => p.memberIds?.forEach((id) => allMembers.add(id)));

    return {
      activeProjects,
      completedTasks,
      totalTasks: allTasks.length,
      myTasks,
      teamMembers: allMembers.size,
    };
  }, [projects, allTasks, user]);

  // Get my tasks
  const myTasks = React.useMemo(() => {
    return allTasks
      .filter((t) => t.assigneeIds?.includes(user?.id || ''))
      .filter((t) => t.status !== 'DONE')
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }
        return 0;
      })
      .slice(0, 5);
  }, [allTasks, user]);

  // Get upcoming deadlines
  const upcomingDeadlines = React.useMemo(() => {
    const tasksWithDueDates = allTasks
      .filter((t) => t.dueDate && t.status !== 'DONE')
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
      .slice(0, 5);

    return tasksWithDueDates.map((task) => {
      const project = projects.find((p) => p.id === task.projectId);
      const daysUntil = Math.ceil(
        (new Date(task.dueDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      return {
        title: task.title,
        projectName: project?.name || 'Unknown',
        daysUntil,
        dueDate: task.dueDate!,
      };
    });
  }, [allTasks, projects]);

  const getStatusBadge = (status: Task['status']) => {
    const config: Record<
      Task['status'],
      { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
    > = {
      BACKLOG: { label: 'Backlog', variant: 'secondary' },
      TODO: { label: 'To Do', variant: 'outline' },
      IN_PROGRESS: { label: 'In Progress', variant: 'default' },
      REVIEW: { label: 'Review', variant: 'default' },
      DONE: { label: 'Done', variant: 'default' },
    };
    return config[status];
  };

  if (workspacesLoading || projectsLoading || tasksLoading) {
    return <PageLoader message="Loading your dashboard..." />;
  }

  // Show empty state if no workspace
  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'User'}!`}
        description="Here's what's happening with your projects today."
      />

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeProjects}</div>
            <p className="text-xs text-muted-foreground">{projects.length} total projects</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedTasks}</div>
            <p className="text-xs text-muted-foreground">{stats.totalTasks} total tasks</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Tasks</CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.myTasks}</div>
            <p className="text-xs text-muted-foreground">Assigned to you</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.teamMembers}</div>
            <p className="text-xs text-muted-foreground">Across all projects</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">My Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Attendance Widget */}
            <AttendanceWidget />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Upcoming Deadlines
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {upcomingDeadlines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No upcoming deadlines</p>
                ) : (
                  upcomingDeadlines.map((deadline, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                    >
                      <div>
                        <p className="font-medium">{deadline.title}</p>
                        <p className="text-sm text-muted-foreground">{deadline.projectName}</p>
                      </div>
                      <Badge
                        variant={
                          deadline.daysUntil <= 2
                            ? 'destructive'
                            : deadline.daysUntil <= 7
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {deadline.daysUntil <= 0 ? 'Today' : `${deadline.daysUntil} days`}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  <FolderKanban className="mr-2 h-4 w-4" />
                  View Projects
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/tasks')}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  View All Tasks
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/sprints')}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  View Sprints
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/attendance')}
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Attendance
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Tasks</CardTitle>
              <CardDescription>Tasks assigned to you across all projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned to you</p>
              ) : (
                myTasks.map((task) => {
                  const project = projects.find((p) => p.id === task.projectId);
                  const status = getStatusBadge(task.status);

                  return (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent cursor-pointer"
                      onClick={() => router.push(`/tasks?project=${task.projectId}`)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox />
                        <div>
                          <p className="font-medium">{task.title}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge variant="outline">{task.hierarchyId}</Badge>
                            <Badge variant={status.variant}>{status.label}</Badge>
                            <span className="text-xs text-muted-foreground">{project?.name}</span>
                          </div>
                        </div>
                      </div>
                      {task.dueDate && (
                        <div className="text-sm text-muted-foreground">
                          Due: {formatDate(task.dueDate)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
