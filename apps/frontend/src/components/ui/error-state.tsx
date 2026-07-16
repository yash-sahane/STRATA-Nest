import { AlertTriangle, RotateCcw, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  /** Retry handler — renders a "Try again" button when provided (e.g. `refetch`). */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * The counterpart to EmptyState for failed data loads. Same shape and spacing
 * as EmptyState so loading / empty / error read as one system; consumed by the
 * page-state contract when a query reports `isError`.
 */
export function ErrorState({
  icon: Icon = AlertTriangle,
  title = 'Something went wrong',
  description = "We couldn't load this content. Please try again.",
  onRetry,
  retryLabel = 'Try again',
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center',
        className
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="h-7 w-7 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
