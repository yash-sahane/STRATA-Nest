'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { TeamMemberSelector } from '@/components/tasks/team-member-selector';
import { cn } from '@/lib/utils';
import { syncBadInput } from '@/lib/number-field';
import { getPriorityConfig, type Priority } from '@/lib/semantic/priority';
import { getSprintStatusConfig } from '@/lib/semantic/status';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import type { Task, TaskStatus } from '@/types';
import { isLabel, labelText, parseLabel } from '@/components/tasks/task-display';

/**
 * One form for a task, new or existing.
 *
 * Creating and editing used to be two dialogs that had drifted apart: the new
 * one had no sprint picker, offered every status and planning field to anybody,
 * re-added a label already on the task, and kept its selects uncontrolled (a
 * reset left them showing the old value); the edit one parsed labels that might
 * be JSON strings. Both now render this, and the differences between a new task
 * and an existing one are spelled out below rather than copied.
 */

/** Most-urgent-last, matching the order these pickers have always shown. */
const PRIORITY_OPTIONS: readonly Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const LABEL_COLORS = [
  { name: 'Red', value: 'red', class: 'bg-red-500' },
  { name: 'Orange', value: 'orange', class: 'bg-orange-500' },
  { name: 'Yellow', value: 'yellow', class: 'bg-yellow-500' },
  { name: 'Green', value: 'green', class: 'bg-green-500' },
  { name: 'Blue', value: 'blue', class: 'bg-blue-500' },
  { name: 'Purple', value: 'purple', class: 'bg-purple-500' },
  { name: 'Pink', value: 'pink', class: 'bg-pink-500' },
  { name: 'Gray', value: 'gray', class: 'bg-gray-500' },
];

/** A label is "colour:text"; two labels are the same label when their text is. */
const sameLabel = (a: string, b: string): boolean =>
  labelText(a).trim().toLowerCase() === labelText(b).trim().toLowerCase();

/** The dot colour class for a label's colour. */
const dotClassFor = (label: unknown): string =>
  LABEL_COLORS.find((c) => c.value === parseLabel(label).color)?.class || 'bg-gray-500';

// Estimated hours is optional, and "blank" has to survive the trip to the
// resolver as blank: z.coerce.number() turns '' (what a cleared number input
// reports) into a real 0h estimate. Normalise every flavour of "nothing was
// typed" to undefined before coercion, and keep an explicit 0 meaningful.
//
// NaN is NOT normalised away — it is the sentinel the Estimated Hours input
// stores when the browser reports validity.badInput, which is what turns "e",
// "-" and "1e-" into a visible message instead of a silently dropped estimate.
//
// The parameter type is what the form can hold here (see TaskFormInput): zod 4
// takes a preprocess step's input type from it.
const optionalEstimatedHours = z.preprocess(
  (value: string | number | null | undefined) => {
    if (value === null) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  },
  z.coerce
    .number({ error: 'Estimated hours must be a number' })
    .min(0, 'Estimated hours cannot be negative')
    .max(1000, 'Estimated hours cannot exceed 1000')
    .optional()
);

