import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import type { Task, TaskStatus, TaskPriority, FunctionalRequirement } from '@/types';
import { toast } from 'sonner';
import { createBulkNotifications } from '@/hooks/use-notification';
import { generateTaskId, generateTaskIdWithoutFR } from '@/lib/hierarchy-id-generator';
import { logger } from '@/lib/logger';

type TaskDependencyMutation = {
  taskId: string;
  targetTaskId: string;
  type: 'blocks' | 'blockedBy';
};

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

function addUniqueId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

// Update FR and Epic progress based on task completion.
async function updateParentProgress(task: Task) {
  logger.debug('updateParentProgress called with task', {
    taskId: task.id,
    functionalRequirementId: task.functionalRequirementId,
    epicId: task.epicId,
    status: task.status,
  });

  try {
    // Update FR progress if task is linked to an FR
    if (task.functionalRequirementId) {
      // Get all tasks for this FR
      const frTasks = await resources.list('tasks', [
        query.equal('functionalRequirementId', task.functionalRequirementId),
        query.limit(100),
      ]);

      if (frTasks.total > 0) {
        const completedTasks = frTasks.items.filter((t: any) => t.status === 'DONE').length;
        const progress = Math.round((completedTasks / frTasks.total) * 100);

        logger.debug('Updating FR progress', {
          frId: task.functionalRequirementId,
          totalTasks: frTasks.total,
          completedTasks,
          progress,
        });

        // Update FR progress
        await resources.update('functional_requirements', task.functionalRequirementId,
          { progress }
        );
      }
    }

    // Update Epic progress if task is linked to an Epic
    if (task.epicId) {
      // Get all tasks for this Epic
      const epicTasks = await resources.list('tasks', [
        query.equal('epicId', task.epicId),
        query.limit(100),
      ]);

      if (epicTasks.total > 0) {
        const completedTasks = epicTasks.items.filter((t: any) => t.status === 'DONE').length;
        const progress = Math.round((completedTasks / epicTasks.total) * 100);

        // Update Epic progress and status
        const epicStatus = progress === 100 ? 'DONE' : progress > 0 ? 'IN_PROGRESS' : 'TODO';

        logger.debug('Updating Epic progress', {
          epicId: task.epicId,
          totalTasks: epicTasks.total,
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
    logger.error('Failed to update parent progress', { error });
    // Don't throw - progress update is not critical
  }
}

export function useTasks(projectId?: string) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.list('tasks', [
        query.equal('projectId', projectId),
        query.orderAsc('position'),
      ]);

      // Parse JSON fields
      const tasks = response.items.map((doc) => ({
        ...doc,
        labels: typeof doc.labels === 'string' && doc.labels ? JSON.parse(doc.labels) : [],
        attachments:
          typeof doc.attachments === 'string' && doc.attachments ? JSON.parse(doc.attachments) : [],
        customFields:
          typeof doc.customFields === 'string' && doc.customFields
            ? JSON.parse(doc.customFields)
            : {},
        assigneeIds:
          typeof doc.assigneeIds === 'string' && doc.assigneeIds ? JSON.parse(doc.assigneeIds) : [],
        // ? assignedTo and assignedToNames are array types in DB - use directly
        assignedTo: Array.isArray(doc.assignedTo)
          ? doc.assignedTo
          : Array.isArray(doc.assigneeIds)
            ? doc.assigneeIds
            : [],
        assignedToNames: Array.isArray(doc.assignedToNames) ? doc.assignedToNames : [],
        blockedBy: doc.blockedBy
          ? typeof doc.blockedBy === 'string'
            ? JSON.parse(doc.blockedBy)
            : doc.blockedBy
          : [],
        blocks: doc.blocks
          ? typeof doc.blocks === 'string'
            ? JSON.parse(doc.blocks)
            : doc.blocks
          : [],
      })) as unknown as Task[];

      return tasks;
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

      const response = await resources.list('tasks', [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
        query.limit(1000),
      ]);

      // Parse JSON fields
      const tasks = response.items.map((doc) => ({
        ...doc,
        labels: typeof doc.labels === 'string' && doc.labels ? JSON.parse(doc.labels) : [],
        attachments:
          typeof doc.attachments === 'string' && doc.attachments ? JSON.parse(doc.attachments) : [],
        customFields:
          typeof doc.customFields === 'string' && doc.customFields
            ? JSON.parse(doc.customFields)
            : {},
        assigneeIds:
          typeof doc.assigneeIds === 'string' && doc.assigneeIds ? JSON.parse(doc.assigneeIds) : [],
        // ? assignedTo and assignedToNames are array types in DB - use directly
        assignedTo: Array.isArray(doc.assignedTo) ? doc.assignedTo : [],
        assignedToNames: Array.isArray(doc.assignedToNames) ? doc.assignedToNames : [],
        blockedBy: doc.blockedBy
          ? typeof doc.blockedBy === 'string'
            ? JSON.parse(doc.blockedBy)
            : doc.blockedBy
          : [],
        blocks: doc.blocks
          ? typeof doc.blocks === 'string'
            ? JSON.parse(doc.blocks)
            : doc.blocks
          : [],
      })) as unknown as Task[];

      return tasks;
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

      // Parse JSON fields
      const task = {
        ...response,
        labels:
          typeof response.labels === 'string' && response.labels ? JSON.parse(response.labels) : [],
        attachments:
          typeof response.attachments === 'string' && response.attachments
            ? JSON.parse(response.attachments)
            : [],
        customFields:
          typeof response.customFields === 'string' && response.customFields
            ? JSON.parse(response.customFields)
            : {},
        assigneeIds:
          typeof response.assigneeIds === 'string' && response.assigneeIds
            ? JSON.parse(response.assigneeIds)
            : [],
        // ? assignedTo and assignedToNames are array types in DB - use directly
        assignedTo: Array.isArray(response.assignedTo) ? response.assignedTo : [],
        assignedToNames: Array.isArray(response.assignedToNames) ? response.assignedToNames : [],
        blockedBy: response.blockedBy
          ? typeof response.blockedBy === 'string'
            ? JSON.parse(response.blockedBy)
            : response.blockedBy
          : [],
        blocks: response.blocks
          ? typeof response.blocks === 'string'
            ? JSON.parse(response.blocks)
            : response.blocks
          : [],
      } as unknown as Task;

      return task;
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

      const response = await resources.list('tasks', [
        query.equal('functionalRequirementId', functionalRequirementId),
        query.orderAsc('position'),
      ]);

      // Parse JSON fields
      const tasks = response.items.map((doc) => ({
        ...doc,
        labels: typeof doc.labels === 'string' && doc.labels ? JSON.parse(doc.labels) : [],
        attachments:
          typeof doc.attachments === 'string' && doc.attachments ? JSON.parse(doc.attachments) : [],
        customFields:
          typeof doc.customFields === 'string' && doc.customFields
            ? JSON.parse(doc.customFields)
            : {},
        assigneeIds:
          typeof doc.assigneeIds === 'string' && doc.assigneeIds ? JSON.parse(doc.assigneeIds) : [],
        assignedTo: Array.isArray(doc.assignedTo) ? doc.assignedTo : [],
        assignedToNames: Array.isArray(doc.assignedToNames) ? doc.assignedToNames : [],
        blockedBy: doc.blockedBy
          ? typeof doc.blockedBy === 'string'
            ? JSON.parse(doc.blockedBy)
            : doc.blockedBy
          : [],
        blocks: doc.blocks
          ? typeof doc.blocks === 'string'
            ? JSON.parse(doc.blocks)
            : doc.blocks
          : [],
      })) as unknown as Task[];

      return tasks;
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

      // Get current tasks for counting
      const existingTasks = await resources.list('tasks', [
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
        const subtaskNumber = (siblings.length + 1).toString().padStart(2, '0');
        hierarchyId = `${parentHierarchyId}.${subtaskNumber}`;
      } else {
        // Top-level task: generate from FR ? Sprint ? Task hierarchy
        const topLevelTasks = existingTasks.items.filter((t) => !t.parentTaskId);
        const taskSequence = topLevelTasks.length + 1;

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
        assigneeIds: JSON.stringify(data.assigneeIds || []),
        assignedTo: data.assigneeIds || [],
        assignedToNames: [],
        assignedBy: data.assignedBy || data.createdBy, // Who assigned (defaults to creator)
        assignedByName: data.assignedByName || data.createdByName || '', // Assignor name
        createdBy: data.createdBy,
        createdByName: data.createdByName || '', // Creator name for display
        dueDate: data.dueDate,
        estimatedHours: data.estimatedHours || 0,
        actualHours: 0,
        sprintId: data.sprintId,
        epicId: data.epicId,
        functionalRequirementId: data.functionalRequirementId, // NEW: Store FR link
        parentTaskId: data.parentTaskId,
        labels: JSON.stringify(data.labels || []),
        attachments: JSON.stringify([]),
        customFields: JSON.stringify({}),
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
      currentUserRole?: string; // ? Pass user role for permission check
    }) => {
      const { taskId, updates, currentUserRole } = data;

      // ? Check permission for status changes to DONE
      if (updates.status === 'DONE') {
        // Get current task to check its status
        const currentTask = await resources.get('tasks', taskId);

        // ? ENFORCE: Tasks must be in REVIEW before marking as DONE
        if (currentTask.status !== 'REVIEW') {
          toast.warning(
            'Tasks must be reviewed before marking as done. Please move to Review first.'
          );
          return currentTask as unknown as Task; // Return unchanged task
        }

        // ? ENFORCE: Only managers/assistant managers can mark tasks as DONE
        const role = currentUserRole?.toLowerCase() || '';
        const canMarkDone = role.includes('manager') || role.includes('admin') || role === 'owner';
        if (!canMarkDone) {
          toast.warning('Only managers or assistant managers can mark tasks as done.');
          return currentTask as unknown as Task; // Return unchanged task
        }
      }

      // Stringify complex fields if they exist in updates
      const processedUpdates: any = { ...updates };
      if (updates.labels) {
        processedUpdates.labels = JSON.stringify(updates.labels);
      }
      if (updates.assigneeIds) {
        processedUpdates.assigneeIds = JSON.stringify(updates.assigneeIds);
      }
      if (updates.attachments) {
        processedUpdates.attachments = JSON.stringify(updates.attachments);
      }
      if (updates.customFields) {
        processedUpdates.customFields = JSON.stringify(updates.customFields);
      }

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
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to update task'
      );
    },
    onSuccess: async (updatedTask, variables) => {
      queryClient.invalidateQueries({ queryKey: ['task', variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // ? Update FR and Epic progress if status changed
      if (variables.updates.status) {
        await updateParentProgress(updatedTask as unknown as Task);
        // Invalidate FR and Epic queries to reflect progress
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', variables.projectId],
        });
        queryClient.invalidateQueries({ queryKey: ['epics', variables.projectId] });
      }

      // ? AUTO-SYNC FR STATUS: If task is linked to FR and status changed, update FR status
      if (updatedTask.functionalRequirementId && variables.updates.status) {
        try {
          // Get all tasks linked to this FR
          const frTasks = await resources.list('tasks', [
            query.equal('functionalRequirementId', updatedTask.functionalRequirementId),
          ]);

          // Calculate new FR status from all its tasks
          const tasks = frTasks.items as unknown as Task[];
          const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'DONE');
          const anyInProgress = tasks.some(
            (t) => t.status === 'IN_PROGRESS' || t.status === 'REVIEW'
          );

          let newFRStatus: FunctionalRequirement['status'];
          // If there are no tasks linked, FR should remain or become DRAFT
          if (tasks.length === 0) {
            newFRStatus = 'DRAFT';
          } else if (allDone) {
            newFRStatus = 'TESTED'; // All tasks complete = FR is tested
          } else if (anyInProgress) {
            newFRStatus = 'IMPLEMENTED'; // Some tasks in progress
          } else {
            newFRStatus = 'APPROVED'; // Tasks exist but none started
          }

          // Update FR status
          await resources.update('functional_requirements', updatedTask.functionalRequirementId,
            { status: newFRStatus }
          );

          // Invalidate FR queries
          queryClient.invalidateQueries({
            queryKey: ['functional-requirement', updatedTask.functionalRequirementId],
          });
          queryClient.invalidateQueries({
            queryKey: ['functional-requirements', variables.projectId],
          });
        } catch (error) {
          logger.error('Error syncing FR status', { error });
          // Don't fail the task update if FR sync fails
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
        const task = await resources.get('tasks', updatedTask.id);
        logger.debug('Task fetched for notification check', { taskId: task.id });

        const previousTask = queryClient
          .getQueryData<Task[]>(['tasks', variables.projectId])
          ?.find((t) => t.id === variables.taskId);

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

      toast.success('Task updated successfully!');
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
      currentUserRole?: string; // ? Pass user role for permission check
    }) => {
      const { taskId, status, position, currentUserRole } = data;

      // ? Get current task to check its status
      const currentTask = await resources.get('tasks', taskId);

      // ? ENFORCE: Tasks must be in REVIEW before marking as DONE
      if (status === 'DONE' && currentTask.status !== 'REVIEW') {
        toast.warning(
          'Tasks must be reviewed before marking as done. Please move to Review first.'
        );
        return currentTask as unknown as Task; // Return unchanged task
      }

      // ? ENFORCE: Only managers/assistant managers can mark tasks as DONE
      if (status === 'DONE') {
        const role = currentUserRole?.toLowerCase() || '';
        const canMarkDone = role.includes('manager') || role.includes('admin') || role === 'owner';
        if (!canMarkDone) {
          toast.warning('Only managers or assistant managers can mark tasks as done.');
          return currentTask as unknown as Task; // Return unchanged task
        }
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
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to update task status'
      );
    },
    onSuccess: async (updatedTask, variables) => {
      logger.debug('useUpdateTaskStatus onSuccess - updatedTask', { updatedTask });

      // Silent success, already updated optimistically
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // ? Update FR and Epic progress based on task completion
      await updateParentProgress(updatedTask as unknown as Task);
      // Invalidate FR and Epic queries to reflect progress
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['epics', variables.projectId] });

      // Fetch project name for notifications
      let projectName = updatedTask.projectId;
      try {
        const project = await resources.get('projects', updatedTask.projectId
        );
        projectName = project.name;
      } catch (error) {
        logger.error('Failed to fetch project name', { error });
      }

      // Create notification if task was completed - notify managers for review
      if (variables.status === 'DONE') {
        try {
          // query workspace members to find managers/admins
          const membersResponse = await resources.list('workspace_members', [query.equal('workspaceId', updatedTask.workspaceId)]
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
      if (variables.status === 'REVIEW') {
        try {
          const membersResponse = await resources.list('workspace_members', [query.equal('workspaceId', updatedTask.workspaceId)]
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
      if (variables.status === 'DONE' && updatedTask.sprintId) {
        try {
          const sprintTasks = await resources.list('tasks', [
            query.equal('sprintId', updatedTask.sprintId),
            query.limit(500),
          ]);

          const allTasksDone = sprintTasks.items.every((t: any) => t.status === 'DONE');

          if (allTasksDone && sprintTasks.total > 0) {
            const membersResponse = await resources.list('workspace_members', [query.equal('workspaceId', updatedTask.workspaceId)]
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
      if (variables.status !== 'DONE' && variables.status !== 'REVIEW') {
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
              newStatus: variables.status,
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
      await resources.remove('tasks', data.taskId);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });
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
      const task = await resources.get('tasks', data.taskId);
      const targetTask = await resources.get('tasks', data.targetTaskId
      );

      const blockedBy = normalizeIdList(task.blockedBy);
      const blocks = normalizeIdList(task.blocks);
      const targetBlockedBy = normalizeIdList(targetTask.blockedBy);
      const targetBlocks = normalizeIdList(targetTask.blocks);

      if (data.type === 'blockedBy') {
        await resources.update('tasks', data.taskId, {
          blockedBy: addUniqueId(blockedBy, data.targetTaskId),
          blocks,
        });
        await resources.update('tasks', data.targetTaskId, {
          blockedBy: targetBlockedBy,
          blocks: addUniqueId(targetBlocks, data.taskId),
        });
      } else {
        await resources.update('tasks', data.taskId, {
          blockedBy,
          blocks: addUniqueId(blocks, data.targetTaskId),
        });
        await resources.update('tasks', data.targetTaskId, {
          blockedBy: addUniqueId(targetBlockedBy, data.taskId),
          blocks: targetBlocks,
        });
      }

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
      const task = await resources.get('tasks', data.taskId);
      const targetTask = await resources.get('tasks', data.targetTaskId
      );

      const blockedBy = normalizeIdList(task.blockedBy);
      const blocks = normalizeIdList(task.blocks);
      const targetBlockedBy = normalizeIdList(targetTask.blockedBy);
      const targetBlocks = normalizeIdList(targetTask.blocks);

      if (data.type === 'blockedBy') {
        await resources.update('tasks', data.taskId, {
          blockedBy: blockedBy.filter((id) => id !== data.targetTaskId),
          blocks,
        });
        await resources.update('tasks', data.targetTaskId, {
          blockedBy: targetBlockedBy,
          blocks: targetBlocks.filter((id) => id !== data.taskId),
        });
      } else {
        await resources.update('tasks', data.taskId, {
          blockedBy,
          blocks: blocks.filter((id) => id !== data.targetTaskId),
        });
        await resources.update('tasks', data.targetTaskId, {
          blockedBy: targetBlockedBy.filter((id) => id !== data.taskId),
          blocks: targetBlocks,
        });
      }

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

