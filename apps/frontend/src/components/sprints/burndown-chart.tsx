'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import type { Task } from '@/types';
import { legendLabel } from '@/lib/chart-legend';
import type { SprintFigures } from '@/lib/sprint-figures';
import { format, eachDayOfInterval, startOfDay, endOfDay, parseISO } from 'date-fns';

// Design tokens, not raw hex: the previous slate/blue literals ignored dark mode
// and disagreed with the palette every other chart surface uses.
const IDEAL_COLOR = 'hsl(var(--muted-foreground))';
const ACTUAL_COLOR = 'hsl(var(--info))';

/**
 * When a DONE task actually finished. The API stamps `completedAt` on the
 * transition into DONE; rows completed before that column existed fall back to
 * `updatedAt`. Read structurally so this does not wait on the shared Task type.
 */
export function completionDate(task: Task): string {
  return (task as Task & { completedAt?: string | null }).completedAt ?? task.updatedAt;
}

interface BurndownChartProps {
  tasks: Task[];
  sprintStartDate: string;
  sprintEndDate: string;
  /**
   * How far the sprint got (sprintFigures). Closing a sprint rolls its
   * unfinished tasks out, so `tasks` then holds the finished ones alone and
   * counting them read 100% on every closed sprint, against the board's own
   * stat card and Analytics. The totals come from here when it is given.
   */
  figures?: SprintFigures;
}

interface ChartDataPoint {
  day: string;
  date: Date;
  ideal: number;
  actual: number | null;
  completed: number | null;
}

interface BurndownTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: React.ReactNode;
    value?: number | string | null;
    color?: string;
    payload: ChartDataPoint;
  }>;
}

export function BurndownChart({
  tasks,
  sprintStartDate,
  sprintEndDate,
  figures,
}: BurndownChartProps) {
  const doneTasks = tasks.filter((t) => t.status === 'DONE').length;
  const totalTasks = figures?.total ?? tasks.length;
  const completedTasks = figures?.completed ?? doneTasks;
  // Closed before figures were kept: there is no true rate, and none is invented.
  const unrecorded = figures?.source === 'unrecorded';
  const completionRate = figures
    ? figures.completionRate
    : totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;

  const chartData = React.useMemo(() => {
    // Sprint dates arrive date-only ("2026-08-11"). `new Date(...)` parses that
    // as UTC midnight, which lands on the previous local day west of UTC and
    // shifts every bucket; parseISO keeps it on the local calendar day.
    const start = startOfDay(parseISO(sprintStartDate));
    const end = endOfDay(parseISO(sprintEndDate));
    const today = startOfDay(new Date());

    // Get all days in sprint
    const sprintDays = eachDayOfInterval({ start, end });
    
    // Calculate total tasks (story points removed). On a closed sprint that is
    // what it closed with, rolled-over work included, as on Analytics.
    const totalPoints = totalTasks;
    const totalDays = sprintDays.length;

    // Build chart data
    const data: ChartDataPoint[] = sprintDays.map((day, index) => {
      const dayEnd = endOfDay(day);
      const dayNumber = index + 1;

    // Ideal burndown (linear based on task count)
    const idealRemaining = totalPoints - (totalPoints / totalDays) * dayNumber;

      // Actual burndown (count completed tasks by this day), bucketed on the
      // real completion timestamp. `updatedAt` is only the fallback for rows
      // finished before `completedAt` existed — using it alone moved a task
      // forward in this series on any later edit.
      const completedByDay = tasks.filter(task => {
        if (task.status !== 'DONE') return false;
        return new Date(completionDate(task)) <= dayEnd;
      });
      
        const completedPoints = completedByDay.length;
        const actualRemaining = totalPoints - completedPoints;

      return {
        day: `Day ${dayNumber}`,
        date: day,
        ideal: Math.max(0, Math.round(idealRemaining)),
        actual: day <= today ? Math.round(actualRemaining) : null,
        completed: day <= today ? Math.round(completedPoints) : null,
      };
    });

    return { data, totalPoints };
  }, [tasks, totalTasks, sprintStartDate, sprintEndDate]);

  const CustomTooltip = ({ active, payload }: BurndownTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-sm mb-1">
            {format(data.date, 'MMM d, yyyy')}
          </p>
          <p className="text-sm text-muted-foreground mb-1">{data.day}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value} tasks
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sprint Burndown</CardTitle>
            <CardDescription>
              {unrecorded
                ? 'Not recorded — this sprint was closed before completion figures were kept'
                : 'Ideal vs actual remaining tasks'}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{unrecorded ? '—' : `${completionRate}%`}</div>
            <p className="text-xs text-muted-foreground">Complete</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData.data}>
              <defs>
                <linearGradient id="colorIdeal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={IDEAL_COLOR} stopOpacity={0.1}/>
                  <stop offset="95%" stopColor={IDEAL_COLOR} stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={ACTUAL_COLOR} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={ACTUAL_COLOR} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="day" 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis 
                label={{ value: 'Tasks', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="line"
                formatter={legendLabel}
              />
              <Area
                type="monotone"
                dataKey="ideal"
                stroke={IDEAL_COLOR}
                strokeWidth={2}
                strokeDasharray="5 5"
                fill="url(#colorIdeal)"
                name="Ideal Burndown"
              />
              <Area
                type="monotone"
                dataKey="actual"
                stroke={ACTUAL_COLOR}
                strokeWidth={2}
                fill="url(#colorActual)"
                name="Actual Burndown"
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total Tasks</p>
            <p className="text-2xl font-bold">{chartData.totalPoints}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold text-success-text">{completedTasks}</p>
          </div>
          <div className="text-center">
            {/* A closed sprint has nothing remaining in it: what was unfinished
                left it, back to the backlog. */}
            <p className="text-sm text-muted-foreground">
              {figures?.source === 'snapshot' ? 'Rolled Over' : 'Remaining'}
            </p>
            <p className="text-2xl font-bold text-info-text">
              {Math.max(0, totalTasks - completedTasks)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