const taskSchema = z.object({
  // Trimmed before it is measured and before it is sent: "   ab " was three
  // characters to the check and a blank-looking title on the board.
  title: z.string().trim().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  dueDate: z.date().optional(),
  estimatedHours: optionalEstimatedHours,
  epicId: z.string().optional(),
  functionalRequirementId: z.string().optional(),
  sprintId: z.string().optional(),
  assigneeIds: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;

/**
 * What the form holds while it is filled in, as opposed to what it submits.
 * The estimate is whatever the number input last reported — the typed string,
 * NaN for input the browser could not read, or a number seeded from the task —
 * and becomes a number (or nothing) only when the resolver runs. zod 4's
 * resolver types keep the two apart; this was always the runtime truth, which
 * the single `TaskFormValues` type papered over.
 */
type TaskFormInput = z.input<typeof taskSchema>;

const EMPTY: TaskFormValues = {
  title: '',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  functionalRequirementId: '',
  epicId: '',
  sprintId: '',
  labels: [],
  assigneeIds: [],
};

function valuesOf(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description || '',
    status: task.status as TaskStatus,
    priority: task.priority,
    dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
    estimatedHours: task.estimatedHours ?? undefined,
    epicId: task.epicId || '',
    functionalRequirementId: task.functionalRequirementId || '',
    sprintId: task.sprintId || '',
    // Only the labels that are labels. A stored value that is not a string
    // (from before the API checked them) cannot be saved back — the API now
    // refuses the whole edit for it — so it is left out of the form, and the
    // next save drops it from the row.
    labels: (task.labels ?? []).filter(isLabel),
    assigneeIds: task.assigneeIds ?? [],
  };
}

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task to edit. Left out, the dialog creates one. */
  task?: Task | null;
  onSubmit: (values: TaskFormValues) => Promise<void>;
  isLoading?: boolean;
  /** Labels already used in the project, to pick from. */
  existingLabels?: string[];
  workspaceId?: string;
  epics?: Array<{ id: string; hierarchyId: string; name: string }>;
  functionalRequirements?: Array<{ id: string; hierarchyId: string; title: string }>;
  /** The project's sprints, for a task planned on its own (under no requirement). */
  sprints?: Array<{ id: string; name: string; status: string }>;
  /** The functional requirement a new task is added to, when it is added from one. */
  defaultFunctionalRequirementId?: string;
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task = null,
  onSubmit,
  isLoading = false,
  existingLabels = [],
  workspaceId,
  epics = [],
  functionalRequirements = [],
  sprints = [],
  defaultFunctionalRequirementId = '',
}: TaskFormDialogProps) {
  const editing = task !== null;
  // What this person may do, asked the way the server asks it. Done is a
  // manager's sign-off, from Review; reopening a finished task is too. Putting
  // a task under a requirement, an epic or a sprint is planning.
  const canComplete = useHasPermission(Permission.COMPLETE_TASK);
  const canPlan = useHasPermission(Permission.EDIT_SPRINT);
  const finished = task?.status === 'DONE';
  const statusLocked = finished && !canComplete;

  const [newLabel, setNewLabel] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState('blue');
  const [showLabelInput, setShowLabelInput] = React.useState(false);

  // The names the task keeps beside its assignee ids, so the picker can name
  // somebody who has since left the workspace (and so is in no member list).
  const assigneeNames = React.useMemo(() => {
    const names: Record<string, string> = {};
    (task?.assigneeIds ?? []).forEach((id, i) => {
      const name = task?.assigneeNames?.[i];
      if (name) names[id] = name;
    });
    return names;
  }, [task]);

  const startingValues = React.useCallback(
    (): TaskFormValues =>
      task
        ? valuesOf(task)
        : { ...EMPTY, functionalRequirementId: defaultFunctionalRequirementId },
    [task, defaultFunctionalRequirementId]
  );

  const form = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: startingValues(),
  });
  const labels = useWatch({ control: form.control, name: 'labels' }) ?? [];
  const underRequirement = Boolean(
    useWatch({ control: form.control, name: 'functionalRequirementId' })
  );

  const resetLabelComposer = React.useCallback(() => {
    setNewLabel('');
    setSelectedColor('blue');
    setShowLabelInput(false);
  }, []);

  // Seeded when the dialog opens, and when it is handed a different task. The
  // page passes the task as it was when the dialog opened, so a background
  // refetch does not reach here and cannot wipe an edit in progress.
  React.useEffect(() => {
    if (!open) return;
    form.reset(startingValues());
    resetLabelComposer();
  }, [open, task?.id, startingValues, form, resetLabelComposer]);

  // Closing DISCARDS: Cancel, Escape, the X and an outside click all come
  // through here, and the next open starts from the record again.
  const closeDialog = React.useCallback(() => {
    form.reset(startingValues());
    resetLabelComposer();
    onOpenChange(false);
  }, [form, startingValues, resetLabelComposer, onOpenChange]);

  const addLabel = (label: string) => {
    const current = form.getValues('labels') || [];
    // Once per task, whatever its colour: "blue:API" beside "red:API" read as
    // the same label twice.
    if (current.some((held) => sameLabel(held, label))) return;
    form.setValue('labels', [...current, label], { shouldDirty: true });
  };

  const createLabel = () => {
    const text = newLabel.trim();
    if (!text) return;
    // An existing label of that name is reused, so the project keeps one colour for it.
    const existing = existingLabels.find((label) => sameLabel(label, text));
    addLabel(existing ?? `${selectedColor}:${text}`);
    setNewLabel('');
  };

  const removeLabel = (index: number) => {
    const current = form.getValues('labels') || [];
    form.setValue(
      'labels',
      current.filter((_, i) => i !== index),
      { shouldDirty: true }
    );
  };

  const handleSubmit = async (values: TaskFormValues) => {
    try {
      await onSubmit(values);
    } catch {
      // The mutation hook already toasted; keep the dialog open with the input
      // rather than letting react-hook-form re-throw into an unhandled rejection.
      return;
    }
    resetLabelComposer();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Task' : 'Create Task'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Update task details. Task id: ${task?.hierarchyId}`
              : 'Add a new task to your project. Fill in the details below.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          {/* noValidate: zod owns validation end to end, so a rejection is
              rendered next to the field that caused it instead of as a
              transient native bubble that cancelled the submit. */}
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Implement user authentication" {...field} />
                  </FormControl>
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
                      placeholder="Describe the task in detail..."
                      className="min-h-[100px] resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    {/* `value`, not `defaultValue`: an uncontrolled select kept
                        showing the old status after the form was reset. */}
                    <Select onValueChange={field.onChange} value={field.value} disabled={statusLocked}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="BACKLOG">Backlog</SelectItem>
                        <SelectItem value="TODO">To Do</SelectItem>
                        <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                        <SelectItem value="REVIEW">Review</SelectItem>
                        {/* Done only where the server takes it: on an existing
                            task, from Review, by somebody who signs work off. A
                            new task cannot start out finished. */}
                        {editing && (
                          <SelectItem
                            value="DONE"
                            disabled={!canComplete || (task?.status !== 'REVIEW' && !finished)}
                          >
                            Done
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {editing &&
                      (statusLocked ? (
                        <FormDescription>A manager reopens a finished task.</FormDescription>
                      ) : !canComplete ? (
                        <FormDescription>Done is a manager&apos;s sign-off, from Review.</FormDescription>
                      ) : task?.status !== 'REVIEW' && !finished ? (
                        <FormDescription>A task is marked done from Review.</FormDescription>
                      ) : null)}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* Dots and labels from lib/semantic/priority.ts, the same
                            resolver that paints the badge the task wears. */}
                        {PRIORITY_OPTIONS.map((value) => {
                          const priority = getPriorityConfig(value);
                          return (
                            <SelectItem key={value} value={value}>
                              <span className="flex items-center gap-2">
                                <span className={cn('h-2 w-2 rounded-full', priority.dot)} />
                                {priority.label}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Due Date</FormLabel>
                  <DatePicker
                    date={field.value}
                    onSelect={field.onChange}
                    placeholder="Pick a date"
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    buttonClassName="w-full"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="estimatedHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated Hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      // Quarter hours are an ordinary estimate; zod owns the bounds
                      // and this only sizes the spinner arrows.
                      step={0.25}
                      placeholder="e.g., 8"
                      {...field}
                      // NaN is the badInput sentinel set below; React has to be
                      // handed a string or it wipes what the user can still see.
                      value={
                        typeof field.value === 'number' && Number.isNaN(field.value)
                          ? ''
                          : field.value ?? ''
                      }
                      onChange={(event) => {
                        // "e", "-" and "1e-" arrive as value="" with badInput set:
                        // store NaN and let the resolver put the reason on the field.
                        field.onChange(event.target.validity.badInput ? NaN : event.target.value);
                      }}
                      // onChange is suppressed when the value string does not
                      // change; keyup and blur always fire. See lib/number-field.ts.
                      onKeyUp={syncBadInput(field)}
                      onBlur={(event) => {
                        syncBadInput(field)(event);
                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Where the task hangs: a requirement — whose epic and sprint it
                then follows — or, under none, an epic and a sprint of its own. */}
            {functionalRequirements.length > 0 && (
              <FormField
                control={form.control}
                name="functionalRequirementId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Functional Requirement</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
                      // Filing a NEW task under a requirement is part of adding
                      // it; moving an existing one is planning.
                      disabled={editing && !canPlan}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select functional requirement" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No functional requirement</SelectItem>
                        {functionalRequirements.map((fr) => (
                          <SelectItem key={fr.id} value={fr.id}>
                            {fr.hierarchyId} - {fr.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {editing && !canPlan ? (
                      <FormDescription>
                        Moving a task under another requirement is part of planning.
                      </FormDescription>
                    ) : field.value && field.value !== (task?.functionalRequirementId || '') ? (
                      <FormDescription>
                        The task joins this requirement&apos;s epic, and its sprint if it is in one.
                      </FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {epics.length > 0 && !underRequirement && (
              <FormField
                control={form.control}
                name="epicId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Epic (Optional)</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
                      disabled={editing && !canPlan}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select epic" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No epic</SelectItem>
                        {epics.map((epic) => (
                          <SelectItem key={epic.id} value={epic.id}>
                            {epic.hierarchyId} - {epic.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {!underRequirement ? (
              <FormField
                control={form.control}
                name="sprintId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sprint</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
                      // Putting work into a sprint is planning, new task or not:
                      // the server asks the same of both.
                      disabled={!canPlan}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Not in a sprint" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Not in a sprint</SelectItem>
                        {sprints
                          .filter((sprint) => sprint.status !== 'COMPLETED' || sprint.id === field.value)
                          .map((sprint) => (
                            <SelectItem
                              key={sprint.id}
                              value={sprint.id}
                              disabled={sprint.status === 'COMPLETED'}
                            >
                              {sprint.name} · {getSprintStatusConfig(sprint.status).label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {!canPlan && (
                      <FormDescription>
                        Planning work into sprints is for whoever plans the sprints.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Its sprint is its requirement&apos;s: the task moves when the requirement is planned.
              </p>
            )}

            {workspaceId && (
              <FormField
                control={form.control}
                name="assigneeIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign To</FormLabel>
                    <FormControl>
                      <TeamMemberSelector
                        workspaceId={workspaceId}
                        value={field.value || []}
                        onChange={field.onChange}
                        placeholder="Select team members to assign..."
                        multiSelect={true}
                        knownNames={assigneeNames}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Labels</FormLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLabelInput(!showLabelInput)}
                >
                  {showLabelInput ? 'Select Existing' : '+ Create New'}
                </Button>
              </div>

              {!showLabelInput && existingLabels.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {existingLabels
                    .filter(isLabel)
                    .filter((label) => !labels.some((held) => sameLabel(held, label)))
                    .map((label) => (
                      <button
                        type="button"
                        key={label}
                        aria-label={`Add label ${labelText(label)}`}
                        className={cn(badgeVariants({ variant: 'outline' }), 'hover:bg-accent')}
                        onClick={() => addLabel(label)}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-2 h-2 rounded-full mr-1 ${dotClassFor(label)}`}
                        />
                        {labelText(label)}
                      </button>
                    ))}
                </div>
              )}

              {showLabelInput && (
                <div className="flex gap-2">
                  <Select value={selectedColor} onValueChange={setSelectedColor}>
                    <SelectTrigger className="w-[120px]" aria-label="Label colour">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LABEL_COLORS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${color.class}`} />
                            {color.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Label name"
                    aria-label="Label name"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        createLabel();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button type="button" onClick={createLabel} variant="outline">
                    Add
                  </Button>
                </div>
              )}

              {labels.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <p className="text-xs text-muted-foreground w-full">Selected labels:</p>
                  {labels.map((label, index) => {
                    return (
                      <Badge
                        key={`${label}-${index}`}
                        variant="secondary"
                        className="flex items-center gap-1 pr-1 whitespace-normal"
                      >
                        <div className={`w-2 h-2 rounded-full ${dotClassFor(label)}`} />
                        {labelText(label)}
                        <button
                          type="button"
                          onClick={() => removeLabel(index)}
                          aria-label={`Remove label ${labelText(label)}`}
                          className="-my-1 -mr-1 ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {editing ? 'Saving...' : 'Creating...'}
                  </>
                ) : editing ? (
                  'Save Changes'
                ) : (
                  'Create Task'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
