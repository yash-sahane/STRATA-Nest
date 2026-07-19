'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CalendarIcon, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TaskStatus } from '@/types';
import { TeamMemberSelector } from '@/components/tasks/team-member-selector';

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

const taskSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  dueDate: z.date().optional(),
  epicId: z.string().optional(),
  functionalRequirementId: z.string().optional(), // NEW: Link to FR
  labels: z.array(z.string()).optional(),
  assignedTo: z.array(z.string()).optional(), // NEW: Array of user IDs
});

type TaskFormValues = z.infer<typeof taskSchema>;

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskFormValues) => Promise<void>;
  defaultStatus?: TaskStatus;
  isLoading?: boolean;
  existingLabels?: string[]; // Labels from other tasks in the project
  projectId?: string; // For fetching epics and FRs
  workspaceId?: string; // For team member selector
  epics?: Array<{ id: string; hierarchyId: string; name: string }>; // Available epics
  functionalRequirements?: Array<{ id: string; hierarchyId: string; title: string }>; // Available FRs
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultStatus = 'TODO',
  isLoading = false,
  existingLabels = [],
  epics = [],
  functionalRequirements = [],
  workspaceId,
}: CreateTaskDialogProps) {
  const [newLabel, setNewLabel] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState('blue');
  const [showLabelInput, setShowLabelInput] = React.useState(false);

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      status: defaultStatus,
      priority: 'MEDIUM',
      labels: [],
      assignedTo: [],
    },
  });

  const labels = form.watch('labels') || [];

  const handleAddLabel = () => {
    if (newLabel.trim()) {
      const labelWithColor = `${selectedColor}:${newLabel.trim()}`;
      form.setValue('labels', [...labels, labelWithColor]);
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (index: number) => {
    const updated = labels.filter((_, i) => i !== index);
    form.setValue('labels', updated);
  };

  const handleSubmit = async (values: TaskFormValues) => {
    await onSubmit(values);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>
            Add a new task to your project. Fill in the details below.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
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
                    <Textarea placeholder="Describe the task in detail..." rows={4} {...field} />
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            'w-full pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Functional Requirement */}
            {functionalRequirements.length > 0 && (
              <FormField
                control={form.control}
                name="functionalRequirementId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Functional Requirement (Optional)</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Epic */}
            {epics.length > 0 && (
              <FormField
                control={form.control}
                name="epicId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Epic (Optional)</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}
                      value={field.value || 'none'}
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

            {/* Assignee */}
            {workspaceId && (
              <FormField
                control={form.control}
                name="assignedTo"
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
                          onClick={() => form.setValue('labels', [...labels, label])}
                        >
                          <div
                            className={`w-2 h-2 rounded-full mr-1 ${colorConfig?.class || 'bg-gray-500'}`}
                          />
                          {text}
                        </Badge>
                      );
                    })}
                </div>
              )}

              {showLabelInput && (
                <div className="flex gap-2">
                  <Select value={selectedColor} onValueChange={setSelectedColor}>
                    <SelectTrigger className="w-30">
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
                        handleAddLabel();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button type="button" onClick={handleAddLabel} variant="outline">
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
                        key={index}
                        variant="secondary"
                        className="flex items-center gap-1 pr-1"
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${colorConfig?.class || 'bg-gray-500'}`}
                        />
                        {text}
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
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
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
