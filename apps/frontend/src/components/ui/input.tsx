import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * A bare <input type="date"> accepts years up to 275760: typing one keystroke
 * too many in the year segment produced 06/07/20265, which the browser reports
 * as a perfectly valid value and the API could not parse — the user got a red
 * toast reading only "Internal server error", with no clue which field was
 * wrong. Bounding the control at the primitive means every date field in the
 * product is bounded, including ones added later, and the browser refuses the
 * out-of-range year at the point it is typed. Call sites can still narrow it
 * (the leave form pins its own window) — an explicit min/max always wins.
 */
const DATE_MIN = '1900-01-01';
const DATE_MAX = '2200-12-31';

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, min, max, ...props }, ref) => {
    const bounded = type === 'date' || type === 'datetime-local';
    return (
      <input
        type={type}
        min={bounded ? (min ?? (type === 'date' ? DATE_MIN : `${DATE_MIN}T00:00`)) : min}
        max={bounded ? (max ?? (type === 'date' ? DATE_MAX : `${DATE_MAX}T23:59`)) : max}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
