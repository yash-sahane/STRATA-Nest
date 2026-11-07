'use client';

import {
  getFunctionalRequirementStatusConfig,
  getRequirementStatusConfig,
  getSprintStatusConfig,
  getTaskStatusConfig,
} from '@/lib/semantic/status';
import Link from 'next/link';
import { ComplexityBadge } from '@/components/requirements/complexity-badge';
import { getPriorityConfig } from '@/lib/semantic/priority';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Trash2, Link as LinkIcon, Calendar, Copy, Pencil, Save } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import {
  useUpdateFunctionalRequirement,
  useDeleteFunctionalRequirement,
  useCloneFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { useSprints } from '@/hooks/use-sprint';
import { useEpics } from '@/hooks/use-epic';
import { useProjects } from '@/hooks/use-project';
import { useTasksByFunctionalRequirement } from '@/hooks/use-task';
import { TeamMemberSelector } from '@/components/tasks/team-member-selector';
import { ApiError } from '@/lib/api/rest-client';
import type { FunctionalRequirement, ClientRequirement } from '@/types';
import { humanizeEnum } from '@/lib/semantic/status';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { toast } from 'sonner';

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
  /** Open the full edit form for this requirement. */
  onEdit?: () => void;
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
  onEdit,
}: FunctionalRequirementDetailDialogProps) {
  const canPlanSprints = useHasPermission(Permission.EDIT_SPRINT);
  const canAddTask = useHasPermission(Permission.CREATE_TASK);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  /** Server's 409 message when child requirements block the delete (null = not blocked). */
  const [deleteBlockedBy, setDeleteBlockedBy] = React.useState<string | null>(null);
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [selectedProject, setSelectedProject] = React.useState<string>('');

  // Local state for editable fields
  const [localSprintId, setLocalSprintId] = React.useState<string>(requirement.sprintId || '');
  const [localAssignedTo, setLocalAssignedTo] = React.useState<string[]>(
    requirement.assigneeIds || []
  );
  const [hasChanges, setHasChanges] = React.useState(false);
  /**
   * What the two fields held when this dialog was seeded: the values this
   * person is looking at and choosing from.
   *
   * Both the "unsaved changes" test and the save's `basedOn` used to read the
   * LIVE record, which is refetched whenever anybody saves. If a colleague
   * moved the requirement to another sprint while this dialog was open, the
   * dialog still showed the old sprint, lit up Save Changes on its own — and
   * pressing it sent the old sprint back with a `basedOn` of the colleague's
   * new one. The API had nothing to object to, and undid their change.
   */
  const [opened, setOpened] = React.useState<{ sprintId: string; assigneeIds: string[] }>({
    sprintId: requirement.sprintId || '',
    assigneeIds: requirement.assigneeIds || [],
  });

  const updateRequirement = useUpdateFunctionalRequirement();
  const deleteRequirement = useDeleteFunctionalRequirement();
  const cloneRequirement = useCloneFunctionalRequirement();

  // Load workspace members, sprints, and linked tasks
  const { data: sprints = [] } = useSprints(projectId);
  const { data: projects = [] } = useProjects(workspaceId);
  const { data: linkedTasks = [] } = useTasksByFunctionalRequirement(requirement.id);
  // The epic it belongs to: the dialog named the client requirement but not this.
  const { data: epics = [] } = useEpics(projectId);
  const epic = epics.find((e) => e.id === requirement.epicId);

  // Re-seed only when a different FR is opened. Keying on `requirement.assigneeIds`
  // re-ran on every background refetch (new array identity) and threw away
  // in-progress selections.
  React.useEffect(() => {
    if (!open) return;
    setLocalSprintId(requirement.sprintId || '');
    setLocalAssignedTo(requirement.assigneeIds || []);
    setOpened({
      sprintId: requirement.sprintId || '',
      assigneeIds: requirement.assigneeIds || [],
    });
    setHasChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement.id, open]);

  // Track changes. Both operands are copied before sorting: `.sort()` is
  // in-place, so sorting them directly mutated React state and the query cache.
  const sprintChanged = localSprintId !== opened.sprintId;
  const assigneesChanged =
    JSON.stringify([...localAssignedTo].sort()) !== JSON.stringify([...opened.assigneeIds].sort());
  React.useEffect(() => {
    setHasChanges(sprintChanged || assigneesChanged);
  }, [sprintChanged, assigneesChanged]);

  const handleSprintChange = (sprintId: string) => {
    setLocalSprintId(sprintId === 'none' ? '' : sprintId);
  };

  const handleTeamMemberChange = (userIds: string[]) => {
    setLocalAssignedTo(userIds);
  };

  const handleSave = async () => {
    try {
      await updateRequirement.mutateAsync({
        requirementId: requirement.id,
        projectId,
        updates: {
          // Only the field that was changed. Sending both wrote this dialog's
          // copy of the untouched one back over whatever it had become since.
          //
          // The raw value for the sprint: '' detaches the FR from its sprint.
          // `undefined` is dropped by JSON.stringify, so the old sprint was
          // never cleared.
          ...(sprintChanged ? { sprintId: localSprintId } : {}),
          ...(assigneesChanged ? { assigneeIds: localAssignedTo } : {}),
          // What those fields held when this dialog opened. Reassignment is exactly the
          // thing two managers do to the same requirement at once, and without this the
          // later save wins outright with nothing said to either of them. Refused, the
          // `catch` below leaves the dialog open and dirty, so nothing is retyped.
          basedOn: {
            ...(sprintChanged ? { sprintId: opened.sprintId } : {}),
            ...(assigneesChanged ? { assigneeIds: opened.assigneeIds } : {}),
          },
        },
      });
    } catch {
      // The mutation's onError already toasted; keep the dialog open and dirty.
      return;
    }

    // What this means for the tasks under the requirement is the API's to
    // carry out, as part of the save: they move with it into or out of the
    // sprint, and the ones that had the requirement's people follow a change
    // to them. This dialog used to write its assignee list over every linked
    // task itself, one request each, which flattened whatever each task had
    // been given.
    toast.success('Saved', { description: 'Functional requirement updated.' });

    // What was just saved is what the next edit starts from.
    setOpened({ sprintId: localSprintId, assigneeIds: localAssignedTo });
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
      toast.error('Choose the project to copy it into');
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
  // The sprint the requirement is SAVED in. Once that sprint has closed it is
  // the record of what the sprint delivered, and the server refuses to take the
  // requirement out of it — so an enabled select only led to a refused save.
  // (Unfinished requirements leave a sprint when it closes; the ones still in
  // it are the delivered ones.)
  const savedSprint = sprints.find((s) => s.id === opened.sprintId);
  const heldByClosedSprint = savedSprint?.status === 'COMPLETED';

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
                  <ComplexityBadge complexity={requirement.complexity} />
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
                      {humanizeEnum(requirement.type)}
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
              {/* Changeable by somebody who may save it: a read-only viewer
                  could pick a sprint, watch Close turn into Cancel, and find no
                  Save. Planning into a sprint also takes planning:write. */}
              <Select
                value={localSprintId || 'none'}
                onValueChange={handleSprintChange}
                disabled={!canEdit || !canPlanSprints || heldByClosedSprint}
              >
                <SelectTrigger
                  aria-describedby={heldByClosedSprint ? 'fr-sprint-closed-note' : undefined}
                >
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
                      {sprint.name} · {getSprintStatusConfig(sprint.status).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSprint && !sprintChanged && (
                <Link
                  href={`/sprints/${selectedSprint.id}/board`}
                  className="inline-block text-sm underline-offset-4 hover:underline"
                >
                  Open the {selectedSprint.name} board
                </Link>
              )}
              {heldByClosedSprint && savedSprint ? (
                <p id="fr-sprint-closed-note" className="text-xs text-muted-foreground">
                  {savedSprint.name} is completed and keeps the record of what it delivered, so
                  this requirement stays in it. Plan any further work on it as tasks in an open
                  sprint.
                </p>
              ) : (
                (!canEdit || !canPlanSprints) && (
                  <p className="text-xs text-muted-foreground">
                    Planning requirements into sprints is for whoever plans the sprints.
                  </p>
                )
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
                disabled={!canEdit}
              />
            </div>

            <Separator />

            {/* Implementing tasks.
                These were already loaded — useTasksByFunctionalRequirement above —
                and used only to push assignee changes onto them. "Which tasks
                implement this requirement" was a question the dialog answered
                internally and never told anybody. */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  Implementing Tasks
                  <Badge variant="secondary">{linkedTasks.length}</Badge>
                </h3>
                {canAddTask && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/tasks?projectId=${projectId}&action=create&frId=${requirement.id}`}>
                      Add a task
                    </Link>
                  </Button>
                )}
              </div>
              {linkedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No tasks are linked to this requirement yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {linkedTasks.map((task) => {
                    const status = getTaskStatusConfig(task.status);
                    return (
                      <li key={task.id}>
                        <Link
                          href={`/tasks?projectId=${projectId}&taskId=${task.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs shrink-0">
                              {task.hierarchyId}
                            </Badge>
                            <span className="truncate text-sm" title={task.title}>{task.title}</span>
                          </div>
                          <Badge variant={status.badgeVariant} className="shrink-0">
                            {status.label}
                          </Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <Separator />

            {/* What it delivers: the epic, and the client requirement behind it. */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                Part of
              </h3>
              {epic ? (
                <Link
                  href={`/epics?projectId=${projectId}&epicId=${epic.id}`}
                  className="inline-flex max-w-full items-baseline gap-2 text-sm font-medium underline-offset-4 hover:underline"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{epic.hierarchyId}</span>
                  <span className="truncate" title={epic.name}>{epic.name}</span>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Not in an epic.</p>
              )}
            </div>

            <Separator />

            {/* Linked Client Requirement */}
            {linkedClientReq && (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" />
                    Client Requirement
                  </h3>
                  <Link
                    href={`/requirements?projectId=${projectId}&crId=${linkedClientReq.id}`}
                    className="block p-3 border rounded-lg transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
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
                  </Link>
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

          {/* The real DialogFooter, not a hand-rolled row. It carries the mobile
              stacking order (flex-col-reverse, primary action on top) that every
              other dialog in the app has; this used to be plain flex-col, so the
              Save button sat at the BOTTOM of the stack here and at the top
              everywhere else. `sm:justify-between` keeps the split -- destructive
              actions left, confirm right -- which is what the AlertDialogFooter
              below does too. */}
          <DialogFooter className="sm:justify-between sm:space-x-0">
            <div className="flex gap-2 w-full sm:w-auto">
              {canEdit && onEdit && (
                <Button variant="outline" onClick={onEdit} className="flex-1 sm:flex-none">
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
              {/* Signing off is a person's decision, and until now there was
                  nowhere to make it: the status after "every task is done" could
                  only be reached by dragging a card the board hides for any
                  requirement that has tasks. */}
              {canEdit && requirement.status === 'TESTED' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    updateRequirement.mutate({
                      requirementId: requirement.id,
                      projectId,
                      updates: { status: 'DEPLOYED' },
                    })
                  }
                  disabled={updateRequirement.isPending}
                  className="flex-1 sm:flex-none"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Mark as Done
                </Button>
              )}
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
          </DialogFooter>
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
