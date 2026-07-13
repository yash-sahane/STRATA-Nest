import { cn } from '@/lib/utils';

/**
 * Skeleton placeholder for initial structured-content loading (LOAD-01).
 * Compose several to preview the shape of the content that is loading.
 * Honors reduced-motion (globals.css neutralizes `animate-pulse`).
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
