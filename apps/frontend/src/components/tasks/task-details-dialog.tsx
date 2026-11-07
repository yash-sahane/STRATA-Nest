'use client';

import { getPriorityConfig } from '@/lib/semantic/priority';
import { getTaskStatusConfig } from '@/lib/semantic/status';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { Calendar, Clock, User, Edit, Trash2, Tag } from 'lucide-react';
import { formatDate, cn, getInitials } from '@/lib/utils';
import type { Task, TaskStatus } from '@/types';
import { Textarea } from '@/components/ui/textarea';
import { TaskDependencies } from '@/components/tasks/task-dependencies';
import { TaskComments } from '@/components/tasks/task-comments';
import { TaskCommits } from '@/components/tasks/task-commits';
import { AttachmentsSection } from '@/components/files/project-files-panel';
import { TaskTimeTracking } from '@/components/time-tracking/task-time-tracking';
import {
  useTasksByIds,
  useAddTaskDependency,
  useRemoveTaskDependency,
} from '@/hooks/use-task';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useIsProjectArchived } from '@/hooks/use-project';
import { useTeamMembers } from '@/hooks/use-team';
import { useSprints } from '@/hooks/use-sprint';
import { useEpics } from '@/hooks/use-epic';
import { useFunctionalRequirements } from '@/hooks/use-functional-requirement';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import { roleDisplayName } from '@/hooks/use-role-options';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { labelColorClass, labelText } from '@/components/tasks/task-display';

interface TaskDetailsDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  /** Whether the viewer may change the task's dependency edges (`task:write`). */
  canEditDependencies?: boolean;
  /**
   * Moves the task through review, with an optional note posted on it. Absent:
   * the viewer may not move tasks, and no review controls are offered.
   */
  onMoveStatus?: (task: Task, status: TaskStatus, note?: string) => Promise<void>;
  /** Whether the viewer signs tasks off (approve, or send back from Review). */
  canSignOff?: boolean;
}

