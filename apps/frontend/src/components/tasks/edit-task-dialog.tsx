'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { syncBadInput } from '@/lib/number-field';
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
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Task, TaskStatus } from '@/types';
import { TeamMemberSelector } from '../tasks/team-member-selector';

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

/** Labels and assignee ids reach us either as an array or as a JSON string. */
const parseLabels = (labelsData: unknown): string[] => {
  if (!labelsData) return [];
  if (Array.isArray(labelsData)) return labelsData;
  if (typeof labelsData === 'string') {
    try {
      const parsed = JSON.parse(labelsData);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Estimated hours is optional, and "blank" has to survive the trip to the
// resolver as blank: z.coerce.number() turns '' (what a cleared number input
// reports) into a real 0h estimate. Normalise every flavour of "nothing was
// typed" to undefined before coercion, and keep an explicit 0 meaningful for
// anyone who really does mean a zero-hour task.
//
// NaN is deliberately NOT normalised away any more — it is the sentinel the
// Estimated Hours input stores when the browser reports validity.badInput.
// Letting it fall through to z.coerce.number() is what turns "e", "-" and
// "1e-" into a visible message instead of a silently dropped estimate.
const optionalEstimatedHours = z.preprocess(
  (value) => {
    if (value === null) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  },
  z.coerce
    .number({ invalid_type_error: 'Estimated hours must be a number' })
    .min(0, 'Estimated hours cannot be negative')
    .max(1000, 'Estimated hours cannot exceed 1000')
    .optional()
);

const taskSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  dueDate: z.date().optional(),
  // Previously unreachable from any dialog, so every task's estimate stayed 0.
  // Clearing the field must read as "no estimate", not 0 — see
  // optionalEstimatedHours above.
  estimatedHours: optionalEstimatedHours,
  epicId: z.string().optional(),
  assigneeIds: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

type TaskFormValues = z.infer<typeof taskSchema>;

interface EditTaskDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskFormValues) => Promise<void>;
  isLoading?: boolean;
  existingLabels?: string[]; // Labels from other tasks in the project
  workspaceId?: string;
  epics?: Array<{ id: string; hierarchyId: string; name: string }>; // Available epics
}

export function EditTaskDialog({
  task,
  open,
  onOpenChange,
  onSubmit,
  isLoading = false,
  existingLabels = [],
  epics = [],
  workspaceId,
}: EditTaskDialogProps) {
  const [newLabel, setNewLabel] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState('blue');
  const [showLabelInput, setShowLabelInput] = React.useState(false);

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      status: 'TODO' as TaskStatus,
      priority: 'MEDIUM',
      labels: [],
      assigneeIds: [],
    },
  });

  const labels = form.watch('labels') || [];

  const handleAddLabel = (labelToAdd: string) => {
    const currentLabels = form.getValues('labels') || [];
    if (!currentLabels.includes(labelToAdd)) {
      form.setValue('labels', [...currentLabels, labelToAdd], { shouldDirty: true });
    }
  };

  const handleCreateLabel = () => {
    if (newLabel.trim()) {
      const labelWithColor = `${selectedColor}:${newLabel.trim()}`;
      handleAddLabel(labelWithColor);
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (index: number) => {
    const currentLabels = form.getValues('labels') || [];
    const updated = currentLabels.filter((_, i) => i !== index);
    form.setValue('labels', updated, { shouldDirty: true });
  };

  // One definition of "the fields as the task actually is". Both the seeding
  // effect and closeDialog go through it so the two cannot drift apart.
  const seedFromTask = React.useCallback(
    (source: Task) => {
      form.reset({
        title: source.title,
        description: source.description || '',
        status: source.status as TaskStatus,
        priority: source.priority,
        dueDate: source.dueDate ? new Date(source.dueDate) : undefined,
        estimatedHours: source.estimatedHours ?? undefined,
        epicId: source.epicId,
        labels: parseLabels(source.labels),
        assigneeIds: parseLabels(source.assigneeIds),
      });
    },
    [form]
  );

  // The label composer is component state, not form state, so a form reset on
  // its own leaves a half-typed label name and an open composer behind.
  const resetLabelComposer = React.useCallback(() => {
    setNewLabel('');
    setSelectedColor('blue');
    setShowLabelInput(false);
  }, []);

  // Update form when task changes
  React.useEffect(() => {
    if (task) seedFromTask(task);
  }, [task, seedFromTask]);

  // Closing DISCARDS. The tasks page keeps the same `task` object selected after
  // the dialog closes, so the effect above does not re-run on the next open:
  // without this, Cancel left the abandoned edits in the fields and the next
  // Save would have written a change the user had explicitly thrown away.
  const closeDialog = React.useCallback(() => {
    if (task) seedFromTask(task);
    resetLabelComposer();
    onOpenChange(false);
  }, [task, seedFromTask, resetLabelComposer, onOpenChange]);

  const handleSubmit = async (values: TaskFormValues) => {
    try {
      await onSubmit(values);
    } catch {
      // The mutation hook already toasted; keep the dialog open with the user's
      // edits rather than re-throwing out of react-hook-form's handleSubmit.
      return;
    }
    // The saved values are the clean ones now, so only the composer is cleared.
    resetLabelComposer();
    onOpenChange(false);
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : closeDialog())}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>Update task details. Task id: {task.hierarchyId}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          {/* noValidate: the browser ran its own constraint check first and, when
              it failed, cancelled the submit with nothing but a transient native
              bubble — no request, no FormMessage, no toast, nothing left on screen.
              zod owns validation end to end here so a rejection can actually be
              rendered next to the field that caused it. */}
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4" noValidate>
            {/* Title */}
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

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add task description..."
                      className="min-h-[100px] resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                        <SelectItem value="DONE">Done</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Priority */}
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="LOW">
                          <span className="flex items-center gap-2">
                            <span className="text-green-500">●</span> Low
                          </span>
                        </SelectItem>
                        <SelectItem value="MEDIUM">
                          <span className="flex items-center gap-2">
                            <span className="text-yellow-500">●</span> Medium
                          </span>
                        </SelectItem>
                        <SelectItem value="HIGH">
                          <span className="flex items-center gap-2">
                            <span className="text-orange-500">●</span> High
                          </span>
                        </SelectItem>
                        <SelectItem value="CRITICAL">
                          <span className="flex items-center gap-2">
                            <span className="text-red-500">●</span> Critical
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Due Date */}
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

            {/* Estimated Hours */}
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
                      // Quarter hours are an ordinary estimate. With noValidate on
                      // the form the browser no longer refuses an off-step 7.25 —
                      // zod owns the bounds and this only sizes the spinner arrows.
                      step={0.25}
                      placeholder="e.g., 8"
                      {...field}
                      // NaN is the badInput sentinel set below; React has to be
                      // handed a string here or it warns and wipes the characters
                      // the user can still see in the field.
                      value={
                        typeof field.value === 'number' && Number.isNaN(field.value)
                          ? ''
                          : field.value ?? ''
                      }
                      onChange={(event) => {
                        // Chrome reports "e", "-" and "1e-" as value="" with
                        // validity.badInput set — indistinguishable from a cleared
                        // field, so a typo was filed as "no estimate" while native
                        // validation silently cancelled the submit. Store NaN and
                        // let the resolver put the reason on the field.
                        field.onChange(event.target.validity.badInput ? NaN : event.target.value);
                      }}
                      // onChange alone is not enough: React suppresses it when the
                      // value string does not change, and on an EMPTY field the
                      // first bad keystroke is "" -> "". keyup and blur always
                      // fire. See lib/number-field.ts.
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

            {/* Epic */}
            {epics.length > 0 && (
              <FormField
                control={form.control}
                name="epicId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Epic (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'none'}>
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
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Labels */}
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
                    .filter((label) => !labels.includes(label))
                    .map((label, index) => {
                      const [color, text] = label.split(':');
                      const colorConfig = LABEL_COLORS.find((c) => c.value === color);
                      return (
                        <Badge
                          key={index}
                          variant="outline"
                          className="cursor-pointer hover:bg-accent"
                          onClick={() => handleAddLabel(label)}
                        >
                          <div
                            className={`w-2 h-2 rounded-full mr-1 ${colorConfig?.class || 'bg-gray-500'}`}
                          />
                          {text || label}
                        </Badge>
                      );
                    })}
                </div>
              )}

              {showLabelInput && (
                <div className="flex gap-2">
                  <Select value={selectedColor} onValueChange={setSelectedColor}>
                    <SelectTrigger className="w-[120px]">
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
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateLabel();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button type="button" onClick={handleCreateLabel} variant="outline">
                    Add
                  </Button>
                </div>
              )}

              {labels.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <p className="text-xs text-muted-foreground w-full">Selected labels:</p>
                  {labels.map((label, index) => {
                    const [color, text] = label.split(':');
                    const colorConfig = LABEL_COLORS.find((c) => c.value === color);
                    return (
                      <Badge
                        key={`${label}-${index}`}
                        variant="secondary"
                        className="flex items-center gap-1 pr-1"
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${colorConfig?.class || 'bg-gray-500'}`}
                        />
                        {text || label}
                        <button
                          type="button"
                          onClick={() => handleRemoveLabel(index)}
                          className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter className="justify-end">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
