'use client';

import * as React from 'react';
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
import { Link2, X, AlertTriangle, CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import type { Task } from '@/types';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface TaskDependenciesProps {
  task: Task;
  allTasks: Task[];
  onAddDependency: (taskId: string, type: 'blocks' | 'blockedBy') => Promise<void>;
  onRemoveDependency: (taskId: string, type: 'blocks' | 'blockedBy') => Promise<void>;
}

export function TaskDependencies({
  task,
  allTasks,
  onAddDependency,
  onRemoveDependency,
}: TaskDependenciesProps) {
  const router = useRouter();
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [dependencyType, setDependencyType] = React.useState<'blocks' | 'blockedBy'>('blockedBy');
  const [selectedTaskId, setSelectedTaskId] = React.useState<string>('');

  // Get blocked by tasks
  const blockedByTasks = React.useMemo(() => {
    return allTasks.filter((t) => task.blockedBy?.includes(t.id));
  }, [allTasks, task.blockedBy]);

  // Get blocks tasks
  const blocksTasks = React.useMemo(() => {
    return allTasks.filter((t) => task.blocks?.includes(t.id));
  }, [allTasks, task.blocks]);

  // Get available tasks for dependency (exclude self and existing dependencies)
  const availableTasks = React.useMemo(() => {
    const excludeIds = new Set([task.id, ...(task.blockedBy || []), ...(task.blocks || [])]);

    return allTasks.filter((t) => !excludeIds.has(t.id));
  }, [allTasks, task]);

  // Check for circular dependencies
  const wouldCreateCircular = (targetTaskId: string, type: 'blocks' | 'blockedBy'): boolean => {
    const visited = new Set<string>();

    const checkCircular = (currentId: string, checkingBlocks: boolean): boolean => {
      if (currentId === task.id) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);

      const currentTask = allTasks.find((t) => t.id === currentId);
      if (!currentTask) return false;

      const idsToCheck = checkingBlocks ? currentTask.blocks : currentTask.blockedBy;
      if (!idsToCheck) return false;

      for (const id of idsToCheck) {
        if (checkCircular(id, checkingBlocks)) return true;
      }

      return false;
    };

    return checkCircular(targetTaskId, type === 'blocks');
  };

  const handleAddDependency = async () => {
    if (!selectedTaskId) return;

    if (wouldCreateCircular(selectedTaskId, dependencyType)) {
      toast.error('Cannot add dependency', {
        description: 'This would create a circular dependency.',
      });
      return;
    }

    await onAddDependency(selectedTaskId, dependencyType);
    setSelectedTaskId('');
    setAddDialogOpen(false);
  };

  const getTaskStatusIcon = (taskStatus: string) => {
    switch (taskStatus) {
      case 'DONE':
        return <CheckCircle2 className="h-3 w-3 text-green-600" />;
      case 'IN_PROGRESS':
      case 'IN_REVIEW':
        return <Clock className="h-3 w-3 text-blue-600" />;
      default:
        return <AlertTriangle className="h-3 w-3 text-orange-600" />;
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
                <AlertTriangle className="h-4 w-4 text-orange-600" />
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
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Link2 className="mr-2 h-3 w-3" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Blocking Dependency</DialogTitle>
                  <DialogDescription>
                    Select a task that blocks this task from proceeding
                  </DialogDescription>
                </DialogHeader>
                <Command>
                  <CommandInput placeholder="Search tasks..." />
                  <CommandList>
                    <CommandEmpty>No tasks found</CommandEmpty>
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
                                {t.hierarchyId} • {t.status}
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
          {blockedByTasks.length > 0 ? (
            <div className="space-y-2">
              {blockedByTasks.map((depTask) => (
                <div
                  key={depTask.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getTaskStatusIcon(depTask.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{depTask.title}</p>
                        {depTask.projectId !== task.projectId && (
                          <Badge variant="outline" className="text-xs">
                            Cross-project
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {depTask.hierarchyId} • {depTask.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => router.push(`/tasks?taskId=${depTask.id}`)}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => onRemoveDependency(depTask.id, 'blockedBy')}
                    >
                      <X className="h-3 w-3" />
                    </Button>
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
                <Link2 className="h-4 w-4 text-blue-600" />
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
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Link2 className="mr-2 h-3 w-3" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Blocked Task</DialogTitle>
                  <DialogDescription>Select a task that this task blocks</DialogDescription>
                </DialogHeader>
                <Command>
                  <CommandInput placeholder="Search tasks..." />
                  <CommandList>
                    <CommandEmpty>No tasks found</CommandEmpty>
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
                                {t.hierarchyId} • {t.status}
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
          {blocksTasks.length > 0 ? (
            <div className="space-y-2">
              {blocksTasks.map((depTask) => (
                <div
                  key={depTask.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getTaskStatusIcon(depTask.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{depTask.title}</p>
                        {depTask.projectId !== task.projectId && (
                          <Badge variant="outline" className="text-xs">
                            Cross-project
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {depTask.hierarchyId} • {depTask.status}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => router.push(`/tasks?taskId=${depTask.id}`)}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => onRemoveDependency(depTask.id, 'blocks')}
                    >
                      <X className="h-3 w-3" />
                    </Button>
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
