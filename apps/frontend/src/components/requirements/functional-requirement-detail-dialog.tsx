'use client';

import { getFunctionalRequirementStatusConfig, getRequirementStatusConfig } from '@/lib/semantic/status';
import { getComplexityConfig } from '@/lib/semantic/complexity';
import { getPriorityConfig } from '@/lib/semantic/priority';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Trash2, Link as LinkIcon, Calendar, Copy, Save } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useUpdateFunctionalRequirement,
  useDeleteFunctionalRequirement,
  useCloneFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { useTeamMembers } from '@/hooks/use-team';
import { useSprints } from '@/hooks/use-sprint';
import { useProjects } from '@/hooks/use-project';
import { useTasksByFunctionalRequirement, useUpdateTask } from '@/hooks/use-task';
import { TeamMemberSelector } from '@/components/tasks/team-member-selector';
import { createBulkNotifications } from '@/hooks/use-notification';
import { useAuth } from '@/components/providers/auth-provider';
import { ApiError } from '@/lib/api/rest-client';
import type { FunctionalRequirement, ClientRequirement } from '@/types';
import { logger } from '@/lib/logger';

/** Server copy ends with developer instructions; the UI offers the button instead. */
const stripCascadeHint = (message: string) =>
  message.replace(/\s*Delete them first or retry with cascade=true\.?\s*$/i, '');

/**
 * Keep this dialog open when the pointer went down inside an overlay stacked on
 * top of it.
 *
 * Clicking Cancel on the delete confirm used to close the FR dialog with it and
 * silently discard unsaved edits, while Escape on the very same confirm did
 * not. Radix defers a dialog's pointer-down-outside to the CLICK that follows,
 * and by then the confirm has already released its `disableOutsidePointerEvents`
 * lock (Radix binds it to the confirm's own `open`) — so this layer sees an
 * unguarded outside click and dismisses. Escape only ever reaches the topmost
 * layer, which is why the two dismissals disagreed. Judge by where the pointer
 * actually went down instead. Clicking this dialog's own overlay still closes it.
 */
interface FunctionalRequirementDetailDialogProps {
  requirement: FunctionalRequirement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  clientRequirements: ClientRequirement[];
  canEdit?: boolean; // Permission to edit requirements
  canDelete?: boolean; // Permission to delete requirements
}

