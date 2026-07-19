'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useCreateTimeEntry } from '@/hooks/use-time-entry';
import { useWorkspaceTasks } from '@/hooks/use-task';
import { useWorkspace } from '@/hooks/use-workspace';
import { parseTimeToMinutes } from '@/lib/utils/time-format';
import type { Task } from '@/types';

interface ManualTimeEntryDialogProps {
  userId: string;
  userName: string;
  userEmail: string;
  taskId?: string;
  trigger?: React.ReactNode;
}

export function ManualTimeEntryDialog({
  userId,
  userName,
  userEmail,
  taskId,
  trigger,
}: ManualTimeEntryDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [date, setDate] = useState<Date>(new Date());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [selectedTaskId, setSelectedTaskId] = useState(taskId || '');
  const [description, setDescription] = useState('');
  const [isBillable, setIsBillable] = useState(false);
  const [billableRate, setBillableRate] = useState('');
  const [tags, setTags] = useState('');

  const { data: workspace } = useWorkspace();
  const { data: tasks } = useWorkspaceTasks(workspace?.id);
  const createTimeEntryMutation = useCreateTimeEntry();

  const calculateDuration = () => {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    
    if (end <= start) {
      return 0;
    }
    
    return end - start;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!workspace) return;

    const duration = calculateDuration();
    if (duration <= 0) {
      return;
    }

    const selectedTask = tasks?.find((t: Task) => t.id === selectedTaskId);

    // Create ISO timestamps
    const dateStr = format(date, 'yyyy-MM-dd');
    const startDateTime = new Date(`${dateStr}T${startTime}:00`).toISOString();
    const endDateTime = new Date(`${dateStr}T${endTime}:00`).toISOString();

    // Parse tags
    const tagArray = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    await createTimeEntryMutation.mutateAsync({
      workspaceId: workspace.id,
      userId,
      userName,
      userEmail,
      taskId: selectedTaskId || undefined,
      taskTitle: selectedTask?.title,
      taskHierarchyId: selectedTask?.hierarchyId,
      projectId: selectedTask?.projectId,
      projectName: undefined,
      description,
      startTime: startDateTime,
      endTime: endDateTime,
      duration,
      isBillable,
      billableRate: billableRate ? parseFloat(billableRate) : undefined,
      tags: tagArray.length > 0 ? tagArray : undefined,
    });

    // Reset form
    setIsOpen(false);
    setDescription('');
    setStartTime('09:00');
    setEndTime('17:00');
    if (!taskId) {
      setSelectedTaskId('');
    }
    setIsBillable(false);
    setBillableRate('');
    setTags('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Clock className="h-4 w-4 mr-2" />
            Log Time
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Log Time Manually</DialogTitle>
            <DialogDescription>
              Record time spent on tasks manually
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Date Picker */}
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !date && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-time">End Time</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Duration Display */}
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="font-medium">Duration:</span>{' '}
              {calculateDuration()} minutes (
              {(calculateDuration() / 60).toFixed(2)} hours)
            </div>

            {/* Task Selection */}
            {!taskId && (
              <div className="space-y-2">
                <Label htmlFor="task">Task (Optional)</Label>
                <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
                  <SelectTrigger id="task">
                    <SelectValue placeholder="Select a task" />
                  </SelectTrigger>
                  <SelectContent>
                    {tasks?.map((task: Task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.hierarchyId} - {task.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you work on?"
                rows={3}
                required
              />
            </div>

            {/* Billable */}
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="billable" className="cursor-pointer">
                Billable hours
              </Label>
              <Switch
                id="billable"
                checked={isBillable}
                onCheckedChange={setIsBillable}
              />
            </div>

            {/* Billable Rate */}
            {isBillable && (
              <div className="space-y-2">
                <Label htmlFor="rate">Hourly Rate ($)</Label>
                <Input
                  id="rate"
                  type="number"
                  value={billableRate}
                  onChange={(e) => setBillableRate(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            )}

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="meeting, development, review"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={createTimeEntryMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !description.trim() ||
                calculateDuration() <= 0 ||
                createTimeEntryMutation.isPending
              }
            >
              {createTimeEntryMutation.isPending ? 'Logging...' : 'Log Time'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
