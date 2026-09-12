'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamMemberWorkload } from '@/lib/team-workload';
import {
  getWorkloadBarColor,
  getWorkloadColor,
  getWorkloadBgColor,
  getWorkloadStatus,
  WORKLOAD_BANDS,
} from '@/lib/team-workload';

interface ResourceAllocationCardProps {
  workloadData: TeamMemberWorkload[];
  averageWorkload: number;
}

export function ResourceAllocationCard({
  workloadData,
  averageWorkload,
}: ResourceAllocationCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarIcon className="h-5 w-5" />
              Resource Allocation
            </CardTitle>
            <CardDescription>Team member workload distribution</CardDescription>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-left sm:text-right">
            <div className="text-sm text-muted-foreground">Average Load</div>
            <div className={cn('text-2xl font-bold', getWorkloadColor(averageWorkload))}>
              {averageWorkload}%
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {workloadData.length > 0 ? (
          <div className="divide-y rounded-md border">
            {workloadData.map((member) => {
              const initials = member.userName
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);

              const statusIcon =
                member.workloadPercentage > 100
                  ? TrendingUp
                  : member.workloadPercentage < 50
                    ? TrendingDown
                    : Minus;

              const StatusIcon = statusIcon;

              return (
                <div
                  key={member.userId}
                  className="space-y-2 p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{member.userName}</p>
                          <Badge
                            variant="outline"
                            className={cn('text-xs', getWorkloadBgColor(member.workloadPercentage))}
                          >
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {getWorkloadStatus(member.workloadPercentage)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{member.totalTasks} tasks</p>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'text-sm font-semibold',
                        getWorkloadColor(member.workloadPercentage)
                      )}
                    >
                      {member.workloadPercentage}%
                    </div>
                  </div>
                  <Progress
                    value={Math.min(member.workloadPercentage, 100)}
                    className="h-2 bg-muted"
                    indicatorClassName={getWorkloadBarColor(member.workloadPercentage)}
                  />
                  {member.workloadPercentage > 100 && (
                    <p className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                      <AlertTriangle className="h-3 w-3" />
                      Overloaded by {member.workloadPercentage - 100}%
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <CalendarIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No task assignments yet</p>
            <p className="text-xs mt-1">
              Assign tasks to team members to see workload distribution
            </p>
          </div>
        )}

        {workloadData.length > 0 && (
          <div className="pt-4 border-t space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Capacity Legend (open tasks):</span>
            </div>
            {/* Generated from the band table, not written out beside it: the
                hardcoded version listed four bands with different names and
                boundaries from the five the page actually uses. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
              {WORKLOAD_BANDS.map((band, i) => {
                const from = i === 0 ? 0 : WORKLOAD_BANDS[i - 1].maxTasks + 1;
                const open = !Number.isFinite(band.maxTasks);
                const range = open
                  ? `${from}+`
                  : from === band.maxTasks
                    ? `${band.maxTasks}`
                    : `${from}-${band.maxTasks}`;
                return (
                  <div key={band.label} className="flex items-center gap-2">
                    <div className={cn('w-3 h-3 rounded-full border', band.bgColor)} />
                    <span>
                      {band.label} ({range} {from === 1 && band.maxTasks === 1 ? 'task' : 'tasks'})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
