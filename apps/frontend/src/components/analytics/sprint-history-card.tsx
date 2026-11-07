'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartEmptyState } from '@/components/analytics/chart-empty-state';
import { ChartTooltip } from '@/components/analytics/chart-tooltip';
import { InlineLoader } from '@/components/ui/page-loader';
import { useSprints } from '@/hooks/use-sprint';
import { formatDate } from '@/lib/utils';
import { legendLabel } from '@/lib/chart-legend';

/** Finished first, rolled over in the warning colour: the same roles as everywhere else. */
const SERIES = {
  completed: 'hsl(var(--app-success-text))',
  rolledOver: 'hsl(var(--app-warning-text))',
};

/**
 * How the project's sprints went: for each completed sprint, what it took on,
 * what it finished and what it rolled over.
 *
 * Completing a sprint has always recorded those three numbers (they are the
 * only record left once its unfinished work is rolled out), and the sprint's
 * own analytics page showed them one sprint at a time. Nothing showed them
 * side by side, which is the question a project review asks: are we
 * committing to what we finish?
 */
export function SprintHistoryCard({ projectId }: { projectId: string }) {
  const { data: sprints = [], isLoading } = useSprints(projectId);
  const rows = React.useMemo(
    () =>
      sprints
        .filter(
          (sprint) =>
            sprint.status === 'COMPLETED' &&
            typeof sprint.totalTaskCount === 'number' &&
            typeof sprint.completedTaskCount === 'number'
        )
        // Oldest first, so the chart reads left to right in time.
        .sort((a, b) => a.endDate.localeCompare(b.endDate))
        .slice(-12)
        .map((sprint) => ({
          id: sprint.id,
          name: sprint.name,
          ended: sprint.completedAt ?? sprint.endDate,
          committed: sprint.totalTaskCount as number,
          completed: sprint.completedTaskCount as number,
          rolledOver:
            sprint.rolledOverTaskCount ??
            (sprint.totalTaskCount as number) - (sprint.completedTaskCount as number),
        })),
    [sprints]
  );
  const committed = rows.reduce((sum, row) => sum + row.committed, 0);
  const completed = rows.reduce((sum, row) => sum + row.completed, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sprint History</CardTitle>
        <CardDescription>
          {rows.length > 0
            ? `What each completed sprint finished and rolled over — ${completed} of ${committed} tasks over ${rows.length} ${rows.length === 1 ? 'sprint' : 'sprints'}.`
            : 'What each completed sprint finished and rolled over.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <InlineLoader />
          </div>
        ) : rows.length === 0 ? (
          <ChartEmptyState message="No sprint in this project has been completed yet" />
        ) : (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={rows}
                title="Tasks finished and rolled over by each completed sprint"
                desc={rows
                  .map((row) => `${row.name}: ${row.completed} finished, ${row.rolledOver} rolled over`)
                  .join('; ')}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={legendLabel} />
                <Bar dataKey="completed" name="Finished" stackId="sprint" fill={SERIES.completed} />
                <Bar dataKey="rolledOver" name="Rolled over" stackId="sprint" fill={SERIES.rolledOver} />
              </BarChart>
            </ResponsiveContainer>
            <ul className="divide-y text-sm">
              {rows
                .slice()
                .reverse()
                .map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-4 py-2">
                    <Link
                      href={`/sprints/${row.id}/analytics`}
                      className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">
                      {row.completed}/{row.committed} finished
                      {row.committed > 0 ? ` (${Math.round((row.completed / row.committed) * 100)}%)` : ''} ·
                      ended {formatDate(row.ended)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
