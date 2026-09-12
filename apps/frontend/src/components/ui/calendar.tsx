'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * The first real date in whatever `selected` holds, whichever selection mode is
 * in play: a Date (single), the first Date of an array (multiple), or the
 * `from`/`to` edge of a range.
 */
function firstSelectedDate(selected: unknown): Date | undefined {
  if (selected instanceof Date) return selected;
  if (Array.isArray(selected)) return selected.find((d): d is Date => d instanceof Date);
  if (selected && typeof selected === 'object') {
    const { from, to } = selected as { from?: Date; to?: Date };
    if (from instanceof Date) return from;
    if (to instanceof Date) return to;
  }
  return undefined;
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  // react-day-picker picks the opening month from `month`/`defaultMonth` ONLY
  // (`getInitialMonth`: `month || defaultMonth || today`) — `selected` never
  // moves it. A field already holding December therefore opened on today's
  // month with nothing highlighted, and the cell that LOOKED selected was a
  // different day, so the obvious next click moved the value months backwards
  // without a word. Defaulting the opening month here rather than at each call
  // site is what makes every calendar in the app behave, including the three
  // that never went through DatePicker (create-sprint, create-task,
  // manual-time-entry). An explicit `month`/`defaultMonth` from the caller
  // still wins, because both are folded into the value below.
  //
  // `defaultMonth` is applied AFTER the {...props} spread below, so a caller
  // passing `defaultMonth={undefined}` (a picker whose field is empty) cannot
  // blank out the value resolved here.
  const { month, defaultMonth, selected } = props as unknown as {
    month?: Date;
    defaultMonth?: Date;
    selected?: unknown;
  };
  const openingMonth = month ?? defaultMonth ?? firstSelectedDate(selected);

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        // NOT `space-y-4`. The month box has exactly two children — caption and
        // table — and the caption carries its own `mb-1`, which wins over
        // Tailwind's zero-specificity `:where(.space-y-4 > :not(:last-child))`.
        // So the stack utility never did anything here EXCEPT hand compact mode
        // a selector to shadow: `.compact-mode .space-y-4 > :not(:last-child)`
        // is unlayered and specificity (0,3,0), so it beat `.mb-1` and GREW the
        // caption gap 4px -> 12px — compact mode making the calendar taller,
        // the exact bug class compact mode was being fixed for. Measured live.
        month: '',
        caption: 'flex justify-center pt-1 relative items-center mb-1',
        caption_label: 'text-sm font-medium',
        caption_dropdowns: 'flex justify-center gap-1',
        vhidden: 'hidden',
        dropdown: 'appearance-none px-3 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer',
        dropdown_month: 'min-w-[120px]',
        dropdown_year: 'min-w-[80px]',
        dropdown_icon: 'hidden',
        nav: 'space-x-1 flex items-center',
        nav_button: cn(
          buttonVariants({ variant: 'outline' }),
          'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100'
        ),
        nav_button_previous: 'absolute left-1',
        nav_button_next: 'absolute right-1',
        table: 'w-full border-collapse space-y-1',
        head_row: 'flex',
        head_cell: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        row: 'flex w-full mt-2',
        cell: 'h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
        day: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-9 w-9 p-0 font-normal aria-selected:opacity-100'
        ),
        day_range_start: 'day-range-start',
        day_range_end: 'day-range-end',
        day_selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        day_today: 'bg-accent text-accent-foreground',
        day_outside:
          'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
        day_disabled: 'text-muted-foreground opacity-50',
        day_range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
      defaultMonth={openingMonth}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
