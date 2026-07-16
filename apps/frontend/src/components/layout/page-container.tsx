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
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8', MAX_WIDTH[size], className)}>
      {children}
    </div>
  );
}
