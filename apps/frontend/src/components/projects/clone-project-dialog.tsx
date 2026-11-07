'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { format } from 'date-fns';
import { Copy, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

interface CloneProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (data: CloneProjectData) => Promise<void>;
  isLoading?: boolean;
  /**
   * Whether the reader may create what each part of the copy creates — the
   * same permissions the API asks for. An option they cannot use is shown
   * switched off with the reason, rather than offered and then refused.
   */
  canCopyWork?: boolean;
  canCopySprints?: boolean;
}

export interface CloneProjectData {
  name: string;
  includeTasks: boolean;
  includeSprints: boolean;
  /**
   * The day the copy starts (`yyyy-MM-dd`), which every copied date moves with.
   * Left out, the server takes today in the workspace's timezone.
   */
  startDate?: string;
}

interface CloneOptionProps {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Why the option cannot be used, shown in place of its description. */
  unavailable?: string;
}

/**
 * One option, the whole row its label: the row highlights on hover, so the
 * row is what a click on it toggles — not only the box and the title.
 */
function CloneOption({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  unavailable,
}: CloneOptionProps) {
  const off = disabled || Boolean(unavailable);
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        off ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50'
      )}
    >
      <Checkbox
        id={id}
        checked={checked && !unavailable}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={off}
        className="mt-0.5"
      />
      <span className="flex-1 space-y-1">
        <span className="block text-sm font-medium leading-none">{title}</span>
        <span className="block text-xs text-muted-foreground">{unavailable ?? description}</span>
      </span>
    </label>
  );
}

export function CloneProjectDialog({
  project,
  open,
  onOpenChange,
  onClone,
  isLoading,
  canCopyWork = true,
  canCopySprints = true,
}: CloneProjectDialogProps) {
  const [name, setName] = React.useState('');
  const [includeTasks, setIncludeTasks] = React.useState(true);
  const [includeSprints, setIncludeSprints] = React.useState(false);
  // Unset is "today", as the server reckons it in the workspace's timezone —
  // the browser's own today could be a different day.
  const [startDate, setStartDate] = React.useState<Date | undefined>(undefined);

  // Reset the form each time it opens on a project.
  React.useEffect(() => {
    if (open && project) {
      setName(`${project.name} (Copy)`);
      setIncludeTasks(canCopyWork);
      setIncludeSprints(false);
      setStartDate(undefined);
    }
  }, [open, project, canCopyWork]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onClone({
      name: name.trim(),
      includeTasks: includeTasks && canCopyWork,
      includeSprints: includeSprints && canCopySprints,
      // The day picked, as a calendar day: a date column has no time of day.
      startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
    });
  };

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Clone Project
          </DialogTitle>
          <DialogDescription>
            Create a copy of <strong>{project.name}</strong>. Choose what to include in it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="clone-name">New Project Name</Label>
              <Input
                id="clone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                required
                maxLength={255}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clone-start">Starts On</Label>
              <DatePicker
                id="clone-start"
                date={startDate}
                onSelect={setStartDate}
                placeholder="Today"
                buttonClassName="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Every copied date moves with the start: sprints, epics and due dates keep their
                distance from it, as they had in {project.name}.
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-3 text-sm font-medium">What to Include</legend>
              <CloneOption
                id="clone-tasks"
                title="Tasks & Requirements"
                description="Every client requirement, epic, functional requirement and task — all reset to To Do"
                checked={includeTasks}
                onCheckedChange={setIncludeTasks}
                disabled={isLoading}
                unavailable={
                  canCopyWork
                    ? undefined
                    : 'Needs permission to write requirements, plan and create tasks in this workspace'
                }
              />
              {/* Not "dates will be cleared": a sprint's start and end are NOT
                  NULL, so they are copied — moved to the copy's start. */}
              <CloneOption
                id="clone-sprints"
                title="Sprints"
                description="Sprint names, goals and dates, moved to the copy's start (each starts again in Planning)"
                checked={includeSprints}
                onCheckedChange={setIncludeSprints}
                disabled={isLoading}
                unavailable={canCopySprints ? undefined : 'Needs permission to plan sprints in this workspace'}
              />
            </fieldset>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
              <p className="text-xs text-foreground">
                <strong>Note:</strong> The copy starts in Planning, and its tasks keep their
                assignees and estimates, with their due dates moved like every other date.
                Progress, logged time, comments, files and dependencies stay with the original.
                Work assigned to someone who has left the workspace is copied unassigned.
              </p>
            </div>
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
            <Button type="submit" disabled={isLoading || !name.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Clone Project
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
