'use client';

import { cn } from '@/lib/utils';

interface ChartEmptyStateProps {
  message?: string;
  height?: number;
  className?: string;
}

/**
 * Per-chart empty state shown in place of a chart when there is no data,
 * instead of mounting recharts with an empty array (which renders nothing).
 */
export function ChartEmptyState({
  message = 'No data to display yet',
  height = 250,
  className,
}: ChartEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground',
        className
      )}
      style={{ height }}
    >
      {message}
    </div>
  );
}
