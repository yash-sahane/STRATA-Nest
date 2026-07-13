'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import type { Task } from '@/types';
import { format, eachDayOfInterval, startOfDay, endOfDay } from 'date-fns';

interface BurndownChartProps {
  tasks: Task[];
  sprintStartDate: string;
  sprintEndDate: string;
}

interface ChartDataPoint {
  day: string;
  date: Date;
  ideal: number;
  actual: number;
  completed: number;
}

export function BurndownChart({
  tasks,
  sprintStartDate,
  sprintEndDate
}: BurndownChartProps) {
  const chartData = React.useMemo(() => {
    const start = startOfDay(new Date(sprintStartDate));
    const end = endOfDay(new Date(sprintEndDate));
    const today = startOfDay(new Date());

    // Get all days in sprint
    const sprintDays = eachDayOfInterval({ start, end });
    
    // Calculate total tasks (story points removed)
    const totalPoints = tasks.length;
    const totalDays = sprintDays.length;

    // Build chart data
    const data: ChartDataPoint[] = sprintDays.map((day, index) => {
      const dayEnd = endOfDay(day);
      const dayNumber = index + 1;

    // Ideal burndown (linear based on task count)
    const idealRemaining = totalPoints - (totalPoints / totalDays) * dayNumber;

      // Actual burndown (count completed tasks by this day)
      const completedByDay = tasks.filter(task => {
        if (task.status !== 'DONE') return false;
        const updatedDate = new Date(task.updatedAt);
        return updatedDate <= dayEnd;
      });
      
        const completedPoints = completedByDay.length;
        const actualRemaining = totalPoints - completedPoints;

      return {
        day: `Day ${dayNumber}`,
        date: day,
        ideal: Math.max(0, Math.round(idealRemaining)),
        actual: day <= today ? Math.round(actualRemaining) : null as any,
        completed: day <= today ? Math.round(completedPoints) : null as any,
      };
    });

    return { data, totalPoints };
  }, [tasks, sprintStartDate, sprintEndDate]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium text-sm mb-1">
            {format(data.date, 'MMM dd, yyyy')}
          </p>
          <p className="text-sm text-muted-foreground mb-1">{data.day}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value} points
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const completedTasks = tasks.filter(t => t.status === 'DONE').length;
  const completionRate = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sprint Burndown</CardTitle>
            <CardDescription>
              Ideal vs Actual remaining story points
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{completionRate}%</div>
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
                  <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
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
              />
              <Area
                type="monotone"
                dataKey="ideal"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="5 5"
                fill="url(#colorIdeal)"
                name="Ideal Burndown"
              />
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#3b82f6"
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
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {tasks.filter(t => t.status === 'DONE').length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Remaining</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {tasks.filter(t => t.status !== 'DONE').length}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
