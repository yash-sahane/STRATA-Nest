import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import type { Task, TaskStatus, TaskPriority, FunctionalRequirement } from '@/types';
import { toast } from 'sonner';
import { createBulkNotifications } from '@/hooks/use-notification';
import { deriveEpicMetrics } from '@/hooks/use-epic';
import { calculateFRStatusFromTasks } from '@/hooks/use-functional-requirement';
import { generateTaskId, generateTaskIdWithoutFR } from '@/lib/hierarchy-id-generator';
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

function normalizeIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

// The API returns labels/attachments/customFields as native JSON (Prisma `Json`
// columns passed straight through by taskResponse). Legacy Appwrite rows stored
// them as JSON strings, so keep parsing those — but the native shape must win,
// otherwise every real value is replaced by an empty literal.
function normalizeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Single normalizer for a task row from the API, shared by every read hook. */
export function normalizeTask(doc: Record<string, unknown>): Task {
  return {
    ...doc,
    labels: normalizeJsonArray(doc.labels),
    attachments: normalizeJsonArray(doc.attachments),
    customFields: normalizeJsonObject(doc.customFields),
    assigneeIds: normalizeIdList(doc.assigneeIds),
    // ? assignedTo and assignedToNames are array types in DB - use directly
    assignedTo: Array.isArray(doc.assignedTo) ? doc.assignedTo : normalizeIdList(doc.assigneeIds),
    assignedToNames: Array.isArray(doc.assignedToNames) ? doc.assignedToNames : [],
    blockedBy: normalizeIdList(doc.blockedBy),
    blocks: normalizeIdList(doc.blocks),
  } as unknown as Task;
}

/** The parent links a task change can invalidate. */
type ParentLinks = { functionalRequirementId?: string; epicId?: string };

/**
 * Recompute the FR's and Epic's rollups from their CURRENT task sets.
 *
 * Called after every create, status change and delete — not just status edits.
 * The FR dialog labels Status "(Auto-calculated from tasks)", so it has to
 * track task creation and deletion too; before this, linking the first task to
 * an FR or deleting its last one left both the progress bar and the status
 * frozen at their previous values.
 *
 * `calculateFRStatusFromTasks` is the FR module's own definition of that
 * mapping — shared rather than re-derived so the two can never disagree.
 *
 * Exported because `recalculateFRRollup` in use-functional-requirement.ts is a
 * second copy of the FR half of this (the sprint-assignment branch creates its
 * task with `resources.create`, bypassing useCreateTask). That copy should call
 * this instead; it is exported here rather than moved next to
 * `calculateFRStatusFromTasks` only because this file does not own that one.
 */
