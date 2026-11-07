import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  EditBasedOn,
} from '@/types';
import { toast } from 'sonner';
import { describeSaveFailure, isEditConflict } from '@/lib/api/mutation-error';
import { logger } from '@/lib/logger';

type TaskDependencyMutation = {
  taskId: string;
  targetTaskId: string;
  type: 'blocks' | 'blockedBy';
};

/**
 * A refusal raised by a client-side task gate (review-before-done, role check).
 * Thrown rather than returned so React Query treats the mutation as FAILED —
 * otherwise onSuccess would run and fire the success toast, the parent-progress
 * writes and the completion notifications for a change that never happened.
 */
class TaskGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskGateError';
  }
}

/**
 * Client-side affordance for the completion rules. The AUTHORITY is
 * `TasksService.patchStatus` on the server, which rejects a non-REVIEW → DONE
 * transition and requires `task:write`; this exists only so the user gets an
 * immediate, specific message instead of a round trip.
 *
 * `canMarkDone` is deliberately tri-state:
 *   true      — permitted, proceed
 *   false     — resolved and refused, so say so now
 *   undefined — NOT YET KNOWN (the membership request has not settled) — do not
 *               refuse. The old gate read an unresolved role as the empty string
 *               and denied, so a genuine manager dragging a card onto Done on
 *               first paint was told they were not a manager. Letting it through
 *               costs one request and the server answers correctly.
 *
 * The previous test was `role.includes('manager') || role.includes('admin')`,
 * which no custom role could satisfy, which no platform admin could pass (they
 * hold no membership row, so the role was null), and whose 'admin'/'owner' arms
 * named roles that do not exist in this system at all.
 */
function assertCanMarkDone(currentStatus: string, canMarkDone?: boolean): void {
  if (currentStatus !== 'REVIEW') {
    throw new TaskGateError(
      'Tasks must be reviewed before marking as done. Please move to Review first.'
    );
  }
  if (canMarkDone === false) {
    throw new TaskGateError('Only managers or assistant managers can mark tasks as done.');
  }
}

/**
 * The same sign-off in reverse: a finished task goes back on the board only by
 * the hand of somebody who could have finished it. Tri-state like the above —
 * an unresolved answer is left to the server.
 */
function assertCanReopen(canMarkDone?: boolean): void {
  if (canMarkDone === false) {
    throw new TaskGateError('Only managers or assistant managers can reopen a finished task.');
  }
}

/** A JSON list column as the API sends it: an array, or nothing usable. */
function arrayOf<T = string>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Single normalizer for a task row from the API, shared by every read hook.
 * The list columns are native JSON arrays (taskResponse passes them through);
 * a missing one reads as empty rather than undefined.
 */
export function normalizeTask(doc: Record<string, unknown>): Task {
  return {
    ...doc,
    labels: arrayOf(doc.labels),
    assigneeIds: arrayOf(doc.assigneeIds),
    assigneeNames: arrayOf(doc.assigneeNames),
    blockedBy: arrayOf(doc.blockedBy),
    blocks: arrayOf(doc.blocks),
  } as unknown as Task;
}

/** The parent links a task change can invalidate. */
type ParentLinks = { functionalRequirementId?: string; epicId?: string };

/**
 * Refetch everything that shows a requirement's or an epic's status and
 * progress, after a task under them changed.
 *
 * The sums themselves are the API's: it re-derives both parents as part of the
 * task write (rollups.ts in @strata/prisma), so they are already current when
 * the save returns. This file used to do the arithmetic — read the task list
 * back, add it up, PATCH the answer onto each parent — which left the parents
 * only as current as the last browser to finish those extra requests, and never
 * current at all for a change made by anything else.
 */
