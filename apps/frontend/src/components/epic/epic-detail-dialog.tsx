'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Trash2, Calendar, CheckCircle2, FileText } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useDeleteEpic } from '@/hooks/use-epic';
import { useFunctionalRequirementsByEpic } from '@/hooks/use-functional-requirement';
import type { Epic, Task } from '@/types';

interface EpicDetailDialogProps {
  epic: Epic;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tasks: Task[];
  canDelete?: boolean; // Permission to delete epics (managers/assistant managers)
}

export function EpicDetailDialog({
  epic,
  open,
  onOpenChange,
  projectId,
  tasks,
  canDelete = false,
}: EpicDetailDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const deleteEpic = useDeleteEpic();

  // ✅ Load FRs linked to this epic
  const { data: linkedFRs = [] } = useFunctionalRequirementsByEpic(epic.id);

  // ✅ Calculate metrics from FRs (primary) and tasks (secondary)
  const metrics = React.useMemo(() => {
    // If we have FRs, calculate from them
    if (linkedFRs.length > 0) {
      const completedFRs = linkedFRs.filter(
        (fr) => fr.status === 'DEPLOYED' || fr.status === 'TESTED'
      ).length;
      const inProgressFRs = linkedFRs.filter(
        (fr) => fr.status === 'APPROVED' || fr.status === 'IMPLEMENTED' || fr.status === 'REVIEW'
      ).length;
      const progress =
        linkedFRs.length > 0 ? Math.round((completedFRs / linkedFRs.length) * 100) : 0;

      // Calculate auto status
      let autoStatus: Epic['status'] = 'TODO';
      if (completedFRs === linkedFRs.length && linkedFRs.length > 0) {
        autoStatus = 'DONE';
      } else if (inProgressFRs > 0 || completedFRs > 0) {
        autoStatus = 'IN_PROGRESS';
      }

      return {
        totalFRs: linkedFRs.length,
        completedFRs,
        inProgressFRs,
        progress,
        autoStatus,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === 'DONE').length,
      };
    }

    // Fallback to task-based calculation
    const completedTasks = tasks.filter((t) => t.status === 'DONE').length;
    const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;

    let autoStatus: Epic['status'] = 'TODO';
    if (completedTasks === tasks.length && tasks.length > 0) {
      autoStatus = 'DONE';
    } else if (completedTasks > 0) {
      autoStatus = 'IN_PROGRESS';
    }

    return {
      totalFRs: 0,
      completedFRs: 0,
      inProgressFRs: 0,
      progress,
      autoStatus,
      totalTasks: tasks.length,
      completedTasks,
    };
  }, [linkedFRs, tasks]);

  const handleDelete = async () => {
    await deleteEpic.mutateAsync({
      epicId: epic.id,
      projectId,
    });
    setDeleteDialogOpen(false);
    onOpenChange(false);
  };

  const statusConfig: Record<Epic['status'], { label: string; color: string }> = {
    TODO: { label: 'To Do', color: 'bg-gray-500' },
    IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-500' },
    DONE: { label: 'Done', color: 'bg-green-500' },
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {epic.hierarchyId}
                  </Badge>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: epic.color }} />
                </div>
                <DialogTitle className="text-2xl">{epic.name}</DialogTitle>
                {epic.description && (
                  <DialogDescription className="text-base">{epic.description}</DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Status - Auto-calculated from FRs */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-md">
                <div className={`w-2 h-2 rounded-full ${statusConfig[metrics.autoStatus].color}`} />
                <span className="text-sm">{statusConfig[metrics.autoStatus].label}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  (Auto-calculated from {metrics.totalFRs > 0 ? 'FRs' : 'tasks'})
                </span>
              </div>
            </div>

            <Separator />

            {/* Progress */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Progress</label>
                <span className="text-2xl font-bold">{metrics.progress}%</span>
              </div>
              <Progress value={metrics.progress} className="h-3" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                {metrics.totalFRs > 0 ? (
                  <>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">FRs:</span>
                      <span className="font-medium">
                        {metrics.completedFRs} / {metrics.totalFRs}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">In Progress:</span>
                      <span className="font-medium">{metrics.inProgressFRs}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Tasks:</span>
                    <span className="font-medium">
                      {metrics.completedTasks} / {metrics.totalTasks}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Linked FRs */}
            {linkedFRs.length > 0 && (
              <>
                <div className="space-y-3">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Linked Functional Requirements ({linkedFRs.length})
                  </label>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {linkedFRs.map((fr) => {
                      const statusColor = {
                        DRAFT: 'bg-gray-500',
                        REVIEW: 'bg-yellow-500',
                        APPROVED: 'bg-blue-500',
                        IMPLEMENTED: 'bg-purple-500',
                        TESTED: 'bg-indigo-500',
                        DEPLOYED: 'bg-green-500',
                      }[fr.status];

                      return (
                        <div
                          key={fr.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono text-xs">
                                {fr.hierarchyId}
                              </Badge>
                              <span className="font-medium">{fr.title}</span>
                            </div>
                            {fr.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                                {fr.description}
                              </p>
                            )}
                          </div>
                          <Badge className={statusColor}>{fr.status}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Dates */}
            {(epic.startDate || epic.endDate) && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Timeline
                  </label>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {epic.startDate && (
                      <div>
                        <div className="text-muted-foreground">Start Date</div>
                        <div className="font-medium">{formatDate(epic.startDate)}</div>
                      </div>
                    )}
                    {epic.endDate && (
                      <div>
                        <div className="text-muted-foreground">Target End Date</div>
                        <div className="font-medium">{formatDate(epic.endDate)}</div>
                      </div>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Linked Tasks */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Linked Tasks ({tasks.length})</label>
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No tasks linked to this epic yet
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium">{task.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {task.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Metadata */}
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div>
                <div>Created</div>
                <div className="font-medium text-foreground">{formatDate(epic.createdAt)}</div>
              </div>
              <div>
                <div>Last Updated</div>
                <div className="font-medium text-foreground">{formatDate(epic.updatedAt)}</div>
              </div>
            </div>
          </div>

          <Separator />
          {canDelete && (
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
              className="text-white"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Epic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{epic.name}&rquo;. Tasks linked to this epic will
              not be deleted, but they will be unlinked. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <AlertDialogCancel className="mt-2 sm:mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