export async function updateParentProgress(task: ParentLinks) {
  logger.debug('updateParentProgress called with task', {
    functionalRequirementId: task.functionalRequirementId,
    epicId: task.epicId,
  });

  // The two rollups are INDEPENDENT and are attempted independently.
  //
  // They used to share one try/catch, so any failure on the functional
  // requirement — most often a 403, because the delivery roles can move a task
  // but not write a requirement — threw before the epic write was even issued.
  // A developer dragging a card to Done left BOTH the requirement and the epic
  // frozen, and the epic write was never the one that was refused.
  let failed = false;

  try {
    // Update FR progress if task is linked to an FR
    if (task.functionalRequirementId) {
      // Get all tasks for this FR
      const frTasks = await resources.listAll('tasks', [
        query.equal('functionalRequirementId', task.functionalRequirementId),
      ]);

      const frItems = frTasks.items as unknown as Task[];
      const completedTasks = frItems.filter((t) => t.status === 'DONE').length;
      // An emptied FR is 0%, not "keep the last number you saw".
      const progress = frItems.length > 0 ? Math.round((completedTasks / frItems.length) * 100) : 0;
      // The FR's CURRENT status is load-bearing input, not decoration:
      // calculateFRStatusFromTasks needs it to keep DEPLOYED terminal (a
      // shipped FR must not fall back to TESTED when a teammate edits one of
      // its tasks) and to leave a task-less FR where a human put it instead of
      // snapping it to DRAFT.
      const currentFR = (await resources
        .get('functional_requirements', task.functionalRequirementId)
        .catch(() => null)) as { status?: FunctionalRequirement['status'] } | null;
      const status = calculateFRStatusFromTasks(frItems, currentFR?.status);

      logger.debug('Updating FR progress', {
        frId: task.functionalRequirementId,
        totalTasks: frItems.length,
        completedTasks,
        progress,
        status,
      });

      await resources.update('functional_requirements', task.functionalRequirementId, {
        progress,
        status,
      });
    }
  } catch (error) {
    logger.error('Failed to update functional requirement progress', { error });
    failed = true;
  }

  try {
    // Update Epic progress if task is linked to an Epic
    if (task.epicId) {
      // Get all tasks for this Epic
      const epicTasks = await resources.listAll('tasks', [
        query.equal('epicId', task.epicId),
      ]);

      const epicItems = epicTasks.items as unknown as Task[];
      // deriveEpicMetrics is the app's ONE definition of an epic's rollup — the
      // same function the /epics cards, the stat tiles and the epic dialog
      // render, and the same rule EpicsService.deriveRollup applies server-side.
      //
      // The inline rule that used to live here derived status from the ROUNDED
      // percentage: `progress === 100 ? 'DONE' : ...`. Math.round(240/241*100)
      // is 100, so an epic with one task still open was written
      // {progress:100, status:'DONE'} and then rendered "In Progress" by the
      // very cards above it. "Every task is done" is a count comparison
      // (completed === total), never a percentage.
      const { progress, status: epicStatus, totalTasks, completedTasks } =
        deriveEpicMetrics(epicItems);

      // Same rule as the FR above: an epic whose last task was just deleted has
      // no task set to derive a status from, so writing 'TODO' would silently
      // undo whatever a human set. Progress still goes to 0.
      if (totalTasks === 0) {
        // Progress still goes to 0, but there is no task set to derive a status
        // from. Fall through rather than returning: the failure tail below is
        // shared, and an early return used to skip it.
        await resources.update('epics', task.epicId, { progress });
      } else {
        logger.debug('Updating Epic progress', {
          epicId: task.epicId,
          totalTasks,
          completedTasks,
          progress,
          epicStatus,
        });

        await resources.update('epics', task.epicId, {
          progress,
          status: epicStatus,
        });
      }
    }
  } catch (error) {
    logger.error('Failed to update epic progress', { error });
    failed = true;
  }

  if (failed) {
    // Still don't throw: the task write itself already succeeded, and the
    // rollup is derived data that the next successful recompute repairs.
    // But it must not be SILENT either — a 403 on the FR/Epic write used to
    // leave the progress bar quietly frozen with nothing on screen to say so.
    // A stable id collapses a burst of failures (one per task in a bulk edit)
    // into a single toast.
    toast.warning('Epic / requirement progress could not be updated.', {
      id: 'parent-rollup-failed',
      description: 'Your task change was saved — only the rolled-up progress is stale.',
    });
  }
}

/** Invalidate everything that reads an FR/Epic rollup after the writes above. */
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

