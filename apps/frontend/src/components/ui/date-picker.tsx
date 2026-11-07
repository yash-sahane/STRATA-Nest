'use client';

import * as React from 'react';
import { CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';

interface DatePickerProps {
    date?: Date;
    onSelect?: (date: Date | undefined) => void;
    disabled?: (date: Date) => boolean;
    placeholder?: string;
    className?: string;
    buttonClassName?: string;
    /** Set false where the field is required and must never be emptied. */
    allowClear?: boolean;
    /** For a <Label htmlFor>: the trigger is the control the label names. */
    id?: string;
    /**
     * The whole field switched off — a value that follows from another field,
     * like a half-day's end date. (`disabled` is the per-day matcher.)
     */
    triggerDisabled?: boolean;
    /**
     * What the field is for, when no visible <Label> names it: the trigger's
     * text is only the date, which says nothing about what the date is.
     */
    ariaLabel?: string;
}

export function DatePicker({
    date,
    onSelect,
    disabled,
    placeholder = 'Pick a date',
    className,
    buttonClassName,
    allowClear = true,
    id,
    triggerDisabled = false,
    ariaLabel,
}: DatePickerProps) {
    const [open, setOpen] = React.useState(false);

    const handleSelect = (selectedDate: Date | undefined) => {
        onSelect?.(selectedDate);
        setOpen(false); // Auto-close on selection
    };

    // The ONLY way to empty a react-day-picker single field is to click the day
    // that is already selected — undiscoverable at the best of times, and flatly
    // impossible whenever the `disabled` matcher covers that day, which is the
    // normal state of two live fields: a project End Date that predates its
    // Start Date (matcher `date < startDate`), and a task Due Date already in
    // the past (matcher `date < today`). Both left the user staring at a value
    // no interaction could remove. An explicit control is the fix, and it
    // belongs on the primitive so every caller inherits it.
    const clearable = allowClear && !!date && !!onSelect && !triggerDisabled;

    // `relative` so the clear control can sit on the trigger's right edge. Every
    // call site gives the trigger `w-full`, so the wrapper and the button share
    // that edge.
    return (
        <div className={cn('relative', className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        id={id}
                        type="button"
                        disabled={triggerDisabled}
                        // The value as the API takes it, for whoever needs to read
                        // the field without parsing its label (tests, mostly).
                        data-value={date ? format(date, 'yyyy-MM-dd') : ''}
                        aria-label={
                            ariaLabel
                                ? `${ariaLabel}: ${date ? format(date, 'MMM d, yyyy') : placeholder}`
                                : undefined
                        }
                        variant="outline"
                        className={cn(
                            'w-full justify-start text-left font-normal',
                            !date && 'text-muted-foreground',
                            clearable && 'pr-9',
                            buttonClassName
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                        {/* The app's one way of writing a date (formatDate):
                            'PPP' printed "October 18th, 2026" beside fields
                            that said "Oct 18, 2026". */}
                        <span className="truncate">{date ? format(date, 'MMM d, yyyy') : placeholder}</span>
                    </Button>
                </PopoverTrigger>
                {/* The opening month comes from `selected` inside Calendar. */}
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        mode="single"
                        selected={date}
                        onSelect={handleSelect}
                        disabled={disabled}
                        initialFocus
                    />
                </PopoverContent>
            </Popover>
            {clearable && (
                <button
                    // type="button": these pickers live inside <form>s, and a
                    // bare <button> would submit them.
                    type="button"
                    aria-label="Clear date"
                    title="Clear date"
                    onClick={() => onSelect?.(undefined)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}
