import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// `whitespace-nowrap`: a badge is one short label, and the app-wide
// `overflow-wrap: anywhere` (globals.css) let a squeezed one fold mid-word —
// "In / Progre / ss" in three lines on the requirements table. A badge that
// carries user-entered text (a task label, a timesheet tag) opts back into
// wrapping with `whitespace-normal`.
const badgeVariants = cva(
  'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        // No hover colours: a badge is a label, and one that changed under the
        // mouse said "click me" on every status in the app. Where a badge-shaped
        // thing IS clickable, it is a <button> styled with badgeVariants.
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        info: 'border-transparent bg-info text-info-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