function invalidateParents(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  links: ParentLinks,
) {
  queryClient.invalidateQueries({ queryKey: ['functional-requirements', projectId] });
  queryClient.invalidateQueries({ queryKey: ['epics', projectId] });
  if (links.functionalRequirementId) {
    queryClient.invalidateQueries({
      queryKey: ['functional-requirement', links.functionalRequirementId],
    });
    // useTasksByFunctionalRequirement keys on ['tasks', 'functional-requirement',
    // frId], which does NOT share a prefix with the ['tasks', projectId]
    // invalidation the callers already issue — TanStack matches keys
    // element-by-element, and 'functional-requirement' !== projectId. Without
    // this the FR detail dialog's linked-task list and its progress bar stayed
    // stale after a task was created, deleted or re-pointed at another FR.
    queryClient.invalidateQueries({
      queryKey: ['tasks', 'functional-requirement', links.functionalRequirementId],
    });
  }
  if (links.epicId) {
    queryClient.invalidateQueries({ queryKey: ['epic', links.epicId] });
  }
}

export function useTasks(projectId?: string) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // listAll, not list: a single page stops at the server's default of 100
      // rows, which would silently hide tasks and make every board/analytics
      // rollup computed from this hook wrong.
      const response = await resources.listAll('tasks', [
        query.equal('projectId', projectId),
        query.orderAsc('position'),
      ]);

      return response.items.map(normalizeTask);
    },
    enabled: !!projectId,
  });
}

// Hook to get all tasks in a workspace (for dashboard)
export function useWorkspaceTasks(workspaceId?: string) {
  return useQuery({
    queryKey: ['workspace-tasks', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];

      // This hook feeds every workspace/team analytic, so it must walk all
      // pages — a single limit(1000) truncates without any warning.
      const response = await resources.listAll('tasks', [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
      ]);

      return response.items.map(normalizeTask);
    },
    enabled: !!workspaceId,
  });
}

// ? NEW: Get tasks linked to a specific Functional Requirement
export function useTasksByFunctionalRequirement(functionalRequirementId?: string) {
  return useQuery({
    queryKey: ['tasks', 'functional-requirement', functionalRequirementId],
    queryFn: async () => {
      if (!functionalRequirementId) return [];

      const response = await resources.listAll('tasks', [
        query.equal('functionalRequirementId', functionalRequirementId),
        query.orderAsc('position'),
      ]);

      return response.items.map(normalizeTask);
    },
    enabled: !!functionalRequirementId,
  });
}

/**
 * Tasks by id, wherever they are in the workspace: a task's dependencies and
 * its parent. They used to be found in a download of every task in the
 * workspace, made each time a task was opened.
 */
export function useTasksByIds(ids: readonly string[]) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  return useQuery({
    queryKey: ['tasks', 'by-ids', unique],
    queryFn: async () => {
      const response = await resources.listAll('tasks', [query.in('id', unique)]);
      return response.items.map(normalizeTask);
    },
    enabled: unique.length > 0,
  });
}

/** Tasks in a workspace whose title, id or description holds `term` — the server searches. */
export function useTaskSearch(workspaceId: string | undefined, term: string) {
  const text = term.trim();
  return useQuery({
    queryKey: ['tasks', 'search', workspaceId, text],
    queryFn: async () => {
      const response = await resources.list('tasks', [
        query.equal('workspaceId', workspaceId),
        query.text(text),
        query.orderDesc('updatedAt'),
        query.limit(20),
      ]);
      return response.items.map(normalizeTask);
    },
    enabled: Boolean(workspaceId),
    placeholderData: (previous) => previous,
  });
}

