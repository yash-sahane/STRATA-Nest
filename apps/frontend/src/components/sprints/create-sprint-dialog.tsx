'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, startOfDay } from 'date-fns';
import { businessToday } from '@/lib/task-dates';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  name: z.string().min(3, 'Sprint name must be at least 3 characters'),
  goal: z.string().optional(),
  // zod 4 has one `error` for every way a value can fail. A date picker can only
  // fail by being empty, so "required" is the right sentence for all of them.
  startDate: z.date({ error: 'Start date is required' }),
  endDate: z.date({ error: 'End date is required' }),
}).refine(
  // >=, not >: a one-day sprint (start === end) is legitimate.
  (data) => data.endDate >= data.startDate,
  {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  }
);

type FormData = z.infer<typeof formSchema>;

interface CreateSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    goal?: string;
    startDate: string;
    endDate: string;
  }) => void | Promise<void>;
  isLoading?: boolean;
  /** A completed sprint: its goal and dates are its record, and only its name changes. */
  recordLocked?: boolean;
  initialData?: {
    name: string;
    goal?: string;
    startDate: Date;
    endDate: Date;
  };
}

export function CreateSprintDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  initialData,
  recordLocked = false,
}: CreateSprintDialogProps) {
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData || {
      name: '',
      goal: '',
    },
  });

  // Update form when initialData changes. Callers must pass a STABLE reference
  // (memoize it) or this resets the form on every parent render.
  React.useEffect(() => {
    if (initialData) {
      form.reset(initialData);
    }
  }, [initialData, form]);

  /**
   * Today, for the "this sprint has already started" hint below — NOT a floor on
   * what can be chosen.
   *
   * This used to disable every day before today for a new sprint, so a team
   * recording a sprint that began last Monday could not enter its real start
   * date. The server checks ordering only, so the client was refusing what the
   * API accepts. A past start is a normal thing to record; it is pointed out
   * rather than forbidden.
   */
  // The workspace's day: sprint dates are office days, so "already started" is
  // judged on the office calendar rather than the viewer's.
  const today = React.useMemo(() => businessToday(), []);

  const handleSubmit = async (data: FormData) => {
    try {
      await onSubmit({
        name: data.name,
        goal: data.goal,
        // Calendar cells are LOCAL midnight; toISOString() would shift them into
        // the previous UTC day for any zone ahead of UTC and the sprint would be
        // stored (and redisplayed) one day early. Send the calendar day itself.
        startDate: format(data.startDate, 'yyyy-MM-dd'),
        endDate: format(data.endDate, 'yyyy-MM-dd'),
      });
      // Only clear once the write succeeded — resetting eagerly wipes the user's
      // input while the dialog stays open on a rejected save.
      form.reset();
    } catch {
      // The mutation hook already surfaced the error; keep the entered values.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{initialData ? 'Edit Sprint' : 'Create Sprint'}</DialogTitle>
          <DialogDescription>
            {recordLocked
              ? "This sprint is complete: its goal and dates are its record. Only its name can change."
              : 'Plan your sprint with clear goals and timelines'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sprint Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Sprint 1, Q1 Sprint" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="goal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sprint Goal</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What do you want to achieve in this sprint?"
                      rows={3}
                      disabled={recordLocked}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A clear, concise goal that the team will work towards
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Start Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            disabled={recordLocked}
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? (
                              format(field.value, 'MMM d, yyyy')
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          // No lower bound: a sprint may legitimately have
                          // started before today, and the server accepts it.
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    {/* A past start is allowed — recording a sprint that has
                        already begun is normal — so it is pointed out rather than
                        blocked. The picker used to disable every earlier day, which
                        made an already-running sprint impossible to enter. */}
                    {field.value && startOfDay(field.value) < today && (
                      <p className="text-xs text-muted-foreground">
                        This sprint will be recorded as already started.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>End Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            disabled={recordLocked}
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? (
                              format(field.value, 'MMM d, yyyy')
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => {
                            const startDate = form.getValues('startDate');
                            // `<`, not `<=`: the sprint may end on its start day.
                            // With no start chosen there is nothing to order
                            // against, so nothing is disabled — it used to fall
                            // back to "not before today", which silently
                            // reintroduced the floor this dialog just dropped.
                            return startDate ? date < startDate : false;
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {initialData ? 'Update Sprint' : 'Create Sprint'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
