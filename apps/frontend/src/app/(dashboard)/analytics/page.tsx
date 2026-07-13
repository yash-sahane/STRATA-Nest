'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BarChart3,
  Users,
  FolderKanban,
  Target,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { MetricCard, HealthBadge } from '@/components/analytics/kpi-widgets';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useWorkspaceTasks } from '@/hooks/use-task';
import {
  useProjectAnalytics,
  useWorkspaceAnalytics,
  useTeamAnalytics,
} from '@/hooks/use-analytics';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function AnalyticsPage() {
  const searchParams = useSearchParams();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: projects = [], isLoading: projectsLoading } = useProjects(currentWorkspace?.id);
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [activeTab, setActiveTab] = React.useState(searchParams.get('view') || 'workspace');

  const { data: projectAnalytics, isLoading: projectAnalyticsLoading } =
    useProjectAnalytics(selectedProjectId);
  const { data: workspaceAnalytics, isLoading: workspaceLoading } = useWorkspaceAnalytics(
    currentWorkspace?.id
  );
  const { data: teamAnalytics, isLoading: teamLoading } = useTeamAnalytics(currentWorkspace?.id);
  const { data: allTasks = [] } = useWorkspaceTasks(currentWorkspace?.id);

  // Set first project as default
  React.useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  if (workspacesLoading || projectsLoading) {
    return <PageLoader message="Loading analytics..." />;
  }

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <BarChart3 className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to view analytics</p>
        </div>
      </div>
    );
  }

  const isLoading = workspaceLoading || projectAnalyticsLoading || teamLoading;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-8 w-8" />
            Analytics & Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive insights and performance metrics
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-[600px]">
          <TabsTrigger value="workspace">Workspace Overview</TabsTrigger>
          <TabsTrigger value="projects">Project Analytics</TabsTrigger>
          <TabsTrigger value="team">Team Performance</TabsTrigger>
        </TabsList>

        {/* Workspace Overview Tab */}
        <TabsContent value="workspace" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !workspaceAnalytics ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No workspace analytics available</p>
            </div>
          ) : (
            <>
              {/* KPI Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Active Projects"
                  value={workspaceAnalytics.projects.active}
                  icon={FolderKanban}
                />
                <MetricCard
                  title="Total Tasks"
                  value={workspaceAnalytics.tasks.total}
                  icon={CheckCircle2}
                />
                <MetricCard
                  title="Completion Rate"
                  value={`${workspaceAnalytics.tasks.completionRate.toFixed(1)}%`}
                  icon={Target}
                />
                <MetricCard
                  title="Team Members"
                  value={workspaceAnalytics.team.size}
                  icon={Users}
                />
              </div>

              {/* Quick Stats */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Completed Tasks</p>
                        <p className="text-2xl font-bold">{workspaceAnalytics.tasks.completed}</p>
                      </div>
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Overdue Tasks</p>
                        <p className="text-2xl font-bold">
                          {
                            allTasks.filter(
                              (t: any) =>
                                t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE'
                            ).length
                          }
                        </p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-red-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Active Sprints</p>
                        <p className="text-2xl font-bold">{workspaceAnalytics.sprints.active}</p>
                      </div>
                      <Activity className="h-8 w-8 text-blue-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">In Progress</p>
                        <p className="text-2xl font-bold">{workspaceAnalytics.tasks.inProgress}</p>
                      </div>
                      <Clock className="h-8 w-8 text-orange-500" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Projects Health Overview */}
              <Card>
                <CardHeader>
                  <CardTitle>Projects Health</CardTitle>
                  <CardDescription>Overview of all projects in workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project: any) => {
                      const projectTasks = allTasks.filter((t: any) => t.projectId === project.id);
                      const completed = projectTasks.filter((t: any) => t.status === 'DONE').length;
                      const total = projectTasks.length;
                      const overdue = projectTasks.filter(
                        (t: any) =>
                          t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE'
                      ).length;
                      const completionRate = total > 0 ? (completed / total) * 100 : 0;

                      return (
                        <Card key={project.id}>
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">{project.name}</CardTitle>
                              <HealthBadge value={completionRate} />
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Progress</span>
                                <span className="font-medium">{completionRate.toFixed(0)}%</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                                <div
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${completionRate}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-sm text-muted-foreground">
                                <span>
                                  {completed}/{total} tasks
                                </span>
                                {overdue > 0 && (
                                  <span className="text-red-500">{overdue} overdue</span>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Charts Row 1 */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Task Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Task Distribution</CardTitle>
                    <CardDescription>Tasks by status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={[
                            {
                              name: 'Backlog',
                              value: allTasks.filter((t: any) => t.status === 'BACKLOG').length,
                            },
                            {
                              name: 'To Do',
                              value: allTasks.filter((t: any) => t.status === 'TODO').length,
                            },
                            {
                              name: 'In Progress',
                              value: allTasks.filter((t: any) => t.status === 'IN_PROGRESS').length,
                            },
                            {
                              name: 'Review',
                              value: allTasks.filter((t: any) => t.status === 'REVIEW').length,
                            },
                            {
                              name: 'Done',
                              value: allTasks.filter((t: any) => t.status === 'DONE').length,
                            },
                          ].filter((item) => item.value > 0)}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }: any) =>
                            `${name} ${(percent * 100).toFixed(0)}%`
                          }
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {COLORS.map((color, index) => (
                            <Cell key={`cell-${index}`} fill={color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Monthly Trends */}
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Completion Trend</CardTitle>
                    <CardDescription>Tasks completed per month</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={workspaceAnalytics.monthlyTrends}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="completed"
                          stroke={COLORS[0]}
                          strokeWidth={2}
                          name="Tasks Completed"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Charts Row 2 */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Priority Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Priority Breakdown</CardTitle>
                    <CardDescription>Tasks by priority level</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart
                        data={[
                          {
                            name: 'Critical',
                            value: allTasks.filter((t: any) => t.priority === 'CRITICAL').length,
                          },
                          {
                            name: 'High',
                            value: allTasks.filter((t: any) => t.priority === 'HIGH').length,
                          },
                          {
                            name: 'Medium',
                            value: allTasks.filter((t: any) => t.priority === 'MEDIUM').length,
                          },
                          {
                            name: 'Low',
                            value: allTasks.filter((t: any) => t.priority === 'LOW').length,
                          },
                        ]}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill={COLORS[2]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Project Status */}
                <Card>
                  <CardHeader>
                    <CardTitle>Project Status</CardTitle>
                    <CardDescription>Distribution of project statuses</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={[
                            {
                              name: 'Active',
                              value: projects.filter((p: any) => p.status === 'ACTIVE').length,
                            },
                            {
                              name: 'Completed',
                              value: projects.filter((p: any) => p.status === 'COMPLETED').length,
                            },
                            {
                              name: 'On Hold',
                              value: projects.filter((p: any) => p.status === 'ON_HOLD').length,
                            },
                          ].filter((item) => item.value > 0)}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value }: any) => `${name}: ${value}`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {COLORS.map((color, index) => (
                            <Cell key={`cell-${index}`} fill={color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Activity */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                  <CardDescription>Latest task updates across workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {allTasks
                      .sort(
                        (a: any, b: any) =>
                          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                      )
                      .slice(0, 10)
                      .map((task: any) => {
                        const project = projects.find((p: any) => p.id === task.projectId);
                        return (
                          <div
                            key={task.id}
                            className="flex items-start gap-4 pb-4 border-b last:border-0"
                          >
                            <div className="flex-1">
                              <p className="font-medium">{task.title}</p>
                              <p className="text-sm text-muted-foreground">
                                {project?.name} · Updated{' '}
                                {new Date(task.updatedAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                task.status === 'DONE'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  : task.status === 'IN_PROGRESS'
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                    : task.status === 'REVIEW'
                                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                              }`}
                            >
                              {task.status.replace('_', ' ')}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Project Analytics Tab */}
        <TabsContent value="projects" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Project Analytics</CardTitle>
                  <CardDescription>Detailed metrics for selected project</CardDescription>
                </div>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger className="w-[250px]">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
          </Card>

          {projectAnalyticsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !projectAnalytics || !selectedProjectId ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Select a project to view analytics</p>
            </div>
          ) : (
            <>
              {/* Project KPIs */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Total Tasks"
                  value={projectAnalytics.totalTasks}
                  icon={Activity}
                />
                <MetricCard
                  title="Completion Rate"
                  value={`${projectAnalytics.completionRate.toFixed(1)}%`}
                  icon={Target}
                />
                <MetricCard
                  title="Overdue Tasks"
                  value={projectAnalytics.overdueTasks}
                  icon={AlertTriangle}
                />
                <MetricCard
                  title="Story Points"
                  value={`${projectAnalytics.completedStoryPoints}/${projectAnalytics.totalStoryPoints}`}
                  icon={Clock}
                />
              </div>

              {/* Project Charts */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Status Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={Object.entries(projectAnalytics.statusDistribution)
                            .map(([name, value]) => ({ name: name.replace('_', ' '), value }))
                            .filter((item) => item.value > 0)}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }: any) =>
                            `${name} ${(percent * 100).toFixed(0)}%`
                          }
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {COLORS.map((color, index) => (
                            <Cell key={`cell-${index}`} fill={color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Priority Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart
                        data={Object.entries(projectAnalytics.priorityDistribution).map(
                          ([name, value]) => ({ name, value })
                        )}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill={COLORS[1]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Team Performance Tab */}
        <TabsContent value="team" className="space-y-4">
          {teamLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !teamAnalytics ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No team performance data available</p>
            </div>
          ) : (
            <>
              {/* Team KPIs */}
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  title="Total Tasks"
                  value={teamAnalytics.totalTasks}
                  icon={CheckCircle2}
                />
                <MetricCard
                  title="Avg Completion Rate"
                  value={`${teamAnalytics.avgCompletionRate.toFixed(1)}%`}
                  icon={Target}
                />
                <MetricCard title="Team Size" value={teamAnalytics.teamSize} icon={Users} />
              </div>

              {/* Top Performers */}
              <Card>
                <CardHeader>
                  <CardTitle>Team Member Performance</CardTitle>
                  <CardDescription>Individual performance metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {teamAnalytics.memberPerformance
                      .sort((a: any, b: any) => b.completedTasks - a.completedTasks)
                      .slice(0, 10)
                      .map((member: any, index: number) => (
                        <div key={member.memberId} className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-medium">Member {member.memberId.slice(0, 8)}</p>
                              <p className="text-sm text-muted-foreground">
                                {member.completedTasks} / {member.totalTasks} tasks
                              </p>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                                <div
                                  className="bg-green-500 h-2 rounded-full transition-all"
                                  style={{ width: `${member.completionRate}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-12 text-right">
                                {member.completionRate.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              {/* Workload Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Workload Distribution</CardTitle>
                  <CardDescription>Task distribution across team members</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={teamAnalytics.workloadDistribution}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="memberId"
                        tickFormatter={(value: string) => `Member ${value.slice(0, 6)}`}
                      />
                      <YAxis />
                      <Tooltip
                        labelFormatter={(value: any) => `Member ${String(value).slice(0, 8)}`}
                      />
                      <Legend />
                      <Bar dataKey="taskCount" fill={COLORS[1]} name="Task Count" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
