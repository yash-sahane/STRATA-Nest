import type { Task } from '@/types';

/**
 * Whether a task is the person's: assigned to them. One answer for every place
 * that says "my tasks" — the dashboard counted assignees, the tasks page counted
 * assignees AND whoever created the task, so a manager who files work for the
 * team saw all of it as theirs on one screen and none of it on the other.
 *
 */
export function isAssignedTo(task: Pick<Task, 'assigneeIds'>, userId: string | undefined): boolean {
  if (!userId) return false;
  return (task.assigneeIds ?? []).includes(userId);
}
