'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { useCreateProject } from '@/hooks/use-project';
import { useAuth } from '@/components/providers/auth-provider';
import { DatePicker } from '@/components/ui/date-picker';
import { format, startOfDay } from 'date-fns';
import { businessToday } from '@/lib/task-dates';

/**
 * Real validation, matching the rest of the dialogs.
 *
 * This form used to rely on HTML `required` plus a hand-rolled end<start check.
 * `required` only asserts non-EMPTY, and the API's `@IsNotEmpty()` treats a
 * string of spaces as non-empty too — so a whitespace-only project name passed
 * both tiers and created a project that renders as a blank row everywhere.
 * `.trim().min(1)` is what actually closes that, and it must stay a `trim()`
 * (not a `.min(1)` on the raw string) for the same reason.
 */
const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Project name is required').max(200),
    description: z.string().max(2000).optional(),
    clientName: z.string().trim().min(1, 'Client name is required').max(200),
    // Nullable, not merely optional: react-hook-form resolves a field set to
    // `undefined` back to the default captured when the control mounted, so
    // deselecting a day has to write an explicit `null` to actually clear it.
    startDate: z.date().nullish(),
    endDate: z.date().nullish(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });

type FormData = z.infer<typeof formSchema>;

interface CreateProjectDialogProps {
  workspaceId: string;
  /**
   * Optional controlled state, so something other than the built-in trigger can
   * open the dialog — the command palette's "New Project" lands on
   * /projects?action=create and the page opens it from there. Left out, the
   * dialog owns its own state exactly as before.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateProjectDialog({
  workspaceId,
  open: controlledOpen,
  onOpenChange,
}: CreateProjectDialogProps) {
  const { user } = useAuth();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const createProject = useCreateProject();

  const defaults: FormData = React.useMemo(
    () => ({
      name: '',
      description: '',
      clientName: '',
      // Midnight, not the current instant: the calendar's day cells are local
      // midnight, so an unnormalized "now" made today unselectable as an end date.
      // And the workspace's today, not the viewer's: a project starts on an
      // office day (see businessToday).
      startDate: businessToday(),
      endDate: null,
    }),
    []
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults,
  });

  // Closing without submitting must discard the draft: the dialog is not
  // unmounted, so Cancel/Escape/overlay-click used to leave the previous
  // attempt (including a stale error) sitting in the next one.
  const closeDialog = () => {
    form.reset(defaults);
    setOpen(false);
  };

  const onSubmit = async (values: FormData) => {
    if (!user) return;

    try {
      await createProject.mutateAsync({
        workspaceId,
        name: values.name.trim(),
        description: values.description?.trim() ?? '',
        clientName: values.clientName.trim(),
        // Date-only fields: an ISO instant is shifted into the previous day for
        // any UTC+ timezone before the @db.Date column truncates the time.
        startDate: values.startDate ? format(values.startDate, 'yyyy-MM-dd') : undefined,
        endDate: values.endDate ? format(values.endDate, 'yyyy-MM-dd') : undefined,
      });
    } catch {
      // error toast handled inside the mutation; keep the form as typed
      return;
    }

    form.reset(defaults);
    setOpen(false);
  };

  const startDate = useWatch({ control: form.control, name: 'startDate' });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            A project holds a client&apos;s requirements, the epics and sprints that deliver them,
            and the tasks they become. It starts in Planning and is Active once its first sprint
            starts.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="My Awesome Project" {...field} />
                    </FormControl>
                    <FormDescription>
                      A unique project code will be auto-generated from the name.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="What is this project about?"
                        rows={3}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="clientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Client or stakeholder name" {...field} />
                    </FormControl>
                    <FormDescription>
                      This will be automatically used in requirements created for this project.
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
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl>
                        <DatePicker
                          date={field.value ?? undefined}
                          onSelect={(date) => field.onChange(date ?? null)}
                          placeholder="Pick a date"
                          buttonClassName="w-full"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date (Optional)</FormLabel>
                      <FormControl>
                        <DatePicker
                          date={field.value ?? undefined}
                          onSelect={(date) => field.onChange(date ?? null)}
                          placeholder="Pick a date"
                          disabled={(date: Date) =>
                            startDate ? date < startOfDay(startDate) : false
                          }
                          buttonClassName="w-full"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={createProject.isPending}>
                {createProject.isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
