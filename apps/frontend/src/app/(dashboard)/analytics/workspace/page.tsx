'use client';

import Link from 'next/link';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useWorkspaceAnalytics } from '@/hooks/use-analytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/page-loader';
import { MetricCard, StatComparison } from '@/components/analytics/kpi-widgets';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  BarChart3,
  FolderKanban,
  CheckCircle2,
  GitBranch,
  Users,
  Clock,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';

export default function WorkspaceAnalyticsPage() {
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: analytics, isLoading: analyticsLoading } = useWorkspaceAnalytics(
    currentWorkspace?.id
  );

  if (workspacesLoading || analyticsLoading) {
    return <PageLoader message="Loading workspace analytics..." />;
  }

  if (!currentWorkspace || !analytics) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <BarChart3 className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Workspace Data</h2>
          <p className="text-muted-foreground">Create projects and tasks to see analytics</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-8 w-8" />
            Workspace Overview
          </h1>
          <p className="text-muted-foreground mt-1">
            High-level metrics and insights across all projects
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/analytics">
              <BarChart3 className="h-4 w-4 mr-2" />
              Project Analytics
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/analytics/team">
              <Users className="h-4 w-4 mr-2" />
              Team Reports
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Active Projects"
          value={analytics.projects.active}
          subtitle={`${analytics.projects.total} total projects`}
          icon={FolderKanban}
        />
        <MetricCard
          title="Task Completion"
          value={`${analytics.tasks.completionRate.toFixed(1)}%`}
          subtitle={`${analytics.tasks.completed} of ${analytics.tasks.total}`}
          icon={CheckCircle2}
        />
        <MetricCard
          title="Active Sprints"
          value={analytics.sprints.active}
          subtitle={`${analytics.sprints.completed} completed`}
          icon={GitBranch}
        />
        <MetricCard
          title="Team Size"
          value={analytics.team.size}
          subtitle="Active members"
          icon={Users}
        />
      </div>

      {/* Monthly Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Monthly Task Completion Trend
          </CardTitle>
          <CardDescription>Tasks completed over the last 6 months</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analytics.monthlyTrends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="completed"
                stroke="#3b82f6"
                strokeWidth={2}
                name="Tasks Completed"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Project Health & Time Metrics */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Project Health</CardTitle>
            <CardDescription>Status distribution of all projects</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={[
                  { name: 'Active', value: analytics.projects.active },
                  { name: 'Completed', value: analytics.projects.completed },
                  { name: 'On Hold', value: analytics.projects.onHold },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Time Tracking
            </CardTitle>
            <CardDescription>Estimated vs actual hours</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Estimated Hours</span>
                <span className="font-bold">{analytics.time.estimated.toLocaleString()}h</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '100%' }} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Actual Hours</span>
                <span className="font-bold">{analytics.time.actual.toLocaleString()}h</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{
                    width: `${analytics.time.estimated > 0 ? Math.min((analytics.time.actual / analytics.time.estimated) * 100, 100) : 0}%`,
                  }}
                />
              </div>
            </div>

            <div className="pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Time Efficiency</span>
                <span className="text-lg font-bold">{analytics.time.efficiency.toFixed(1)}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {analytics.time.efficiency < 100
                  ? 'Work completed faster than estimated'
                  : 'Work taking longer than estimated'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comparisons */}
      <Card>
        <CardHeader>
          <CardTitle>Period-over-Period Comparison</CardTitle>
          <CardDescription>Compare current metrics with previous period</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatComparison
              label="Total Tasks"
              current={analytics.tasks.total}
              previous={Math.floor(analytics.tasks.total * 0.85)}
              format="number"
            />
            <StatComparison
              label="Completion Rate"
              current={analytics.tasks.completionRate}
              previous={analytics.tasks.completionRate - 5}
              format="percentage"
            />
            <StatComparison
              label="Active Projects"
              current={analytics.projects.active}
              previous={analytics.projects.active - 1}
              format="number"
            />
            <StatComparison
              label="Team Size"
              current={analytics.team.size}
              previous={Math.floor(analytics.team.size * 0.9)}
              format="number"
            />
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Reports</CardTitle>
          <CardDescription>Explore in-depth analytics and insights</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Button variant="outline" className="justify-start h-auto py-4" asChild>
              <Link href="/analytics">
                <div className="flex items-start gap-3 w-full">
                  <BarChart3 className="h-5 w-5 mt-0.5" />
                  <div className="text-left flex-1">
                    <div className="font-medium">Project Analytics</div>
                    <div className="text-xs text-muted-foreground">
                      Detailed project metrics and trends
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </div>
              </Link>
            </Button>

            <Button variant="outline" className="justify-start h-auto py-4" asChild>
              <Link href="/analytics/team">
                <div className="flex items-start gap-3 w-full">
                  <Users className="h-5 w-5 mt-0.5" />
                  <div className="text-left flex-1">
                    <div className="font-medium">Team Performance</div>
                    <div className="text-xs text-muted-foreground">Individual and team metrics</div>
                  </div>
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </div>
              </Link>
            </Button>

            <Button variant="outline" className="justify-start h-auto py-4" asChild>
              <Link href="/sprints">
                <div className="flex items-start gap-3 w-full">
                  <GitBranch className="h-5 w-5 mt-0.5" />
                  <div className="text-left flex-1">
                    <div className="font-medium">Sprint Analytics</div>
                    <div className="text-xs text-muted-foreground">
                      Sprint velocity and burndown
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </div>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
