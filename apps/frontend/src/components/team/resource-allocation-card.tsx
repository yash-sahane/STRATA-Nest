'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  /**
   * The workspace's task list has not arrived yet.
   *
   * Without this the card could not tell "nobody has any tasks" from "we do not know
   * yet", and showed the empty state for both. Two things went wrong with that. It told
   * anyone on a slow connection "No task assignments yet" about a team that had plenty,
   * and then — because the empty state is far shorter than the real list plus its legend
   * — the card GREW when the data landed and shoved the Team Directory down the page.
   *
   * Measured with the task list held back 4s: CLS 0.1799 against a "good" bar of 0.1,
   * and 0.0000 when it answered promptly (e2e/probe-team-cls.mjs).
   */
  isLoading?: boolean;
  /**
   * How many rows to reserve while loading. The roster has already arrived by the time
   * this card renders, so the count is known exactly and the placeholder can be the same
   * height as what replaces it — which is what makes the shift nothing rather than
   * merely smaller.
   */
  placeholderRows?: number;
}

export function ResourceAllocationCard({
  workloadData,
  averageWorkload,
  isLoading = false,
  placeholderRows = 3,
}: ResourceAllocationCardProps) {
  // The legend is static — it describes the bands, not the data — so it belongs on screen
  // from the first paint. Hiding it until the tasks arrive was half the height change.
  const showLegend = isLoading || workloadData.length > 0;
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
            {/* `0%` while the tasks are still coming is a figure, and a wrong one. The
                placeholder is sized to the number it replaces so this corner does not
                move either. */}
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className={cn('text-2xl font-bold', getWorkloadColor(averageWorkload))}>
                {averageWorkload}%
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          /* The same DOM as a real row, with the text swapped for blocks, so the height
             matches by construction rather than by a number kept in step by hand. */
          <div className="divide-y rounded-md border">
            {Array.from({ length: Math.max(1, placeholderRows) }, (_, i) => (
              <div key={i} className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  {/* `min-w-0` here for the same reason as the real row below. */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="flex-1 min-w-0 space-y-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-10" />
                </div>
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        ) : workloadData.length > 0 ? (
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
                    {/* `min-w-0`, or this row cannot shrink. A flex item's automatic
                        minimum size is its content's, so without it this div refuses to
                        go narrower than the avatar plus the un-shrinkable status badge,
                        and the `truncate` on the name inside never gets the chance to
                        engage. Measured at 320px: the row wanted 297px inside a 212px
                        column, and the Card's own `overflow-hidden` then cut 74px off the
                        end — taking the whole workload percentage with it, silently. */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
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
                    <p className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400">
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

        {showLegend && (
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
