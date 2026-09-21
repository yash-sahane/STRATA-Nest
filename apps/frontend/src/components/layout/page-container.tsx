import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageWidth = 'default' | 'wide' | 'fluid';

interface PageContainerProps {
  children: ReactNode;
  /**
   * Content width. `default` centers at a comfortable reading width for most
   * CRUD pages; `wide` suits dense dashboards; `fluid` spans the whole main
   * area for boards and very wide tables.
   */
  size?: PageWidth;
  className?: string;
}

const MAX_WIDTH: Record<PageWidth, string> = {
  default: 'max-w-7xl',
  wide: 'max-w-screen-2xl',
  fluid: 'max-w-none',
};

/**
 * The single source of truth for page width + gutter. Applied once in the
 * dashboard layout so every route inherits identical horizontal centering and
 * padding — pages should no longer set their own `container`/`max-w-*`/`p-8`.
 */
export function PageContainer({ children, size = 'default', className }: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-6 lg:px-8',
        // One page-entrance animation for every route, so content doesn't
        // appear instantly on some pages and animate in on others.
        'animate-in fade-in duration-(--duration-layout)',
        // The duration utility above also sets a TRANSITION duration, and with no
        // transition-property of its own this container inherited CSS's defaults:
        // `all`, eased with plain `ease`. That was not harmless — it is what smoothly
        // widens the content while the sidebar collapses (measured: 1024 -> 1216px over
        // ~280ms, CLS 0.0000), so it is worth keeping. But the sidebar glides on
        // `cubic-bezier(0.4, 0, 0.2, 1)` and this glided on `ease`, so two halves of one
        // movement started and finished together while taking different paths between.
        // Named explicitly now, and narrowed to the property that actually moves.
        'transition-[width] ease-in-out',
        MAX_WIDTH[size],
        className
      )}
    >
      {children}
    </div>
  );
}
