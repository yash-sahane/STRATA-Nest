'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
}

/** Fallback name for the progressbar role, which requires one. Callers should
 *  pass a specific `aria-label` ("Epic progress", "Sprint completion"); this
 *  only stops an unnamed progressbar reaching a screen reader. */
const DEFAULT_PROGRESS_LABEL = 'Progress';

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, indicatorClassName, 'aria-label': ariaLabel, ...props }, ref) => {
    // Callers routinely compute this from a ratio, so NaN/Infinity/out-of-range
    // values reach us. Left unclamped they produce an invalid `translateX()` the
    // browser drops, which paints a full bar for what should be an empty one.
    const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value as number)) : 0;

    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
        aria-label={ariaLabel ?? (props['aria-labelledby'] ? undefined : DEFAULT_PROGRESS_LABEL)}
        value={percent}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full w-full flex-1 bg-primary transition-transform duration-(--duration-layout) ease-out',
            indicatorClassName
          )}
          style={{ transform: `translateX(-${100 - percent}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  }
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
