'use client';

import { Clock, Play, Pause, Square, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  useTaskTimeEntries,
  useActiveTimer,
  useStartTimer,
  useToggleTimer,
  useStopTimer,
} from '@/hooks/use-time-entry';
import { ManualTimeEntryDialog } from './manual-time-entry-dialog';
import { formatMinutesHuman } from '@/lib/utils/time-format';
import type { Task } from '@/types';

interface TaskTimeTrackingProps {
  task: Task;
  userId: string;
  userName: string;
  userEmail: string;
  workspaceId: string;
}

export function TaskTimeTracking({
  task,
  userId,
  userName,
  userEmail,
  workspaceId,
}: TaskTimeTrackingProps) {
  const { data: timeEntries = [] } = useTaskTimeEntries(task.id);
  const { data: activeTimer } = useActiveTimer(userId);

  const startTimerMutation = useStartTimer();
  const toggleTimerMutation = useToggleTimer();
  const stopTimerMutation = useStopTimer();

  // Check if timer is running for this task
  const isTimerRunningForThisTask = activeTimer && activeTimer.taskId === task.id;

  // Calculate totals
  const totalMinutes = timeEntries.reduce((sum, entry) => sum + entry.duration, 0);
  const billableMinutes = timeEntries.reduce(
    (sum, entry) => (entry.isBillable ? sum + entry.duration : sum),
    0
  );
  const approvedMinutes = timeEntries.reduce(
    (sum, entry) => (entry.status === 'APPROVED' ? sum + entry.duration : sum),
    0
  );

  // Calculate progress if estimate exists
  const progressPercentage = task.estimatedHours
    ? Math.min((totalMinutes / (task.estimatedHours * 60)) * 100, 100)
    : 0;

  const isOverEstimate = task.estimatedHours && totalMinutes > task.estimatedHours * 60;

  const handleStartTimer = async () => {
    await startTimerMutation.mutateAsync({
      userId,
      taskId: task.id,
      taskTitle: task.title,
      taskHierarchyId: task.hierarchyId,
      projectId: task.projectId,
      description: `Working on ${task.hierarchyId}`,
      type: 'TIMER',
    });
  };

  const handleToggleTimer = async () => {
    if (!activeTimer) return;

    const now = new Date().toISOString();

    if (activeTimer.isPaused) {
      const pausedDuration = activeTimer.pausedAt
        ? Math.floor((new Date().getTime() - new Date(activeTimer.pausedAt).getTime()) / 1000 / 60)
        : 0;

      await toggleTimerMutation.mutateAsync({
        timerId: activeTimer.id,
        userId,
        isPaused: false,
        pausedAt: undefined,
        totalPausedTime: (activeTimer.totalPausedTime || 0) + pausedDuration,
      });
    } else {
      await toggleTimerMutation.mutateAsync({
        timerId: activeTimer.id,
        userId,
        isPaused: true,
        pausedAt: now,
      });
    }
  };

  const handleStopTimer = async () => {
    if (!activeTimer) return;

    await stopTimerMutation.mutateAsync({
      timerId: activeTimer.id,
      userId,
      workspaceId,
      userName,
      userEmail,
      taskId: task.id,
      taskTitle: task.title,
      taskHierarchyId: task.hierarchyId,
      projectId: task.projectId,
      projectName: undefined,
      description: activeTimer.description,
      startTime: activeTimer.startTime,
      totalPausedTime: activeTimer.totalPausedTime || 0,
      isBillable: false,
      type: activeTimer.type,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Time Tracking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Total Logged</div>
            <div className="text-2xl font-bold">{formatMinutesHuman(totalMinutes)}</div>
          </div>
          {task.estimatedHours && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Estimated</div>
              <div className="text-2xl font-bold">
                {formatMinutesHuman(task.estimatedHours * 60)}
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {task.estimatedHours && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className={isOverEstimate ? 'text-destructive font-semibold' : ''}>
                {progressPercentage.toFixed(0)}%
              </span>
            </div>
            <Progress
              value={progressPercentage}
              className={isOverEstimate ? 'h-2 [&>div]:bg-destructive' : 'h-2'}
            />
            {isOverEstimate && (
              <div className="flex items-center gap-1 text-xs text-destructive">
                <TrendingUp className="h-3 w-3" />
                Over estimate by {formatMinutesHuman(totalMinutes - task.estimatedHours * 60)}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Breakdown */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Billable Hours</span>
            <Badge variant="secondary">{formatMinutesHuman(billableMinutes)}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Approved Hours</span>
            <Badge variant="outline">{formatMinutesHuman(approvedMinutes)}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Entries</span>
            <Badge>{timeEntries.length}</Badge>
          </div>
        </div>

        <Separator />

        {/* Timer Actions */}
        <div className="space-y-2">
          {isTimerRunningForThisTask ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-primary/10 rounded-md">
                <span className="text-sm font-medium">Timer Running</span>
                <Badge variant="default">Active</Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleToggleTimer}
                  disabled={toggleTimerMutation.isPending}
                >
                  {activeTimer?.isPaused ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Pause
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={handleStopTimer}
                  disabled={stopTimerMutation.isPending}
                >
                  <Square className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              </div>
            </div>
          ) : activeTimer ? (
            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
              Timer is running for another task
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleStartTimer}
              disabled={startTimerMutation.isPending}
            >
              <Play className="h-4 w-4 mr-2" />
              Start Timer
            </Button>
          )}

          <ManualTimeEntryDialog
            userId={userId}
            userName={userName}
            userEmail={userEmail}
            taskId={task.id}
            trigger={
              <Button variant="ghost" size="sm" className="w-full">
                <Clock className="h-4 w-4 mr-2" />
                Log Time Manually
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
