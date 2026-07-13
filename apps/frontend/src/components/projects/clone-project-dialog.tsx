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
import { Copy, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { Project } from '@/types';

interface CloneProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (data: CloneProjectData) => Promise<void>;
  isLoading?: boolean;
}

export interface CloneProjectData {
  name: string;
  includeSettings: boolean;
  includeTasks: boolean;
  includeMembers: boolean;
  includeSprints: boolean;
}

export function CloneProjectDialog({
  project,
  open,
  onOpenChange,
  onClone,
  isLoading,
}: CloneProjectDialogProps) {
  const [name, setName] = React.useState('');
  const [includeSettings, setIncludeSettings] = React.useState(true);
  const [includeTasks, setIncludeTasks] = React.useState(true);
  const [includeMembers, setIncludeMembers] = React.useState(false);
  const [includeSprints, setIncludeSprints] = React.useState(false);

  // Reset form when dialog opens with new project
  React.useEffect(() => {
    if (open && project) {
      setName(`${project.name} (Copy)`);
      setIncludeSettings(true);
      setIncludeTasks(true);
      setIncludeMembers(false);
      setIncludeSprints(false);
    }
  }, [open, project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    await onClone({
      name: name.trim(),
      includeSettings,
      includeTasks,
      includeMembers,
      includeSprints,
    });

    // Reset form
    setName('');
    setIncludeSettings(true);
    setIncludeTasks(true);
    setIncludeMembers(false);
    setIncludeSprints(false);
  };

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Clone Project
          </DialogTitle>
          <DialogDescription>
            Create a duplicate of <strong>{project.name}</strong>. Choose what to include in the clone.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6 py-4">
            {/* Project Name */}
            <div className="space-y-2">
              <Label htmlFor="name">New Project Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                required
                disabled={isLoading}
              />
            </div>

            {/* Clone Options */}
            <div className="space-y-4">
              <Label>What to Include</Label>

              <div className="space-y-3">
                {/* Settings */}
                <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id="settings"
                    checked={includeSettings}
                    onCheckedChange={(checked) => setIncludeSettings(checked as boolean)}
                    disabled={isLoading}
                  />
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor="settings"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Project Settings
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Time tracking, custom fields, and other project configurations
                    </p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </div>

                {/* Tasks */}
                <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id="tasks"
                    checked={includeTasks}
                    onCheckedChange={(checked) => setIncludeTasks(checked as boolean)}
                    disabled={isLoading}
                  />
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor="tasks"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Tasks & Requirements
                    </label>
                    <p className="text-xs text-muted-foreground">
                      All tasks, epics, and requirements (will be reset to TODO status)
                    </p>
                  </div>
                  {includeTasks ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Members */}
                <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id="members"
                    checked={includeMembers}
                    onCheckedChange={(checked) => setIncludeMembers(checked as boolean)}
                    disabled={isLoading}
                  />
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor="members"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Team Members
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Copy all team members to the new project
                    </p>
                  </div>
                  {includeMembers ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* Sprints */}
                <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id="sprints"
                    checked={includeSprints}
                    onCheckedChange={(checked) => setIncludeSprints(checked as boolean)}
                    disabled={isLoading}
                  />
                  <div className="flex-1 space-y-1">
                    <label
                      htmlFor="sprints"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Sprints
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Clone sprint structure (dates will be cleared)
                    </p>
                  </div>
                  {includeSprints ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>

            {/* Warning Message */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-800 dark:text-blue-200">
                <strong>Note:</strong> The cloned project will start fresh with PLANNING status. 
                All task assignments and dates will be preserved, but progress will not be copied.
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
