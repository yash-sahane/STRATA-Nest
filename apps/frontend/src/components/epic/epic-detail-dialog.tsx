'use client';

import {
  getEpicStatusConfig,
  getFunctionalRequirementStatusConfig,
} from '@/lib/semantic/status';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Trash2, Calendar, CheckCircle2, FileText, Pencil } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { deriveEpicMetrics, useDeleteEpic } from '@/hooks/use-epic';
import { EditEpicDialog } from '@/components/epic/edit-epic-dialog';
import { useFunctionalRequirementsByEpic } from '@/hooks/use-functional-requirement';
import type { Epic, Task } from '@/types';

// Cancelling the Edit dialog or the delete confirm used to close this dialog
// with it (Escape did not). The guard for that now lives in DialogContent
// itself — `guardNestedOverlays` in components/ui/dialog.tsx — so every dialog
// in the app gets it and no per-dialog copy can drift out of step.
interface EpicDetailDialogProps {
  epic: Epic;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tasks: Task[];
  canDelete?: boolean; // Permission to delete epics (managers/assistant managers)
  canEdit?: boolean; // Permission to change an epic after it exists
}

export function EpicDetailDialog({
  epic,
  open,
  onOpenChange,
  projectId,
  tasks,
  canDelete = false,
  canEdit = false,
}: EpicDetailDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const deleteEpic = useDeleteEpic();

  // Epic dates are date-only wire values ("2026-08-11"). `new Date(...)` reads
  // those as UTC midnight and renders the previous day west of UTC.
  const formatEpicDate = (value: string) => format(parseISO(value), 'MMM d, yyyy');

  // ✅ Load FRs linked to this epic
  const { data: linkedFRs = [] } = useFunctionalRequirementsByEpic(epic.id);

  // Progress is TASK-derived, matching the epic card and the persisted rollup in
  // useUpdateTask. This dialog used to prefer an FR-derived number with different
  // thresholds, so clicking a card changed the percentage and status badge in
  // front of the user. FRs are still summarised below as context.
  const metrics = React.useMemo(() => {
    const completedFRs = linkedFRs.filter(
      (fr) => fr.status === 'DEPLOYED' || fr.status === 'TESTED'
    ).length;
    const inProgressFRs = linkedFRs.filter(
      (fr) => fr.status === 'APPROVED' || fr.status === 'IMPLEMENTED' || fr.status === 'REVIEW'
    ).length;

    return {
      totalFRs: linkedFRs.length,
      completedFRs,
      inProgressFRs,
      // deriveEpicMetrics, not a local copy: the card on /epics renders the same
      // numbers, and the two derivations drifted apart.
      ...deriveEpicMetrics(tasks),
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
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
                <div
                  className={`w-2 h-2 rounded-full ${getEpicStatusConfig(metrics.status).dot}`}
                />
                <span className="text-sm">{getEpicStatusConfig(metrics.status).label}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  (Auto-calculated from tasks)
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
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Tasks:</span>
                  <span className="font-medium">
                    {metrics.completedTasks} / {metrics.totalTasks}
                  </span>
                </div>
                {metrics.totalFRs > 0 && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">FRs:</span>
                    <span className="font-medium">
                      {metrics.completedFRs} / {metrics.totalFRs}
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
                  <div
                    role="region"
                    aria-label="Linked functional requirements"
                    tabIndex={0}
                    className="space-y-2 max-h-[300px] overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {linkedFRs.map((fr) => {
                      // Resolve the FR status through the design system, exactly
                      // as the FR table and the sprint cards do. The private
                      // `bg-*-500` map that used to live here was a fifth status
                      // palette nobody else shared, and Badge's default variant
                      // paints near-white text on it: REVIEW measured 1.83:1 and
                      // DEPLOYED 2.12:1 in light theme, i.e. unreadable blobs.
                      const status = getFunctionalRequirementStatusConfig(fr.status);

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
                          <Badge variant={status.badgeVariant} className={status.badgeClassName}>
                            {status.label}
                          </Badge>
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
                        <div className="font-medium">{formatEpicDate(epic.startDate)}</div>
                      </div>
                    )}
                    {epic.endDate && (
                      <div>
                        <div className="text-muted-foreground">Target End Date</div>
                        <div className="font-medium">{formatEpicDate(epic.endDate)}</div>
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
                <div
                  role="region"
                  aria-label="Linked tasks"
                  tabIndex={0}
                  className="space-y-2 max-h-[300px] overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
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
          {/* Until now an epic could be created and deleted but never changed —
              the update hook existed with no control behind it. */}
          {(canEdit || canDelete) && (
            <DialogFooter>
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
              {canEdit && (
                <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {canEdit && (
        <EditEpicDialog epic={epic} open={editDialogOpen} onOpenChange={setEditDialogOpen} />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Epic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{epic.name}&rdquo;. Linked functional
              requirements and tasks are not deleted; they are unlinked from this epic. This
              action cannot be undone.
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