/** The tasks assigned to one person in a workspace. */
export function useTasksAssignedTo(workspaceId?: string, userId?: string) {
  return useQuery({
    queryKey: ['tasks', 'assigned', workspaceId, userId],
    queryFn: async () => {
      const response = await resources.listAll('tasks', [
        query.equal('workspaceId', workspaceId),
        query.equal('assigneeId', userId),
        query.orderDesc('updatedAt'),
      ]);
      return response.items.map(normalizeTask);
    },
    enabled: Boolean(workspaceId && userId),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      title: string;
      description?: string;
      status: TaskStatus;
      priority: TaskPriority;
      assigneeIds?: string[];
      dueDate?: string;
      estimatedHours?: number;
      sprintId?: string;
      epicId?: string;
      functionalRequirementId?: string; // NEW: Link to FR
      parentTaskId?: string;
      labels?: string[];
    }) => {
      // DEFENSIVE: Validate workspaceId is provided
      if (!data.workspaceId) {
        throw new Error('Workspace id is required. Please select a workspace first.');
      }

      // No id and no position: the server mints the id from the task's
      // requirement or project, and puts the card at the end of the board.
      const taskData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        title: data.title,
        description: data.description || '',
        status: data.status,
        priority: data.priority,
        // Their names, who assigned them and who created the task are the
        // server's: it resolves them from the caller and the user table.
        assigneeIds: data.assigneeIds || [],
        dueDate: data.dueDate,
        // NOT `|| 0`: that turned a blank Estimated Hours field into a stored 0,
        // which every surface then printed as "0h" (and made the Hours sort read
        // a real estimate where there was none). TasksService.create writes
        // `dto.estimatedHours ?? null`, so leaving it undefined is exactly how
        // "no estimate" survives to the row as NULL.
        estimatedHours: data.estimatedHours,
        sprintId: data.sprintId,
        epicId: data.epicId,
        functionalRequirementId: data.functionalRequirementId, // NEW: Store FR link
        parentTaskId: data.parentTaskId,
        labels: data.labels || [],
      };

      const response = await resources.create('tasks',
        taskData
      );

      return response as unknown as Task;
    },
    onSuccess: async (createdTask, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // A new task changes its requirement's and epic's totals. Read the links
      // off what was SAVED: a task filed under a requirement is given that
      // requirement's epic by the API, whatever the form sent.
      if (createdTask.functionalRequirementId || createdTask.epicId) {
        invalidateParents(queryClient, variables.projectId, {
          functionalRequirementId: createdTask.functionalRequirementId,
          epicId: createdTask.epicId,
        });
      }

      // The people this concerns are told by the API as part of the write itself
      // (WorkNotificationSubscriber) — not by this browser afterwards.
      toast.success('Task created');
    },
    onError: (error: Error) => {
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to create task'
      );
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      taskId: string;
      projectId: string;
      /**
       * `placeBefore` puts a dragged card in front of that card ('' = the bottom
       * of its column); the API works out its position — see useUpdateTaskStatus.
       * A `position` sent with it only shows the drop until the API answers.
       */
      updates: EditBasedOn<Partial<Task>> & { placeBefore?: string };
      /** Tri-state capability answer — see `assertCanMarkDone`. */
      canMarkDone?: boolean;
      /** Suppress the success toast (bulk callers toast once for the batch). */
      silent?: boolean;
      /**
       * The caller measures a retry against the task as it now is when somebody
       * else saved first, so saving again is a way through — and the refusal's
       * toast says so.
       */
      retriesOnConflict?: boolean;
    }) => {
      const { taskId, updates, canMarkDone } = data;

      // Affordance only; TasksService.patchStatus is the enforcement point.
      // Both directions, as the board's move checks them: reopening a finished
      // task from the edit dialog went to the server and came back refused.
      if (updates.status !== undefined) {
        const currentTask = await resources.get<Task>('tasks', taskId);
        if (updates.status === 'DONE' && currentTask.status !== 'DONE') {
          assertCanMarkDone(currentTask.status, canMarkDone);
        } else if (updates.status !== 'DONE' && currentTask.status === 'DONE') {
          assertCanReopen(canMarkDone);
        }
      }

      // labels and assigneeIds pass through as the native arrays the API
      // validates. Names and "assigned by" follow on the server.
      const response = await resources.update('tasks', taskId, updates);

      return response as unknown as Task;
    },
    onMutate: async (data) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks', data.projectId] });

      // Snapshot the previous value
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', data.projectId]);

      // Optimistically update the cache
      queryClient.setQueryData<Task[]>(['tasks', data.projectId], (old) => {
        if (!old) return old;
        // `basedOn` addresses the save; it is not a field of the task, and writing it
        // into the cached row would leave a phantom property on every optimistically
        // updated task until the next refetch. Nor is `placeBefore`.
        const { basedOn: _ignored, placeBefore: _placement, ...fields } = data.updates;
        return old.map((task) => (task.id === data.taskId ? { ...task, ...fields } : task));
      });

      return { previousTasks };
    },
    onError: (error: Error, variables, context) => {
      // Rollback on error
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', variables.projectId], context.previousTasks);
      }
      // A refused gate is not a failure of the app — keep the softer tone.
      if (error instanceof TaskGateError) {
        toast.warning(error.message);
        return;
      }
      const { title, description } = describeSaveFailure(error, 'Failed to update task');
      if (variables.retriesOnConflict && isEditConflict(error)) {
        toast.error(title, {
          description: `${description} Or save again to replace theirs with yours.`,
        });
        return;
      }
      toast.error(title, { description });
    },
    // Refused or not, the board reads the task again: a refusal's rollback puts
    // back the snapshot taken before the save, which is not what the server
    // holds when the refusal was "somebody else changed it first".
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
    },
    onSuccess: async (updatedTask, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // Refresh the FR/Epic rollups (progress AND the auto-calculated FR status,
      // which used to be recomputed here by a second, slightly different copy of
      // the same rules). Re-pointing a task at another FR/Epic invalidates BOTH
      // ends, so the previous parents are refreshed too.
      // The optimistic snapshot only exists when ['tasks', projectId] happened
      // to be cached — it is NOT for a task opened from the dashboard, calendar
      // or team page (those read ['workspace-tasks', wsId]). Falling back to the
      // single-task cache keeps the OLD parent's rollup from going stale
      // forever when a task is re-pointed at a different FR/Epic.
      const previousTask =
        context?.previousTasks?.find((t) => t.id === variables.taskId) ??
        queryClient.getQueryData<Task>(['task', variables.taskId]) ??
        queryClient
          .getQueryData<Task[]>(['workspace-tasks', updatedTask.workspaceId])
          ?.find((t) => t.id === variables.taskId);
      const linkChanged =
        variables.updates.functionalRequirementId !== undefined ||
        variables.updates.epicId !== undefined;
      if (variables.updates.status || linkChanged) {
        const parents: ParentLinks[] = [
          {
            functionalRequirementId: updatedTask.functionalRequirementId,
            epicId: updatedTask.epicId,
          },
        ];
        if (
          linkChanged &&
          previousTask &&
          (previousTask.functionalRequirementId !== updatedTask.functionalRequirementId ||
            previousTask.epicId !== updatedTask.epicId)
        ) {
          parents.push({
            functionalRequirementId: previousTask.functionalRequirementId,
            epicId: previousTask.epicId,
          });
        }
        for (const links of parents) {
          invalidateParents(queryClient, variables.projectId, links);
        }
      }

      // The people this concerns are told by the API as part of the write itself
      // (WorkNotificationSubscriber) — not by this browser afterwards.
      if (!variables.silent) {
        toast.success('Task updated');
      }
    },
  });
}