export function FunctionalRequirementDetailDialog({
  requirement,
  open,
  onOpenChange,
  projectId,
  workspaceId,
  clientRequirements,
  canEdit = false,
  canDelete = false,
}: FunctionalRequirementDetailDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  /** Server's 409 message when child requirements block the delete (null = not blocked). */
  const [deleteBlockedBy, setDeleteBlockedBy] = React.useState<string | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [selectedProject, setSelectedProject] = React.useState<string>('');

  // Local state for editable fields
  const [localSprintId, setLocalSprintId] = React.useState<string>(requirement.sprintId || '');
  const [localAssignedTo, setLocalAssignedTo] = React.useState<string[]>(
    requirement.assignedTo || []
  );
  const [hasChanges, setHasChanges] = React.useState(false);

  const updateRequirement = useUpdateFunctionalRequirement();
  const deleteRequirement = useDeleteFunctionalRequirement();
  const cloneRequirement = useCloneFunctionalRequirement();
  const updateTask = useUpdateTask();
  const { toast } = useToast();
  const { user } = useAuth();

  // Load workspace members, sprints, and linked tasks
  const { data: members = [] } = useTeamMembers(workspaceId);
  const { data: sprints = [] } = useSprints(projectId);
  const { data: projects = [] } = useProjects(workspaceId);
  const { data: linkedTasks = [] } = useTasksByFunctionalRequirement(requirement.id);

  // Re-seed only when a different FR is opened. Keying on `requirement.assignedTo`
  // re-ran on every background refetch (new array identity) and threw away
  // in-progress selections.
  React.useEffect(() => {
    if (!open) return;
    setLocalSprintId(requirement.sprintId || '');
    setLocalAssignedTo(requirement.assignedTo || []);
    setHasChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement.id, open]);

  // Track changes. Both operands are copied before sorting: `.sort()` is
  // in-place, so sorting them directly mutated React state and the query cache.
  React.useEffect(() => {
    const sprintChanged = localSprintId !== (requirement.sprintId || '');
    const assigneesChanged =
      JSON.stringify([...localAssignedTo].sort()) !==
      JSON.stringify([...(requirement.assignedTo || [])].sort());
    setHasChanges(sprintChanged || assigneesChanged);
  }, [localSprintId, localAssignedTo, requirement.sprintId, requirement.assignedTo]);

  const handleSprintChange = (sprintId: string) => {
    setLocalSprintId(sprintId === 'none' ? '' : sprintId);
  };

  const handleTeamMemberChange = (userIds: string[]) => {
    setLocalAssignedTo(userIds);
  };

  const handleSave = async () => {
    // Build assignedToNames from selected user IDs
    const assignedToNames = localAssignedTo.map((userId) => {
      const member = members.find((m) => m.userId === userId);
      return member?.name || member?.email || 'Unknown';
    });

    // Check if assignees changed. Copy before sorting — `assignedToNames` above
    // is index-aligned with `localAssignedTo`, and an in-place sort here would
    // pair every id with somebody else's name in the payload sent below.
    const previousAssignees = requirement.assignedTo || [];
    const assigneesChanged =
      JSON.stringify([...localAssignedTo].sort()) !== JSON.stringify([...previousAssignees].sort());
    const newAssignees = localAssignedTo.filter((id) => !previousAssignees.includes(id));

    // Get project name for notifications
    const currentProject = projects.find((p) => p.id === projectId);
    const projectName = currentProject?.name || 'Project';

    let reassignedTasks = 0;

    try {
      await updateRequirement.mutateAsync({
        requirementId: requirement.id,
        projectId,
        updates: {
          // Send the raw value: '' detaches the FR from its sprint. `undefined`
          // is dropped by JSON.stringify, so the old sprint was never cleared.
          sprintId: localSprintId,
          assignedTo: localAssignedTo,
          assignedToNames,
        },
        // `?? ''`, not `|| undefined`: '' IS the answer for an FR that has no
        // sprint yet, and `undefined` means "I don't know" — which makes the
        // hook re-read the FR before writing. That was every save of an
        // unscheduled FR paying for a GET whose answer this dialog already had.
        previousSprintId: requirement.sprintId ?? '',
      });
    } catch {
      // The mutation's onError already toasted; keep the dialog open and dirty.
      return;
    }

    // ✅ AUTO-ASSIGN: Update linked tasks with the same assignees
    if (assigneesChanged && linkedTasks.length > 0) {
      try {
        // Update all linked tasks with the new assignees. useUpdateTask already
        // emits the TASK_ASSIGNED notifications for the newly added members, so
        // this handler must NOT emit them a second time.
        await Promise.all(
          linkedTasks.map((task) =>
            updateTask.mutateAsync({
              taskId: task.id,
              projectId,
              // One combined toast is emitted below for the whole save; without
              // this the fan-out stacked one "Task updated" toast per task.
              silent: true,
              updates: {
                assignedTo: localAssignedTo,
                assignedToNames,
                assigneeIds: localAssignedTo,
                assignedBy: user?.id,
                assignedByName: user?.name || user?.email || 'Team Member',
              },
            })
          )
        );
        reassignedTasks = linkedTasks.length;
      } catch (error) {
        logger.error('Failed to update linked tasks', { error });
        toast({
          title: 'Warning',
          description: 'FR updated but failed to update some linked tasks.',
          variant: 'destructive',
        });
      }
    }

    // ✅ Send FR assignment notifications to new assignees
    if (newAssignees.length > 0) {
      try {
        await createBulkNotifications({
          workspaceId,
          userIds: newAssignees,
          type: 'FR_ASSIGNED',
          data: {
            frId: requirement.id,
            frTitle: requirement.title,
            frHierarchyId: requirement.hierarchyId,
            projectId,
            projectName,
            assignerName: user?.name || user?.email || 'Team Member',
            entityType: 'FR',
          },
        });
      } catch (error) {
        logger.error('Failed to send FR assignment notifications', { error });
      }
    }

    // One toast for the whole save — the hooks are deliberately silent.
    toast({
      title: 'Saved',
      description: reassignedTasks
        ? `Functional requirement updated — ${reassignedTasks} linked task(s) reassigned.`
        : 'Functional requirement updated successfully.',
    });

    setHasChanges(false);
  };

  const handleDelete = async (cascade = false) => {
    try {
      await deleteRequirement.mutateAsync({
        requirementId: requirement.id,
        projectId,
        cascade,
      });
      setDeleteBlockedBy(null);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    } catch (error) {
      // 409 = child requirements depend on this one. Offer the cascade the API
      // already supports instead of leaving the user at a dead end.
      if (error instanceof ApiError && error.code === 409) {
        setDeleteBlockedBy(stripCascadeHint(error.message));
        return;
      }
      // Anything else already surfaced through the mutation's onError toast.
      setDeleteDialogOpen(false);
    }
  };

  const handleClone = async () => {
    if (!selectedProject) {
      toast({
        title: 'Error',
        description: 'Please select a target project',
        variant: 'destructive',
      });
      return;
    }

    const targetProj = projects.find((p) => p.id === selectedProject);
    if (!targetProj) return;

    try {
      await cloneRequirement.mutateAsync({
        requirementId: requirement.id,
        targetProjectId: selectedProject,
        targetProjectCode: targetProj.shortCode,
        targetEpicId: undefined, // User can move to epic later
        targetClientRequirementId: undefined,
      });
    } catch {
      return; // onError already toasted; keep the dialog open so it can be retried
    }

    setCloneDialogOpen(false);
    setSelectedProject('');
  };

  const complexity = getComplexityConfig(requirement.complexity);
  const linkedClientReq = clientRequirements.find(
    (cr) => cr.id === requirement.clientRequirementId
  );

  // Same rule as the FR table (functional-requirements/page.tsx) so the row and
  // the dialog can never disagree about the percentage.
  const completedTasks = linkedTasks.filter((t) => t.status === 'DONE').length;
  const storedProgress = requirement.progress ?? 0;
  const progress =
    storedProgress === 0 && linkedTasks.length > 0
      ? Math.round((completedTasks / linkedTasks.length) * 100)
      : storedProgress;

  // Get assigned sprint name (for display)
  const selectedSprint = sprints.find((s) => s.id === localSprintId);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="2xl"
          className="max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {requirement.hierarchyId}
                  </Badge>
                  {requirement.reusable && <Badge variant="secondary">Reusable</Badge>}
                </div>
                <DialogTitle className="text-2xl">{requirement.title}</DialogTitle>
                {requirement.description && (
                  <DialogDescription className="text-base">
                    {requirement.description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Status - Auto-calculated from tasks, read-only */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-md">
                <div
                  className={`w-2 h-2 rounded-full ${getFunctionalRequirementStatusConfig(requirement.status).dot}`}
                />
                <span className="text-sm">
                  {getFunctionalRequirementStatusConfig(requirement.status).label}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  (Auto-calculated from tasks)
                </span>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Progress</label>
              <div className="flex items-center gap-3">
                <Progress value={progress} className="flex-1 h-2" />
                <span className="text-sm font-medium w-12 text-right">{progress}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Based on linked tasks completion ({completedTasks}/{linkedTasks.length} done)
              </p>
            </div>

            <Separator />

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Priority</label>
                <div className="mt-1">
                  <Badge variant={getPriorityConfig(requirement.priority).badgeVariant}>
                    {getPriorityConfig(requirement.priority).label}
                  </Badge>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Complexity</label>
                <div className="mt-1">
                  <Badge variant={complexity.badgeVariant}>{complexity.label}</Badge>
                </div>
              </div>
              {/* The create form REQUIRES a type and nothing ever showed it back, so
                  every requirement was classified for no visible purpose. The grid
                  already reserved a third column at md and above. */}
              {requirement.type && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Type</label>
                  <div className="mt-1">
                    <Badge variant="outline">
                      {String(requirement.type).replace(/_/g, ' ').toLowerCase()}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Sprint Assignment */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Assign to Sprint
              </label>
              <Select value={localSprintId || 'none'} onValueChange={handleSprintChange}>
                <SelectTrigger>
                  <SelectValue placeholder="No sprint assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sprint</SelectItem>
                  {sprints.map((sprint) => (
                    <SelectItem
                      key={sprint.id}
                      value={sprint.id}
                      disabled={sprint.status === 'COMPLETED'}
                    >
                      {sprint.name} ({sprint.status}){sprint.status === 'COMPLETED' && ' - Closed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSprint && (
                <p className="text-sm text-muted-foreground">Selected: {selectedSprint.name}</p>
              )}
            </div>

            <Separator />

            {/* Team Assignment */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Assigned Team Members</label>
              <TeamMemberSelector
                workspaceId={workspaceId}
                value={localAssignedTo}
                onChange={handleTeamMemberChange}
                placeholder="Select team members..."
                multiSelect={true}
              />
            </div>

            <Separator />

            {/* Implementing tasks.
                These were already loaded — useTasksByFunctionalRequirement above —
                and used only to push assignee changes onto them. "Which tasks
                implement this requirement" was a question the dialog answered
                internally and never told anybody. */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                Implementing Tasks
                <Badge variant="secondary">{linkedTasks.length}</Badge>
              </label>
              {linkedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No tasks are linked to this requirement yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {linkedTasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs shrink-0">
                          {task.hierarchyId}
                        </Badge>
                        <span className="truncate text-sm">{task.title}</span>
                      </div>
                      <Badge
                        variant={
                          task.status === 'DONE'
                            ? 'success'
                            : task.status === 'IN_PROGRESS'
                              ? 'default'
                              : 'secondary'
                        }
                        className="shrink-0"
                      >
                        {task.status.replace(/_/g, ' ')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Separator />

            {/* Linked Client Requirement */}
            {linkedClientReq && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" />
                    Linked Client Requirement
                  </label>
                  <div className="p-3 border rounded-lg">
                    <div className="font-medium">{linkedClientReq.title}</div>
                    {linkedClientReq.description && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {linkedClientReq.description}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant={getPriorityConfig(linkedClientReq.priority).badgeVariant}>
                        {getPriorityConfig(linkedClientReq.priority).label}
                      </Badge>
                      <Badge variant={getRequirementStatusConfig(linkedClientReq.status).badgeVariant}>
                        {getRequirementStatusConfig(linkedClientReq.status).label}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div>
                <div>Created</div>
                <div className="font-medium text-foreground">
                  {formatDate(requirement.createdAt)}
                </div>
              </div>
              <div>
                <div>Last Updated</div>
                <div className="font-medium text-foreground">
                  {formatDate(requirement.updatedAt)}
                </div>
              </div>
            </div>
          </div>

          {/* Footer with Save and Actions */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <div className="flex gap-2 w-full sm:w-auto">
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={() => setCloneDialogOpen(true)}
                  className="flex-1 sm:flex-none"
                  title="Clone to another project"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Clone
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(true)}
                  className="flex-1 sm:flex-none text-destructive-text hover:text-destructive-text"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 sm:flex-none"
              >
                {hasChanges ? 'Cancel' : 'Close'}
              </Button>
              {canEdit && (
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || updateRequirement.isPending}
                  className="flex-1 sm:flex-none"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateRequirement.isPending ? 'Saving...' : 'Save'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation — escalates to a cascade prompt on the server's 409 */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(next) => {
          setDeleteDialogOpen(next);
          if (!next) setDeleteBlockedBy(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteBlockedBy ? 'Delete child requirements too?' : 'Delete Functional Requirement?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlockedBy ? (
                <>
                  {deleteBlockedBy} Deleting them together removes the whole sub-tree. This action
                  cannot be undone.
                </>
              ) : (
                <>
                  This will permanently delete &quot;{requirement.title}&quot;. This action cannot
                  be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <AlertDialogCancel className="mt-2 sm:mt-0" disabled={deleteRequirement.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              // preventDefault: Radix closes the alert on click, which would hide
              // the in-flight state and the cascade prompt that follows a 409.
              onClick={(e) => {
                e.preventDefault();
                handleDelete(!!deleteBlockedBy);
              }}
              disabled={deleteRequirement.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRequirement.isPending
                ? 'Deleting...'
                : deleteBlockedBy
                  ? 'Delete with children'
                  : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clone to Project Dialog */}
      <AlertDialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clone Functional Requirement</AlertDialogTitle>
            <AlertDialogDescription>
              Clone &quot;{requirement.hierarchyId}&quot; to another project. The FR will be
              duplicated with a new hierarchy id.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Target Project</label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger>
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent>
                {projects
                  .filter((p) => p.id !== projectId) // Exclude current project
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.shortCode} - {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedProject('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleClone();
              }}
              disabled={!selectedProject || cloneRequirement.isPending}
            >
              {cloneRequirement.isPending ? 'Cloning...' : 'Clone FR'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
