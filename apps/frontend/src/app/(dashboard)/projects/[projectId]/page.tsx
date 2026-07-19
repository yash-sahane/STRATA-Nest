'use client';

import { PageLoader } from '@/components/ui/page-loader';
import { getProjectStatusConfig } from '@/lib/semantic/status';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Calendar,
  Users,
  GitBranch,
  Kanban,
  Settings,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { ProjectHealthCard } from '@/components/projects/project-health-card';
import { calculateProjectHealth } from '@/lib/project-health';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects, isLoading } = useProjects(currentWorkspace?.id);
  const project = projects?.find(p => p.id === params.projectId);
  const { data: tasks = [] } = useTasks(project?.id);

  // Calculate task statistics
  const taskStats = React.useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'DONE').length;
    const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;
    const todo = tasks.filter(t => t.status === 'TODO' || t.status === 'BACKLOG').length;
    const review = tasks.filter(t => t.status === 'REVIEW').length;

    return { total, completed, inProgress, todo, review };
  }, [tasks]);

  // Calculate project health
  const projectHealth = React.useMemo(() => {
    if (!project || tasks.length === 0) return null;
    return calculateProjectHealth(project, tasks);
  }, [project, tasks]);

  if (isLoading) {
    return <PageLoader message="Loading project..." />;
  }

  if (!project) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push('/projects')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Project Not Found</CardTitle>
            <CardDescription>
              The project you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
                <Badge variant={getProjectStatusConfig(project.status).badgeVariant}>
                  {getProjectStatusConfig(project.status).label}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                {project.shortCode} • {project.methodology === 'SCRUM' ? 'Scrum' : 'Kanban'} Project
              </p>
            </div>
          </div>
        </div>

        <Button onClick={() => router.push(`/requirements?projectId=${project.id}`)}>
          <FileText className="mr-2 h-4 w-4" />
          View Requirements
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.total}</div>
            <p className="text-xs text-muted-foreground">
              All tasks in this project
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.completed}</div>
            <p className="text-xs text-muted-foreground">
              {taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0}% completion rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.inProgress}</div>
            <p className="text-xs text-muted-foreground">
              Currently being worked on
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">To Do</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.todo}</div>
            <p className="text-xs text-muted-foreground">
              Backlog and planned tasks
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Project Details Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Project Health Card - Full Width */}
          {projectHealth && (
            <ProjectHealthCard health={projectHealth} projectName={project.name} />
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Project Information */}
            <Card>
              <CardHeader>
                <CardTitle>Project Information</CardTitle>
                <CardDescription>Basic details about this project</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Description</div>
                  <p className="text-sm">{project.description || 'No description provided'}</p>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Client Name</div>
                  <p className="text-sm">{project.clientName || 'Not specified'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Start Date</div>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-4 w-4" />
                      <span>{project.startDate ? formatDate(project.startDate) : 'Not set'}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">End Date</div>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-4 w-4" />
                      <span>{project.endDate ? formatDate(project.endDate) : 'Not set'}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Methodology</div>
                  <div className="flex items-center gap-2">
                    {project.methodology === 'SCRUM' ? (
                      <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <GitBranch className="h-4 w-4" />
                        <span className="text-sm">Scrum</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                        <Kanban className="h-4 w-4" />
                        <span className="text-sm">Kanban</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Project Code</div>
                  <Badge variant="outline">{project.shortCode}</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Team Members */}
            <Card>
              <CardHeader>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>People working on this project</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {project.memberIds && Array.isArray(project.memberIds) && project.memberIds.length > 0
                      ? `${project.memberIds.length} team member(s)`
                      : 'No team members yet'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Updates */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Updates</CardTitle>
              <CardDescription>Latest activity across all project entities</CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length > 0 ? (
                <div className="space-y-2">
                  {tasks.slice(0, 5).map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs">
                          {task.hierarchyId}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {task.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={
                          task.status === 'DONE'
                            ? 'success'
                            : task.status === 'IN_PROGRESS'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {task.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">No recent updates</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Project Settings</CardTitle>
              <CardDescription>Manage your project configuration</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Configure project details, methodology, status, dates, and more.
              </p>
              <Button onClick={() => router.push(`/projects/${project?.id}/settings`)}>
                <Settings className="h-4 w-4 mr-2" />
                Open Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
