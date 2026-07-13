import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <section
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        'animate-in fade-in slide-in-from-bottom-2 duration-500',
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && <Icon className="h-7 w-7 shrink-0 text-muted-foreground" />}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        </div>
        {description && (
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}