export function TaskDetailsDialog({
  task,
  open,
  onOpenChange,
  onEdit: editTask,
  onDelete: deleteTask,
  canEditDependencies: mayEditDependencies = false,
  onMoveStatus: moveStatus,
  canSignOff = false,
}: TaskDetailsDialogProps) {
  // Whatever the screen that opened it allows, a task of an archived project is
  // read-only — the server refuses every change to it — so nothing here offers
  // one: no edit, delete, review move, dependency, comment or new time.
  const projectArchived = useIsProjectArchived(task?.projectId);
  const onEdit = projectArchived ? undefined : editTask;
  const onDelete = projectArchived ? undefined : deleteTask;
  const onMoveStatus = projectArchived ? undefined : moveStatus;
  const canEditDependencies = mayEditDependencies && !projectArchived;
  // "Send back" asks what needs another look; the answer is posted on the task.
  const [sendingBack, setSendingBack] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [moving, setMoving] = React.useState(false);
  React.useEffect(() => {
    setSendingBack(false);
    setNote('');
  }, [task?.id, open]);
  const move = async (status: TaskStatus, withNote?: string) => {
    if (!task || !onMoveStatus) return;
    setMoving(true);
    try {
      await onMoveStatus(task, status, withNote);
      setSendingBack(false);
      setNote('');
    } catch {
      // The save's own toast has said why; the dialog stays as it was.
    } finally {
      setMoving(false);
    }
  };
  // The tasks this one names — what it waits on, what waits on it, and what it
  // is part of — fetched by id, wherever in the workspace they are (edges may
  // cross projects; TaskDependencies badges those). It used to download every
  // task in the workspace each time a task was opened, to find a handful.
  const { data: relatedTasks = [], isSuccess: relatedLoaded } = useTasksByIds([
    ...(task?.blockedBy ?? []),
    ...(task?.blocks ?? []),
    task?.parentTaskId ?? '',
  ]);
  const addDependency = useAddTaskDependency();
  const removeDependency = useRemoveTaskDependency();

  // Get user info for time tracking
  const { user } = useAuth();
  // useWorkspace() was called with no id, so its query was permanently disabled
  // and `workspace` stayed undefined — which silently hid the whole Time
  // Tracking block below. The selected workspace is what this dialog wants.
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: teamMembers = [] } = useTeamMembers(currentWorkspace?.id);

  // What the task delivers. The dialog showed none of it — not the sprint it
  // is planned into, not the requirement it implements — and the parent task as
  // a raw id, so the chain from a client's ask to this piece of work could only
  // be followed from the other end. Same project-scoped queries the board's
  // filters already hold.
  const { data: sprints = [] } = useSprints(task?.projectId);
  const { data: epics = [] } = useEpics(task?.projectId);
  const { data: requirements = [] } = useFunctionalRequirements(task?.projectId);
  const { data: clientRequirements = [] } = useClientRequirements(task?.projectId);
  const chain = React.useMemo(() => {
    if (!task) return [];
    const projectId = task.projectId;
    const fr = requirements.find((r) => r.id === task.functionalRequirementId);
    const epic = epics.find((e) => e.id === (task.epicId || fr?.epicId));
    const cr = clientRequirements.find((c) => c.id === (fr?.clientRequirementId || epic?.requirementId));
    const sprint = sprints.find((s) => s.id === task.sprintId);
    const parent = relatedTasks.find((t) => t.id === task.parentTaskId);
    const rows: { label: string; text: string; href: string; code?: string }[] = [];
    if (cr) rows.push({ label: 'Client requirement', text: cr.title, href: `/requirements?projectId=${projectId}&crId=${cr.id}` });
    if (epic) rows.push({ label: 'Epic', text: epic.name, code: epic.hierarchyId, href: `/epics?projectId=${projectId}&epicId=${epic.id}` });
    if (fr) {
      rows.push({
        label: 'Functional requirement',
        text: fr.title,
        code: fr.hierarchyId,
        href: `/functional-requirements?projectId=${projectId}&frId=${fr.id}`,
      });
    }
    if (sprint) rows.push({ label: 'Sprint', text: sprint.name, href: `/sprints/${sprint.id}/board` });
    if (parent) {
      rows.push({
        label: 'Part of',
        text: parent.title,
        code: parent.hierarchyId,
        href: `/tasks?projectId=${parent.projectId}&taskId=${parent.id}`,
      });
    }
    return rows;
  }, [task, requirements, epics, clientRequirements, sprints, relatedTasks]);

  // Get assignee details
  const assignees = React.useMemo(() => {
    if (!task?.assigneeIds || !Array.isArray(task.assigneeIds) || task.assigneeIds.length === 0) {
      return [];
    }
    return teamMembers.filter((member) => task.assigneeIds?.includes(member.userId));
  }, [task, teamMembers]);

  if (!task) return null;

  const status = getTaskStatusConfig(task.status);
  const priority = task.priority ? getPriorityConfig(task.priority) : null;
  const labels = task.labels && Array.isArray(task.labels) ? task.labels : [];

  const handleAddDependency = async (targetTaskId: string, type: 'blocks' | 'blockedBy') => {
    await addDependency.mutateAsync({ taskId: task.id, targetTaskId, type });
  };

  const handleRemoveDependency = async (targetTaskId: string, type: 'blocks' | 'blockedBy') => {
    await removeDependency.mutateAsync({ taskId: task.id, targetTaskId, type });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {task.hierarchyId}
                </Badge>
                <Badge variant={status.badgeVariant}>{status.label}</Badge>
                {priority && (
                  <div className="flex items-center gap-1">
                    <span className={cn('h-2 w-2 rounded-full', priority.dot)} />
                    <span className="text-sm text-muted-foreground">{priority.label}</span>
                  </div>
                )}
              </div>
              <DialogTitle className="text-2xl">{task.title}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Description */}
          <div>
            <h3 className="text-sm font-medium mb-2">Description</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {task.description || 'No description provided'}
            </p>
          </div>

          <Separator />

          {/* Where this piece of work comes from and where it is planned. */}
          <div>
            <h3 className="text-sm font-medium mb-2">Delivers</h3>
            {chain.length > 0 ? (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
                {chain.map((row) => (
                  <React.Fragment key={row.label}>
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0">
                      <Link
                        href={row.href}
                        className="inline-flex max-w-full items-baseline gap-2 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.code && (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.code}</span>
                        )}
                        <span className="truncate" title={row.text}>{row.text}</span>
                      </Link>
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not linked to a requirement, an epic or a sprint yet.
              </p>
            )}
          </div>

          <Separator />

          {/* Task Details Grid */}
          <div className="grid grid-cols-2 gap-6">
            {/* Due Date */}
            {task.dueDate && (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Calendar className="h-4 w-4" />
                  Due Date
                </div>
                <p className="text-sm text-muted-foreground">{formatDate(task.dueDate)}</p>
              </div>
            )}

            {/* Estimated Hours. 0 means "no estimate", and a bare `&&` on a
                number renders the 0 itself — so every task created without an
                estimate opened this grid with a naked zero. */}
            {(task.estimatedHours ?? 0) > 0 && (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Clock className="h-4 w-4" />
                  Estimated Hours
                </div>
                <p className="text-sm text-muted-foreground">{task.estimatedHours}h</p>
              </div>
            )}

            {/* Created Date */}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Calendar className="h-4 w-4" />
                Created
              </div>
              <p className="text-sm text-muted-foreground">{formatDate(task.createdAt)}</p>
            </div>

            {/* Updated Date */}
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Calendar className="h-4 w-4" />
                Last Updated
              </div>
              <p className="text-sm text-muted-foreground">{formatDate(task.updatedAt)}</p>
            </div>
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Tag className="h-4 w-4" />
                  Labels
                </div>
                <div className="flex flex-wrap gap-2">
                  {labels.map((label, index) => (
                    <Badge
                      key={index}
                      variant="outline"
                      className={cn('border whitespace-normal', labelColorClass(label))}
                    >
                      {labelText(label)}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Assignees */}
          {assignees.length > 0 ? (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-3">
                  <User className="h-4 w-4" />
                  Assigned To ({assignees.length})
                </div>
                <div className="space-y-2">
                  {assignees.map((member) => (
                    <div key={member.userId} className="flex items-center gap-3 p-2 rounded-lg">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member.avatar} alt={member.name} />
                        <AvatarFallback className="text-xs">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{member.name}</div>
                        <div className="text-xs text-muted-foreground truncate" title={member.email}>{member.email}</div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {roleDisplayName(member.rawRole)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <User className="h-4 w-4" />
                  Assigned To
                </div>
                <p className="text-sm text-muted-foreground">Unassigned</p>
              </div>
            </>
          )}

          {/* Assigned By */}
          {task.assignedBy &&
            (() => {
              // Find the assigner in team members
              const assigner = teamMembers.find((member) => member.userId === task.assignedBy);

              if (!assigner) {
                // Fallback if assigner not found in team members
                return task.assignedByName ? (
                  <>
                    <Separator />
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium mb-2">
                        <User className="h-4 w-4" />
                        Assigned By
                      </div>
                      <p className="text-sm text-muted-foreground">{task.assignedByName}</p>
                    </div>
                  </>
                ) : null;
              }

              return (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium mb-3">
                      <User className="h-4 w-4" />
                      Assigned By
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-lg">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={assigner.avatar} alt={assigner.name} />
                        <AvatarFallback className="text-xs">
                          {getInitials(assigner.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{assigner.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {assigner.email}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {roleDisplayName(assigner.rawRole)}
                      </Badge>
                    </div>
                  </div>
                </>
              );
            })()}

          {/* Attachments: screenshots, logs, documents for this task. */}
          <Separator />
          <AttachmentsSection workspaceId={task.workspaceId} projectId={task.projectId} taskId={task.id} />

          {/* Task Dependencies */}
          <Separator />
          <TaskDependencies
            task={task}
            relatedTasks={relatedTasks}
            relatedLoaded={relatedLoaded}
            onAddDependency={handleAddDependency}
            onRemoveDependency={handleRemoveDependency}
            canEdit={canEditDependencies}
          />

          {/* Comments — the discussion thread. Any workspace member may post;
              editing and deleting are limited to the comment's author. */}
          <Separator />
          <TaskComments taskId={task.id} workspaceId={currentWorkspace?.id} readOnly={projectArchived} />

          {/* Commits whose message names this task. Draws nothing — heading
              included — unless there are some. */}
          <TaskCommits taskId={task.id} projectId={task.projectId} />

          {/* Time Tracking */}
          {user && currentWorkspace && (
            <>
              <Separator />
              <TaskTimeTracking
                task={task}
                userId={user.id}
                workspaceId={currentWorkspace.id}
                readOnly={projectArchived}
              />
            </>
          )}

          <Separator />
          {/* A real DialogFooter. This was `flex gap-4 w-full` with two `w-full`
              buttons, so Edit and Delete each filled half the dialog edge to edge --
              nothing else in the app has an action row like that -- and Delete, a
              destructive action, occupied the rightmost slot, which is where every
              other dialog puts its confirm button. Delete now sits on the left and
              Edit takes the primary position. The deletion path is unchanged and
              still goes through the parent's confirmation. */}
          {/* Review, where the task is: submitted by whoever is doing it,
              signed off — or sent back with a note — by whoever approves. */}
          {onMoveStatus && task.status === 'IN_PROGRESS' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">Finished? Ask for it to be signed off.</p>
              <Button size="sm" onClick={() => void move('REVIEW')} disabled={moving}>
                Submit for review
              </Button>
            </div>
          )}
          {onMoveStatus && task.status === 'REVIEW' && canSignOff && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Waiting for your sign-off.</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSendingBack((v) => !v)}
                    disabled={moving}
                    aria-expanded={sendingBack}
                  >
                    Send back
                  </Button>
                  <Button size="sm" onClick={() => void move('DONE')} disabled={moving}>
                    Approve — mark Done
                  </Button>
                </div>
              </div>
              {sendingBack && (
                <div className="space-y-2">
                  <label htmlFor="send-back-note" className="text-sm font-medium">
                    What needs another look?
                  </label>
                  <Textarea
                    id="send-back-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Posted on the task as a comment (optional)"
                    rows={3}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSendingBack(false)} disabled={moving}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void move('IN_PROGRESS', note)} disabled={moving}>
                      Send back to In Progress
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {onMoveStatus && task.status === 'REVIEW' && !canSignOff && (
            <p className="rounded-lg border p-3 text-sm text-muted-foreground">
              In review: waiting for somebody who signs tasks off.
            </p>
          )}

          <DialogFooter className="sm:justify-between sm:space-x-0">
            <div className="flex gap-2">
              {onDelete && (
                <Button variant="destructive" onClick={() => onDelete(task.id)}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {onEdit && (
                <Button variant="outline" onClick={() => onEdit(task)}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
