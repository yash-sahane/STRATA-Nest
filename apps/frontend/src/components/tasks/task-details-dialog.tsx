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
import { Calendar, Clock, User, Edit, Trash2, Tag } from 'lucide-react';
import { formatDate, cn, getInitials } from '@/lib/utils';
import type { Task } from '@/types';
import { TaskDependencies } from '@/components/tasks/task-dependencies';
import { TaskComments } from '@/components/tasks/task-comments';
import { TaskTimeTracking } from '@/components/time-tracking/task-time-tracking';
import {
  useWorkspaceTasks,
  useAddTaskDependency,
  useRemoveTaskDependency,
} from '@/hooks/use-task';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTeamMembers, ROLE_CONFIG } from '@/hooks/use-team';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Helper function to parse label format "color:text"
const parseLabel = (label: string) => {
  const parts = label.split(':');
  if (parts.length === 2) {
    return { color: parts[0], text: parts[1] };
  }
  return { color: 'gray', text: label };
};

// Color mapping for label backgrounds
const labelColorMap: Record<string, string> = {
  red: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  green: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  pink: 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20',
  gray: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
};

interface TaskDetailsDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  /** Whether the viewer may change the task's dependency edges (`task:write`). */
  canEditDependencies?: boolean;
}

export function TaskDetailsDialog({
  task,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  canEditDependencies = false,
}: TaskDetailsDialogProps) {
  // Dependency edges are workspace-scoped server-side (tasks.services.ts refuses
  // only CROSS-WORKSPACE edges), and TaskDependencies renders a "Cross-project"
  // badge for them. Scoping this to the task's project made that badge dead code
  // and, worse, hid any existing cross-project dependency from both lists —
  // `allTasks.filter(t => task.blockedBy.includes(t.id))` simply dropped it.
  const { data: allTasks = [] } = useWorkspaceTasks(task?.workspaceId);
  const addDependency = useAddTaskDependency();
  const removeDependency = useRemoveTaskDependency();

  // Get user info for time tracking
  const { user } = useAuth();
  // useWorkspace() was called with no id, so its query was permanently disabled
  // and `workspace` stayed undefined — which silently hid the whole Time
  // Tracking block below. The selected workspace is what this dialog wants.
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: teamMembers = [] } = useTeamMembers(currentWorkspace?.id);

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
                  {labels.map((label, index) => {
                    const { color, text } = parseLabel(label);
                    return (
                      <Badge
                        key={index}
                        variant="outline"
                        className={cn('border', labelColorMap[color] || labelColorMap.gray)}
                      >
                        {text}
                      </Badge>
                    );
                  })}
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
                    <div
                      key={member.userId}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member.avatar} alt={member.name} />
                        <AvatarFallback className="text-xs">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{member.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{member.email}</div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {ROLE_CONFIG[member.role].label}
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
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent">
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
                        {ROLE_CONFIG[assigner.role].label}
                      </Badge>
                    </div>
                  </div>
                </>
              );
            })()}

          {/* Parent Task */}
          {task.parentTaskId && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-medium mb-2">Parent Task</h3>
                <Badge variant="outline" className="font-mono">
                  {task.parentTaskId}
                </Badge>
              </div>
            </>
          )}

          {/* Task Dependencies */}
          <Separator />
          <TaskDependencies
            task={task}
            allTasks={allTasks}
            onAddDependency={handleAddDependency}
            onRemoveDependency={handleRemoveDependency}
            canEdit={canEditDependencies}
          />

          {/* Comments — the discussion thread. Any workspace member may post;
              editing and deleting are limited to the comment's author. */}
          <Separator />
          <TaskComments taskId={task.id} workspaceId={currentWorkspace?.id} />

          {/* Time Tracking */}
          {user && currentWorkspace && (
            <>
              <Separator />
              <TaskTimeTracking
                task={task}
                userId={user.id}
                userName={user.name || 'User'}
                userEmail={user.email}
                workspaceId={currentWorkspace.id}
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
