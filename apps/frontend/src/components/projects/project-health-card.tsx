'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, CheckCircle2, Clock, Link2, Lightbulb } from 'lucide-react';
import type { ProjectHealthMetrics } from '@/lib/project-health';
import { getHealthColor, getHealthBgColor, getHealthBorderColor } from '@/lib/project-health';
import { cn } from '@/lib/utils';

interface ProjectHealthCardProps {
  health: ProjectHealthMetrics;
  projectName?: string;
}

export function ProjectHealthCard({ health, projectName }: ProjectHealthCardProps) {
  return (
    <Card className={cn('border-2', getHealthBorderColor(health.score))}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Project Health
              {projectName && (
                <span className="text-muted-foreground text-base">• {projectName}</span>
              )}
            </CardTitle>
            <CardDescription>Overall project performance metrics</CardDescription>
          </div>
          <div className={cn('text-4xl font-bold', getHealthColor(health.score))}>
            {health.score}%
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Health Score Meter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Health Score</span>
            <Badge
              variant={
                health.status === 'critical'
                  ? 'destructive'
                  : health.status === 'warning'
                    ? 'outline'
                    : 'default'
              }
              className={cn(
                health.status === 'warning' && 'bg-yellow-100 text-yellow-800 border-yellow-300',
                health.status === 'good' && 'bg-green-100 text-green-800 border-green-300',
                health.status === 'excellent' &&
                  'bg-emerald-100 text-emerald-800 border-emerald-300'
              )}
            >
              {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
            </Badge>
          </div>
          <Progress value={health.score} className={cn('h-3', getHealthBgColor(health.score))} />
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className={cn('rounded-lg p-3 border', getHealthBorderColor(health.completionRate))}>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <CheckCircle2 className="h-4 w-4" />
              <span>Completion</span>
            </div>
            <div className="text-2xl font-bold">{health.completionRate}%</div>
            <div className="text-xs text-muted-foreground">
              {health.completedTasksCount} of{' '}
              {health.completedTasksCount +
                health.activeTasksCount +
                health.blockedTasksCount +
                health.overdueTasksCount}{' '}
              tasks
            </div>
          </div>

          <div
            className={cn(
              'rounded-lg p-3 border',
              health.overdueTasksCount > 0
                ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                : 'border-gray-200'
            )}
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span>Overdue</span>
            </div>
            <div
              className={cn(
                'text-2xl font-bold',
                health.overdueTasksCount > 0 ? 'text-red-600' : 'text-green-600'
              )}
            >
              {health.overdueTasksCount}
            </div>
            <div className="text-xs text-muted-foreground">
              {health.overdueRate}% of total tasks
            </div>
          </div>

          <div
            className={cn(
              'rounded-lg p-3 border',
              health.activeTasksCount > 20
                ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30'
                : 'border-gray-200'
            )}
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span>Active</span>
            </div>
            <div className="text-2xl font-bold">{health.activeTasksCount}</div>
            <div className="text-xs text-muted-foreground">In progress or pending</div>
          </div>

          <div
            className={cn(
              'rounded-lg p-3 border',
              health.blockedTasksCount > 0
                ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/30'
                : 'border-gray-200'
            )}
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Link2 className="h-4 w-4" />
              <span>Blocked</span>
            </div>
            <div
              className={cn(
                'text-2xl font-bold',
                health.blockedTasksCount > 0 ? 'text-orange-600' : 'text-gray-600'
              )}
            >
              {health.blockedTasksCount}
            </div>
            <div className="text-xs text-muted-foreground">Waiting on dependencies</div>
          </div>
        </div>

        {/* Recommendations */}
        {health.recommendations.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-yellow-600" />
              <span>Recommendations</span>
            </div>
            <ul className="space-y-2">
              {health.recommendations.map((recommendation, index) => (
                <li
                  key={index}
                  className="text-sm text-muted-foreground flex items-start gap-2 p-2 rounded-md bg-muted/50"
                >
                  <span className="text-primary mt-0.5">•</span>
                  <span>{recommendation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