export function useTask(taskId?: string) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      if (!taskId) return null;

      const response = await resources.get('tasks', taskId);

      return normalizeTask(response);
    },
    enabled: !!taskId,
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

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      projectCode: string;
      title: string;
      description?: string;
      status: TaskStatus;
      priority: TaskPriority;
      assigneeIds?: string[];
      createdBy: string;
      createdByName?: string;
      assignedBy?: string;
      assignedByName?: string;
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

      // Get current tasks for counting. listAll: a truncated first page would
      // freeze the sequence counter and re-issue hierarchy ids that exist.
      const existingTasks = await resources.listAll('tasks', [
        query.equal('projectId', data.projectId),
      ]);

      let hierarchyId: string;

      if (data.parentTaskId) {
        // Subtask: inherit parent's hierarchy
        const parentTask = await resources.get('tasks', data.parentTaskId
        );
        const parentHierarchyId = parentTask.hierarchyId;

        const siblings = existingTasks.items.filter(
          (t) => t.parentTaskId === data.parentTaskId
        );
        // Advance past the HIGHEST existing suffix, not the sibling count:
        // deleting a subtask would otherwise re-issue an id still in use.
        const highestSuffix = siblings.reduce((max, t) => {
          const n = Number.parseInt(String(t.hierarchyId ?? '').split('.').pop() ?? '', 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        const subtaskNumber = (highestSuffix + 1).toString().padStart(2, '0');
        hierarchyId = `${parentHierarchyId}.${subtaskNumber}`;
      } else {
        // Top-level task: generate from FR ? Sprint ? Task hierarchy
        const topLevelTasks = existingTasks.items.filter((t) => !t.parentTaskId);
        // Same reasoning as subtasks: never go backwards past an id already issued.
        // The trailing group is the sequence number in ALL THREE shapes this
        // function emits: `PTES-LOG-01` and `ABC-FR-01-API-02` from
        // hierarchy-id-generator, AND `ABC-T01` from the three plain-project
        // fallbacks below. `/-(\d+)$/` missed the last of those — the `-` is
        // followed by `T`, not a digit — so for a project whose tasks are all
        // `-T##` the reduce returned 0, the sequence fell back to
        // `topLevelTasks.length`, and deleting any task re-issued a live id.
        const highestTaskNumber = topLevelTasks.reduce((max, t) => {
          const n = Number.parseInt(/-T?(\d+)$/.exec(String(t.hierarchyId ?? ''))?.[1] ?? '', 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        const taskSequence = Math.max(topLevelTasks.length, highestTaskNumber) + 1;

        if (data.functionalRequirementId && data.sprintId) {
          // Full hierarchy: FR ? Sprint ? Task
          try {
            const [fr, sprint] = await Promise.all([
              resources.get('functional_requirements', data.functionalRequirementId
              ),
              resources.get('sprints', data.sprintId),
            ]);

            hierarchyId = generateTaskId(
              fr.hierarchyId, // FR hierarchy (e.g., PTE-RAU-EAU-FRL-01)
              sprint.name,
              data.title,
              taskSequence
            );
          } catch (error) {
            // Fallback if FR/Sprint not found
            logger.error('Error fetching FR/Sprint', { error });
            hierarchyId = `${data.projectCode}-T${taskSequence.toString().padStart(2, '0')}`;
          }
        } else if (data.sprintId) {
          // Sprint but no FR: Project ? Sprint ? Task
          try {
            const [sprint, project] = await Promise.all([
              resources.get('sprints', data.sprintId),
              resources.get('projects', data.projectId),
            ]);

            hierarchyId = generateTaskIdWithoutFR(
              data.projectCode,
              project.name,
              sprint.name,
              data.title,
              taskSequence
            );
          } catch (error) {
            logger.error('Error fetching Sprint', { error });
            hierarchyId = `${data.projectCode}-T${taskSequence.toString().padStart(2, '0')}`;
          }
        } else {
          // No FR or Sprint: Simple project task
          hierarchyId = `${data.projectCode}-T${taskSequence.toString().padStart(2, '0')}`;
        }
      }

      const taskData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        hierarchyId,
        title: data.title,
        description: data.description || '',
        status: data.status,
        priority: data.priority,
        assigneeIds: data.assigneeIds || [],
        assignedTo: data.assigneeIds || [],
        assignedToNames: [],
        assignedBy: data.assignedBy || data.createdBy, // Who assigned (defaults to creator)
        assignedByName: data.assignedByName || data.createdByName || '', // Assignor name
        createdBy: data.createdBy,
        createdByName: data.createdByName || '', // Creator name for display
        dueDate: data.dueDate,
        // NOT `|| 0`: that turned a blank Estimated Hours field into a stored 0,
        // which every surface then printed as "0h" (and made the Hours sort and the
        // time-efficiency analytics read a real estimate where there was none).
        // TasksService.create writes `dto.estimatedHours ?? null`, so leaving it
        // undefined is exactly how "no estimate" survives to the row as NULL.
        estimatedHours: data.estimatedHours,
        actualHours: 0,
        sprintId: data.sprintId,
        epicId: data.epicId,
        functionalRequirementId: data.functionalRequirementId, // NEW: Store FR link
        parentTaskId: data.parentTaskId,
        labels: data.labels || [],
        attachments: [],
        customFields: {},
        position: existingTasks.total,
        blockedBy: [],
        blocks: [],
      };

      const response = await resources.create('tasks', id.unique(),
        taskData
      );

      return response as unknown as Task;
    },
    onSuccess: async (createdTask, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // A new task changes its FR's/Epic's denominator (and can flip an empty
      // FR out of DRAFT), so the rollups have to be recomputed on create too.
      if (variables.functionalRequirementId || variables.epicId) {
        const links = {
          functionalRequirementId: variables.functionalRequirementId,
          epicId: variables.epicId,
        };
        await updateParentProgress(links);
        invalidateParents(queryClient, variables.projectId, links);
      }

      // Send notifications to assignees
      if (variables.assigneeIds && variables.assigneeIds.length > 0) {
        try {
          // Fetch project name for notification
          let projectName = variables.projectId;
          try {
            const project = await resources.get('projects', variables.projectId
            );
            projectName = project.name;
          } catch (error) {
            logger.error('Failed to fetch project name', { error });
          }

          // Get assigner name
          const assignerName = variables.createdByName || variables.assignedByName || 'Team Member';

          // Send bulk notifications to all assignees
          await createBulkNotifications({
            workspaceId: variables.workspaceId,
            userIds: variables.assigneeIds,
            type: 'TASK_ASSIGNED',
            data: {
              taskId: createdTask.id,
              taskTitle: variables.title,
              taskHierarchyId: createdTask.hierarchyId,
              projectName,
              assignerName,
              priority: variables.priority,
              dueDate: variables.dueDate,
              entityType: 'TASK',
            },
          });
        } catch (error) {
          // Don't fail task creation if notification fails
          logger.error('Failed to send assignment notifications', { error });
        }
      }

      toast.success('Task created successfully!');
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
      updates: Partial<Task>;
      /** Tri-state capability answer — see `assertCanMarkDone`. */
      canMarkDone?: boolean;
      /** Suppress the success toast (bulk callers toast once for the batch). */
      silent?: boolean;
    }) => {
      const { taskId, updates, canMarkDone } = data;

      // Affordance only; TasksService.patchStatus is the enforcement point.
      if (updates.status === 'DONE') {
        const currentTask = await resources.get('tasks', taskId);
        if (currentTask.status !== 'DONE') {
          assertCanMarkDone(currentTask.status, canMarkDone);
        }
      }

      // labels/assigneeIds/attachments/customFields pass through unchanged —
      // the API validates them as native arrays/objects.
      const processedUpdates: any = { ...updates };

      // ? Handle assignedTo and assignedToNames as arrays (not strings)
      // These fields are array types in the database
      if (updates.assignedTo !== undefined) {
        processedUpdates.assignedTo = Array.isArray(updates.assignedTo) ? updates.assignedTo : [];
      }
      if (updates.assignedToNames !== undefined) {
        processedUpdates.assignedToNames = Array.isArray(updates.assignedToNames)
          ? updates.assignedToNames
          : [];
      }

      // ? Handle assignedBy and assignedByName (who assigned the task)
      // These should be updated when task assignment changes
      if (updates.assignedBy !== undefined) {
        processedUpdates.assignedBy = updates.assignedBy;
      }
      if (updates.assignedByName !== undefined) {
        processedUpdates.assignedByName = updates.assignedByName;
      }

      const response = await resources.update('tasks', taskId,
        processedUpdates
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
        return old.map((task) => (task.id === data.taskId ? { ...task, ...data.updates } : task));
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
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to update task'
      );
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
          await updateParentProgress(links);
          invalidateParents(queryClient, variables.projectId, links);
        }
      }

      // Create notifications for task updates
      const { updates } = variables;

      // Fetch project name for notifications
      let projectName = updatedTask.projectId;
      try {
        const project = await resources.get('projects', updatedTask.projectId
        );
        projectName = project.name;
      } catch (error) {
        // Fallback to projectId if fetch fails
        logger.error('Failed to fetch project name', { error });
      }

      // Get assigner name from updates context
      const assignerName = updates.assignedByName || updatedTask.createdByName || 'Team Member';

      // Notification for task assignment changes
      if (updates.assigneeIds) {
        // `previousTask` above is the snapshot captured in onMutate BEFORE the
        // optimistic cache update — the live cache already has the new assignees.
        if (previousTask) {
          // Ensure assigneeIds is an array
          const updatesAssignees = Array.isArray(updates.assigneeIds)
            ? updates.assigneeIds
            : typeof updates.assigneeIds === 'string'
              ? [updates.assigneeIds]
              : [];

          const previousAssignees = Array.isArray(previousTask.assigneeIds)
            ? previousTask.assigneeIds
            : [];

          const newAssignees = updatesAssignees.filter(
            (id) => id && typeof id === 'string' && !previousAssignees.includes(id)
          );

          // Notify newly assigned users
          if (newAssignees.length > 0) {
            await createBulkNotifications({
              workspaceId: updatedTask.workspaceId || '',
              userIds: newAssignees,
              type: 'TASK_ASSIGNED',
              data: {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                projectId: updatedTask.projectId,
                projectName: projectName,
                assignerName: assignerName,
                entityType: 'TASK',
              },
            });
          }
        }
      }

      // Notification for priority changes
      if (updates.priority) {
        // Ensure assignees is always an array
        const assigneesData = updatedTask.assigneeIds || [];
        const assignees = Array.isArray(assigneesData)
          ? assigneesData
          : typeof assigneesData === 'string'
            ? [assigneesData]
            : [];

        const validAssignees = assignees.filter(
          (id) => id && typeof id === 'string' && id.trim() !== ''
        );

        if (validAssignees.length > 0) {
          await createBulkNotifications({
            workspaceId: updatedTask.workspaceId || '',
            userIds: validAssignees,
            type: 'TASK_PRIORITY_CHANGED',
            data: {
              taskId: updatedTask.id,
              taskTitle: updatedTask.title,
              projectId: updatedTask.projectId,
              projectName: projectName,
              changerName: assignerName,
              newPriority: updates.priority,
              entityType: 'TASK',
            },
          });
        }
      }

      if (!variables.silent) {
        toast.success('Task updated successfully!');
      }
    },
  });
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      taskId: string;
      projectId: string;
      status: TaskStatus;
      position: number;
      /** Tri-state capability answer — see `assertCanMarkDone`. */
      canMarkDone?: boolean;
    }) => {
      const { taskId, status, position, canMarkDone } = data;

      const currentTask = await resources.get('tasks', taskId);

      // Affordance only; TasksService.patchStatus is the enforcement point.
      if (status === 'DONE' && currentTask.status !== 'DONE') {
        assertCanMarkDone(currentTask.status, canMarkDone);
      }

      const response = await resources.update('tasks', taskId, {
        status,
        position,
      });

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
            ? { ...task, status: data.status, position: data.position }
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
    onSuccess: async (updatedTask, variables) => {
      logger.debug('useUpdateTaskStatus onSuccess - updatedTask', { updatedTask });

      // Silent success, already updated optimistically
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // ? Update FR and Epic progress/status based on task completion
      await updateParentProgress(updatedTask);
      invalidateParents(queryClient, variables.projectId, updatedTask);

      // Fetch project name for notifications
      let projectName = updatedTask.projectId;
      try {
        const project = await resources.get('projects', updatedTask.projectId
        );
        projectName = project.name;
      } catch (error) {
        logger.error('Failed to fetch project name', { error });
      }

      // Create notification if task was completed - notify managers for review.
      // Gate on the RESOLVED task, not the requested status: a transition the
      // server did not apply must not fan out completion notifications.
      if (updatedTask.status === 'DONE') {
        try {
          // query workspace members to find managers/admins
          const membersResponse = await resources.listAll('workspace_members', [query.equal('workspaceId', updatedTask.workspaceId)]
          );

          // Filter for managers and admins
          const managers = membersResponse.items
            .filter((member: any) => {
              const role = member.role?.toLowerCase() || '';
              return role.includes('manager') || role.includes('admin') || role === 'owner';
            })
            .map((member: any) => member.userId)
            .filter((userId: string) => userId && userId !== updatedTask.createdBy); // Exclude the completer

          // Send notifications to managers for review
          if (managers.length > 0) {
            await createBulkNotifications({
              workspaceId: updatedTask.workspaceId || '',
              userIds: managers,
              type: 'TASK_COMPLETED',
              data: {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                taskHierarchyId: updatedTask.hierarchyId,
                projectId: updatedTask.projectId,
                projectName: projectName,
                completerName: updatedTask.createdByName || 'Team Member',
                entityType: 'TASK',
              },
            });
          }

          // ? Notify assignees that their task has been reviewed and marked as done
          const assigneesData = updatedTask.assigneeIds || updatedTask.assignedTo || [];
          const assignees = Array.isArray(assigneesData)
            ? assigneesData
            : typeof assigneesData === 'string'
              ? JSON.parse(assigneesData)
              : [];
          const validAssignees = assignees.filter(
            (id: string) => id && typeof id === 'string' && id.trim() !== ''
          );

          if (validAssignees.length > 0) {
            await createBulkNotifications({
              workspaceId: updatedTask.workspaceId || '',
              userIds: validAssignees,
              type: 'TASK_REVIEWED_DONE',
              data: {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                taskHierarchyId: updatedTask.hierarchyId,
                projectId: updatedTask.projectId,
                projectName: projectName,
                reviewerName: 'Manager', // Could be enhanced to pass actual reviewer name
                entityType: 'TASK',
              },
            });
          }
        } catch (error) {
          // Don't fail status update if notification fails
          logger.error('Failed to send completion notifications', { error });
        }
      }

      // ? Notify managers when task moves to REVIEW
      if (updatedTask.status === 'REVIEW') {
        try {
          const membersResponse = await resources.listAll('workspace_members', [query.equal('workspaceId', updatedTask.workspaceId)]
          );

          // Filter for managers and assistant managers
          const managers = membersResponse.items
            .filter((member: any) => {
              const role = member.role?.toLowerCase() || '';
              return role.includes('manager') || role.includes('admin') || role === 'owner';
            })
            .map((member: any) => member.userId)
            .filter((userId: string) => userId && userId.trim());

          if (managers.length > 0) {
            await createBulkNotifications({
              workspaceId: updatedTask.workspaceId || '',
              userIds: managers,
              type: 'TASK_REVIEW_REQUESTED',
              data: {
                taskId: updatedTask.id,
                taskTitle: updatedTask.title,
                taskHierarchyId: updatedTask.hierarchyId,
                projectId: updatedTask.projectId,
                projectName: projectName,
                submitterName: updatedTask.createdByName || 'Team Member',
                entityType: 'TASK',
              },
            });
          }
        } catch (error) {
          logger.error('Failed to send review notification', { error });
        }
      }

      // ? Check if all sprint tasks are complete - notify managers to close sprint
      if (updatedTask.status === 'DONE' && updatedTask.sprintId) {
        try {
          const sprintTasks = await resources.listAll('tasks', [
            query.equal('sprintId', updatedTask.sprintId),
          ]);

          const allTasksDone = sprintTasks.items.every((t: any) => t.status === 'DONE');

          if (allTasksDone && sprintTasks.total > 0) {
            const membersResponse = await resources.listAll('workspace_members', [query.equal('workspaceId', updatedTask.workspaceId)]
            );

            const managers = membersResponse.items
              .filter((member: any) => {
                const role = member.role?.toLowerCase() || '';
                return role.includes('manager') || role.includes('admin') || role === 'owner';
              })
              .map((member: any) => member.userId)
              .filter((userId: string) => userId && userId.trim());

            if (managers.length > 0) {
              // Get sprint name
              const sprint = await resources.get('sprints', updatedTask.sprintId
              );

              await createBulkNotifications({
                workspaceId: updatedTask.workspaceId || '',
                userIds: managers,
                type: 'SPRINT_READY_TO_CLOSE',
                data: {
                  sprintId: updatedTask.sprintId,
                  sprintName: sprint.name,
                  totalTasks: sprintTasks.total,
                  projectId: updatedTask.projectId,
                  projectName: projectName,
                  entityType: 'SPRINT',
                },
              });
            }
          }
        } catch (error) {
          logger.error('Failed to check sprint completion', { error });
        }
      }

      // Create notification for status changes (except to DONE and REVIEW, already handled)
      if (updatedTask.status !== 'DONE' && updatedTask.status !== 'REVIEW') {
        // Ensure assignees is always an array
        const assigneesData = updatedTask.assigneeIds || [];
        const assignees = Array.isArray(assigneesData)
          ? assigneesData
          : typeof assigneesData === 'string'
            ? [assigneesData]
            : [];

        const validAssignees = assignees.filter(
          (id) => id && typeof id === 'string' && id.trim() !== ''
        );

        if (validAssignees.length > 0) {
          await createBulkNotifications({
            workspaceId: updatedTask.workspaceId || '',
            userIds: validAssignees,
            type: 'TASK_STATUS_CHANGED',
            data: {
              taskId: updatedTask.id,
              taskTitle: updatedTask.title,
              projectId: updatedTask.projectId,
              projectName: projectName,
              changerName: updatedTask.createdByName || 'Team Member',
              newStatus: updatedTask.status,
              entityType: 'TASK',
            },
          });
        }
      }
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { taskId: string; projectId: string }) => {
      // Read the parent links BEFORE the delete — afterwards there is no row to
      // learn them from, and the FR/Epic rollups have to be recomputed without
      // this task or they keep counting it forever.
      let links: ParentLinks = {};
      try {
        const doomed = await resources.get('tasks', data.taskId);
        links = {
          functionalRequirementId: doomed.functionalRequirementId,
          epicId: doomed.epicId,
        };
      } catch (error) {
        logger.error('Failed to read task before delete', { error });
      }

      await resources.remove('tasks', data.taskId);
      return { ...data, links };
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });

      if (data.links.functionalRequirementId || data.links.epicId) {
        await updateParentProgress(data.links);
        invalidateParents(queryClient, data.projectId, data.links);
      }

      toast.success('Task deleted successfully!');
    },
    onError: (error: Error) => {
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to delete task'
      );
    },
  });
}

export function useReorderTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      tasks: { taskId: string; position: number }[];
      projectId: string;
    }) => {
      // Update positions for multiple tasks
      const updates = data.tasks.map((task) =>
        resources.update('tasks', task.taskId, {
          position: task.position,
        })
      );

      await Promise.all(updates);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });
    },
    onError: (error: Error) => {
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to reorder tasks'
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

