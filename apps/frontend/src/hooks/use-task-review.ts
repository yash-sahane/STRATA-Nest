'use client';

import { toast } from 'sonner';
import { useUpdateTask } from '@/hooks/use-task';
import { useCreateTaskComment } from '@/hooks/use-task-comment';
import { useHasPermission, useHasPermissionResolved } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import type { Task, TaskStatus } from '@/types';

/**
 * Review, from wherever a task is open: submit it, approve it, or send it back
 * with a note posted on the task. Both boards open the same task dialog, so
 * both get the same three steps — under the same rules the board's drag
 * applies, which the API enforces (only a task in Review is signed off, and
 * only by somebody who may).
 */
export function useTaskReview() {
  const updateTask = useUpdateTask();
  const createComment = useCreateTaskComment();
  const canMove = useHasPermission(Permission.EDIT_ANY_TASK);
  const doneGate = useHasPermissionResolved(Permission.COMPLETE_TASK);
  const canMarkDone = doneGate.isLoading ? undefined : doneGate.allowed;

  const move = async (task: Task, status: TaskStatus, note?: string): Promise<void> => {
    await updateTask.mutateAsync({
      taskId: task.id,
      projectId: task.projectId,
      canMarkDone,
      silent: true,
      // What the step was taken against: if somebody moved the task meanwhile,
      // the API refuses rather than moving it from somewhere else.
      updates: { status, basedOn: { status: task.status } } as Parameters<
        typeof updateTask.mutateAsync
      >[0]['updates'],
    });
    if (note?.trim()) await createComment.mutateAsync({ taskId: task.id, content: note.trim() });
    toast.success(
      status === 'REVIEW'
        ? 'Submitted for review'
        : status === 'DONE'
          ? 'Approved — marked Done'
          : 'Sent back to In Progress'
    );
  };

  return {
    /** Absent when the viewer may not move tasks at all. */
    move: canMove ? move : undefined,
    canSignOff: canMarkDone === true,
  };
}