/**
 * A card dropped on the board: into another column (`status`), or only to
 * another place in its own (no `status`).
 *
 * ONE request, whatever the column holds. `placeBefore` names the card it now
 * sits in front of ('' for the bottom) and the API places it between its new
 * neighbours as they are stored. The board used to renumber the column itself —
 * this move, then a PATCH for every other card in it, all at once — so a long
 * column, or two drags in a minute, ran into the API's request limit and left
 * the column half renumbered, with duplicates; and every one of those writes
 * went into the activity trail. `position` is only the drop as the board shows
 * it until the answer comes back.
 */
export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      taskId: string;
      projectId: string;
      /** Left out for a move within the column it is already in. */
      status?: TaskStatus;
      placeBefore: string;
      position: number;
      /** Tri-state capability answer — see `assertCanMarkDone`. */
      canMarkDone?: boolean;
    }) => {
      const { taskId, status, placeBefore, canMarkDone } = data;

      // Affordance only; TasksService.patchStatus is the enforcement point.
      // A move that keeps the status has nothing to gate, and no read to make.
      if (status !== undefined) {
        const currentTask = await resources.get<Task>('tasks', taskId);
        if (status === 'DONE' && currentTask.status !== 'DONE') {
          assertCanMarkDone(currentTask.status, canMarkDone);
        } else if (status !== 'DONE' && currentTask.status === 'DONE') {
          assertCanReopen(canMarkDone);
        }
      }

      const response = await resources.update(
        'tasks',
        taskId,
        status === undefined ? { placeBefore } : { status, placeBefore }
      );

      return response as unknown as Task;
    },
    onMutate: async (data) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks', data.projectId] });

      // Snapshot the previous value
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', data.projectId]);

      // Optimistically update the cache
      queryClient.setQueryData<Task[]>(['tasks', data.projectId], (old) => {
        if (!old) return old;
        return old.map((task) =>
          task.id === data.taskId
            ? { ...task, status: data.status ?? task.status, position: data.position }
            : task
        );
      });

      return { previousTasks };
    },
    onError: (error: Error, variables, context) => {
      // Rollback on error
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', variables.projectId], context.previousTasks);
      }
      if (error instanceof TaskGateError) {
        toast.warning(error.message);
        return;
      }
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to update task status'
      );
    },
    // As for an edit: a refused move rolls back to the snapshot, not to the server.
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
    },
    onSuccess: async (updatedTask, variables) => {
      logger.debug('useUpdateTaskStatus onSuccess - updatedTask', { updatedTask });

      // Silent success, already updated optimistically
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // The move changed its requirement's and epic's totals on the server —
      // unless it only changed the card's place in its column.
      if (variables.status !== undefined) {
        invalidateParents(queryClient, variables.projectId, updatedTask);
      }

      // The people a move concerns — assignees, reviewers, whoever closes
      // the sprint — are told by the API as part of the write itself
      // (WorkNotificationSubscriber) — not by this browser afterwards.
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { taskId: string; projectId: string }) => {
      await resources.remove('tasks', data.taskId);
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });

      // The API took the task out of its requirement's and epic's totals. Which
      // ones those were is not known once the row is gone, so every view of a
      // single requirement or epic is refetched along with the project's lists.
      invalidateParents(queryClient, data.projectId, {});
      queryClient.invalidateQueries({ queryKey: ['functional-requirement'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'functional-requirement'] });
      queryClient.invalidateQueries({ queryKey: ['epic'] });

      toast.success('Task deleted');
    },
    onError: (error: Error) => {
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to delete task'
      );
    },
  });
}

export function useAddTaskDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TaskDependencyMutation) => {
      // One transactional call, not two PATCHes: the server writes both halves
      // of the edge together and refuses one that would close a cycle. Writing
      // them separately from here could leave `blockedBy` and `blocks` out of
      // sync if the second request failed, and no cycle check ran server-side.
      await restClient.post(`/api/v1/tasks/${data.taskId}/dependencies/`, {
        targetTaskId: data.targetTaskId,
        type: data.type,
      });

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', data.taskId] });
      queryClient.invalidateQueries({ queryKey: ['task', data.targetTaskId] });
      toast.success('Task dependency has been created successfully.');
    },
    onError: (error: Error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });
}

export function useRemoveTaskDependency() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TaskDependencyMutation) => {
      // Same reasoning as the add: the server clears both halves of the edge in
      // one transaction, so a failure can no longer strand a one-sided link.
      await restClient.delete(
        `/api/v1/tasks/${data.taskId}/dependencies/${data.targetTaskId}/`,
        { params: { type: data.type } },
      );

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', data.taskId] });
      queryClient.invalidateQueries({ queryKey: ['task', data.targetTaskId] });
      toast.success('Task dependency has been removed successfully.');
    },
    onError: (error: Error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });
}

