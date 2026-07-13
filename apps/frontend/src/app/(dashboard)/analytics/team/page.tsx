'use client';

import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTeamAnalytics } from '@/hooks/use-analytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageLoader } from '@/components/ui/page-loader';
import { MetricCard, HealthBadge } from '@/components/analytics/kpi-widgets';
import {
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Users, TrendingUp, CheckCircle2, Target, Clock, Award } from 'lucide-react';

export default function TeamPerformancePage() {
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: teamAnalytics, isLoading: analyticsLoading } = useTeamAnalytics(
    currentWorkspace?.id
  );

  if (workspacesLoading || analyticsLoading) {
    return <PageLoader message="Loading team analytics..." />;
  }

  if (!currentWorkspace || !teamAnalytics) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <Users className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Team Data</h2>
          <p className="text-muted-foreground">Assign tasks to team members to see analytics</p>
        </div>
      </div>
    );
  }

  // Sort members by completion rate
  const topPerformers = [...teamAnalytics.memberPerformance]
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 5);

  // Prepare workload distribution data
  const workloadData = teamAnalytics.workloadDistribution
    .sort((a, b) => b.taskCount - a.taskCount)
    .slice(0, 10);

  // Prepare comparison data for all members
  const comparisonData = teamAnalytics.memberPerformance.map((member) => ({
    name: `Member ${member.memberId.slice(0, 6)}`,
    completionRate: member.completionRate,
    velocity: member.velocity,
    efficiency: member.efficiency,
  }));

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="h-8 w-8" />
          Team Performance
        </h1>
        <p className="text-muted-foreground mt-1">Individual and team-wide performance metrics</p>
      </div>

      {/* Team Overview KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Team Size"
          value={teamAnalytics.teamSize}
          subtitle="Active members"
          icon={Users}
        />
        <MetricCard
          title="Total Tasks"
          value={teamAnalytics.totalTasks}
          subtitle="Across all projects"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Avg Completion Rate"
          value={`${teamAnalytics.avgCompletionRate.toFixed(1)}%`}
          subtitle="Team average"
          icon={Target}
        />
        <MetricCard
          title="Avg Velocity"
          value={`${teamAnalytics.avgVelocity.toFixed(0)} pts`}
          subtitle="Story points per member"
          icon={TrendingUp}
        />
      </div>

      {/* Top Performers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-yellow-500" />
            Top Performers
          </CardTitle>
          <CardDescription>Team members with highest completion rates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topPerformers.map((member, index) => (
              <div key={member.memberId} className="flex items-center gap-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                  {index + 1}
                </div>
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{member.memberId.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">Member {member.memberId.slice(0, 8)}</p>
                  <p className="text-sm text-muted-foreground">
                    {member.completedTasks} completed • {member.velocity} pts velocity
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <div className="font-bold text-lg">{member.completionRate.toFixed(1)}%</div>
                  <HealthBadge value={member.completionRate} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Workload Distribution */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workload Distribution</CardTitle>
            <CardDescription>Task count per team member</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={workloadData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis
                  dataKey="memberId"
                  type="category"
                  tickFormatter={(value) => `Member ${value.slice(0, 6)}`}
                />
                <Tooltip
                  formatter={(value: any) => [`${value} tasks`, 'Tasks']}
                  labelFormatter={(label) => `Member ${label.slice(0, 8)}`}
                />
                <Bar dataKey="taskCount" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance Comparison</CardTitle>
            <CardDescription>Multi-dimensional performance view</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={comparisonData.slice(0, 5)}>
                <PolarGrid />
                <PolarAngleAxis dataKey="name" />
                <PolarRadiusAxis angle={90} domain={[0, 100]} />
                <Radar
                  name="Completion Rate"
                  dataKey="completionRate"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.6}
                />
                <Tooltip />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Member Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Individual Performance Details</CardTitle>
          <CardDescription>Comprehensive metrics for each team member</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {teamAnalytics.memberPerformance
              .sort((a, b) => b.completionRate - a.completionRate)
              .map((member) => (
                <div key={member.memberId} className="space-y-3 p-4 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback>{member.memberId.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold">Member {member.memberId.slice(0, 8)}</p>
                        <p className="text-sm text-muted-foreground">
                          {member.totalTasks} total tasks
                        </p>
                      </div>
                    </div>
                    <HealthBadge value={member.completionRate} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Completed</div>
                      <div className="text-2xl font-bold text-green-500">
                        {member.completedTasks}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">In Progress</div>
                      <div className="text-2xl font-bold text-blue-500">
                        {member.inProgressTasks}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Velocity</div>
                      <div className="text-2xl font-bold text-purple-500">
                        {member.velocity} pts
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Efficiency</div>
                      <div className="text-2xl font-bold">{member.efficiency.toFixed(0)}%</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Completion Rate</span>
                      <span className="font-medium">{member.completionRate.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${member.completionRate}%` }}
                      />
                    </div>
                  </div>

                  {member.estimatedHours > 0 && (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Estimated Hours
                        </div>
                        <div className="font-medium">{member.estimatedHours}h</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Actual Hours
                        </div>
                        <div className="font-medium">{member.actualHours}h</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
