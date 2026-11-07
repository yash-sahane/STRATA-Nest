'use client';

import * as React from 'react';
import { getTaskStatusConfig } from '@/lib/semantic/status';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link2, X, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { Task } from '@/types';
import { useTaskSearch } from '@/hooks/use-task';

interface TaskDependenciesProps {
  task: Task;
  /** The tasks this one already names (its dependencies), fetched by id. */
  relatedTasks: Task[];
  /**
   * `relatedTasks` has answered, so an id it does not hold names a task that
   * no longer exists. Until it has, every id is merely not loaded yet.
   */
  relatedLoaded?: boolean;
  onAddDependency: (taskId: string, type: 'blocks' | 'blockedBy') => Promise<void>;
  onRemoveDependency: (taskId: string, type: 'blocks' | 'blockedBy') => Promise<void>;
  /** Adding or removing an edge PATCHes the task, so it needs the same
   *  `task:write` the API demands. Defaults to false so a caller that omits it
   *  renders the read-only view rather than a control that 403s on click. */
  canEdit?: boolean;
}

export function TaskDependencies({
  task,
  relatedTasks,
  relatedLoaded = false,
  onAddDependency,
  onRemoveDependency,
  canEdit = false,
}: TaskDependenciesProps) {
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [dependencyType, setDependencyType] = React.useState<'blocks' | 'blockedBy'>('blockedBy');
  const [selectedTaskId, setSelectedTaskId] = React.useState<string>('');
  // The picker searches the workspace as you type (the server does it); it used
  // to filter a download of every task in the workspace.
  const [term, setTerm] = React.useState('');
  const { data: found = [], isFetching: searching } = useTaskSearch(task.workspaceId, term);

  const blockedByTasks = React.useMemo(
    () => relatedTasks.filter((t) => task.blockedBy?.includes(t.id)),
    [relatedTasks, task.blockedBy]
  );
  const blocksTasks = React.useMemo(
    () => relatedTasks.filter((t) => task.blocks?.includes(t.id)),
    [relatedTasks, task.blocks]
  );

  // Ids that name no task any more: a dependency on a task deleted before
  // deleting cleaned up after itself. The lists above are built from the tasks
  // that WERE found, so these used to be invisible here — while the card still
  // counted them — and so could never be removed. Shown, and removable.
  const goneIds = (ids: string[] | undefined) =>
    relatedLoaded ? (ids ?? []).filter((id) => !relatedTasks.some((t) => t.id === id)) : [];
  const goneBlockedBy = goneIds(task.blockedBy);
  const goneBlocks = goneIds(task.blocks);

  // Not itself, and not a task it already names. A cycle is the server's to
  // refuse (tasks.services.ts assertNoCycle walks the whole graph, under a
  // lock); the toast says so.
  const availableTasks = React.useMemo(() => {
    const excludeIds = new Set([task.id, ...(task.blockedBy || []), ...(task.blocks || [])]);
    return found.filter((t) => !excludeIds.has(t.id));
  }, [found, task]);

  const handleAddDependency = async () => {
    if (!selectedTaskId) return;

    try {
      await onAddDependency(selectedTaskId, dependencyType);
    } catch {
      // The mutation's own onError already surfaced the reason (a rejected
      // cycle, a cross-workspace edge, a permission failure). Swallow the
      // rejection so it is not unhandled, and leave the dialog open with the
      // selection intact so another target can be picked.
      return;
    }
    setSelectedTaskId('');
    setAddDialogOpen(false);
  };

  /** Same reasoning: the remove buttons fire-and-forget, so catch here too. */
  const handleRemoveDependency = (targetTaskId: string, type: 'blocks' | 'blockedBy') => {
    void onRemoveDependency(targetTaskId, type).catch(() => undefined);
  };

  /** A link to a task that is gone: nothing to show but that, and a way to remove it. */
  const goneRow = (id: string, type: 'blocks' | 'blockedBy') => (
    <div
      key={id}
      className="flex items-center justify-between p-3 rounded-lg border border-dashed bg-card"
    >
      <p className="text-sm text-muted-foreground">A task that has since been deleted</p>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Remove the link to a deleted task"
          className="h-7 w-7 text-destructive-text"
          onClick={() => handleRemoveDependency(id, type)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );

  const getTaskStatusIcon = (taskStatus: string) => {
    switch (taskStatus) {
      case 'DONE':
        return <CheckCircle2 className="h-3 w-3 text-success-text" />;
      case 'IN_PROGRESS':
      case 'IN_REVIEW':
        return <Clock className="h-3 w-3 text-info-text" />;
      default:
        return <AlertTriangle className="h-3 w-3 text-warning-text" />;
    }
  };

  const isBlocked = blockedByTasks.some((t) => t.status !== 'DONE');

  return (
    <div className="space-y-4">
      {/* Blocked By Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-text" />
                Blocked By
                {isBlocked && (
                  <Badge variant="destructive" className="ml-2">
                    {blockedByTasks.filter((t) => t.status !== 'DONE').length} active
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Tasks that must be completed before this task can proceed
              </CardDescription>
            </div>
            <Dialog
              open={addDialogOpen && dependencyType === 'blockedBy'}
              onOpenChange={(open) => {
                if (open) setDependencyType('blockedBy');
                setAddDialogOpen(open);
              }}
            >
              {canEdit && (
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Link2 className="mr-2 h-3 w-3" />
                    Add
                  </Button>
                </DialogTrigger>
              )}
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Blocking Dependency</DialogTitle>
                  <DialogDescription>
                    Select a task that blocks this task from proceeding
                  </DialogDescription>
                </DialogHeader>
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search tasks by title or id..."
                    value={term}
                    onValueChange={setTerm}
                  />
                  <CommandList>
                    <CommandEmpty>{searching ? 'Searching…' : 'No tasks found'}</CommandEmpty>
                    <CommandGroup>
                      {availableTasks.map((t) => (
                        <CommandItem
                          key={t.id}
                          onSelect={() => setSelectedTaskId(t.id)}
                          className="cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            {getTaskStatusIcon(t.status)}
                            <div className="flex-1">
                              <div className="font-medium">{t.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {t.hierarchyId} • {getTaskStatusConfig(t.status).label}
                              </div>
                            </div>
                            {selectedTaskId === t.id && (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddDependency} disabled={!selectedTaskId}>
                    Add Dependency
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {blockedByTasks.length > 0 || goneBlockedBy.length > 0 ? (
            <div className="space-y-2">
              {goneBlockedBy.map((id) => goneRow(id, 'blockedBy'))}
              {blockedByTasks.map((depTask) => (
                <div
                  key={depTask.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getTaskStatusIcon(depTask.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/tasks?projectId=${depTask.projectId}&taskId=${depTask.id}`}
                          className="font-medium text-sm truncate underline-offset-4 hover:underline"
                        >
                          {depTask.title}
                        </Link>
                        {depTask.projectId !== task.projectId && (
                          <Badge variant="outline" className="text-xs">
                            Cross-project
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {depTask.hierarchyId} • {getTaskStatusConfig(depTask.status).label}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove the dependency on ${depTask.hierarchyId}`}
                        className="h-7 w-7 text-destructive-text"
                        onClick={() => handleRemoveDependency(depTask.id, 'blockedBy')}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No blocking dependencies
            </p>
          )}
        </CardContent>
      </Card>

      {/* Blocks Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4 text-info-text" />
                Blocks
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Tasks that are waiting for this task to be completed
              </CardDescription>
            </div>
            <Dialog
              open={addDialogOpen && dependencyType === 'blocks'}
              onOpenChange={(open) => {
                if (open) setDependencyType('blocks');
                setAddDialogOpen(open);
              }}
            >
              {canEdit && (
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Link2 className="mr-2 h-3 w-3" />
                    Add
                  </Button>
                </DialogTrigger>
              )}
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Blocked Task</DialogTitle>
                  <DialogDescription>Select a task that this task blocks</DialogDescription>
                </DialogHeader>
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search tasks by title or id..."
                    value={term}
                    onValueChange={setTerm}
                  />
                  <CommandList>
                    <CommandEmpty>{searching ? 'Searching…' : 'No tasks found'}</CommandEmpty>
                    <CommandGroup>
                      {availableTasks.map((t) => (
                        <CommandItem
                          key={t.id}
                          onSelect={() => setSelectedTaskId(t.id)}
                          className="cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            {getTaskStatusIcon(t.status)}
                            <div className="flex-1">
                              <div className="font-medium">{t.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {t.hierarchyId} • {getTaskStatusConfig(t.status).label}
                              </div>
                            </div>
                            {selectedTaskId === t.id && (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddDependency} disabled={!selectedTaskId}>
                    Add Dependency
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {blocksTasks.length > 0 || goneBlocks.length > 0 ? (
            <div className="space-y-2">
              {goneBlocks.map((id) => goneRow(id, 'blocks'))}
              {blocksTasks.map((depTask) => (
                <div
                  key={depTask.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getTaskStatusIcon(depTask.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/tasks?projectId=${depTask.projectId}&taskId=${depTask.id}`}
                          className="font-medium text-sm truncate underline-offset-4 hover:underline"
                        >
                          {depTask.title}
                        </Link>
                        {depTask.projectId !== task.projectId && (
                          <Badge variant="outline" className="text-xs">
                            Cross-project
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {depTask.hierarchyId} • {getTaskStatusConfig(depTask.status).label}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Stop ${depTask.hierarchyId} being blocked by this task`}
                        className="h-7 w-7 text-destructive-text"
                        onClick={() => handleRemoveDependency(depTask.id, 'blocks')}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Not blocking any tasks</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
