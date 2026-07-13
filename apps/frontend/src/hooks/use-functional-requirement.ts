'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { id, query } from '@/lib/api/client';
import { toast } from '@/hooks/use-toast';
import {
  generateFRId,
  generateFRIdWithEpicOnly,
  generateFRIdStandalone,
  generateTaskId,
} from '@/lib/hierarchy-id-generator';
import { createBulkNotifications } from '@/hooks/use-notification';
import type { FunctionalRequirement, FunctionalRequirementStatus, Task } from '@/types';
import { logger } from '@/lib/logger';

// ? Utility: Calculate FR status from linked tasks
export function calculateFRStatusFromTasks(tasks: Task[]): FunctionalRequirement['status'] {
  if (!tasks || tasks.length === 0) return 'DRAFT';

  const allDone = tasks.every((t) => t.status === 'DONE');
  const anyInProgress = tasks.some((t) => t.status === 'IN_PROGRESS' || t.status === 'REVIEW');
  const anyTodo = tasks.some((t) => t.status === 'TODO');

  // FR lifecycle: DRAFT ? REVIEW ? APPROVED ? IMPLEMENTED ? TESTED ? DEPLOYED
  if (allDone) {
    // All tasks done - mark as TESTED (ready for deployment)
    return 'TESTED';
  } else if (anyInProgress) {
    // Some tasks in progress - mark as IMPLEMENTED (being developed)
    return 'IMPLEMENTED';
  } else if (anyTodo) {
    // Tasks exist but not started - mark as APPROVED (ready to work on)
    return 'APPROVED';
  } else {
    // Default state
    return 'DRAFT';
  }
}

// Fetch all functional requirements for a project
export function useFunctionalRequirements(projectId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.list('functional_requirements', [
        query.equal('projectId', projectId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as FunctionalRequirement[];
    },
    enabled: !!projectId,
  });
}

// Fetch single functional requirement
export function useFunctionalRequirement(requirementId?: string) {
  return useQuery({
    queryKey: ['functional-requirement', requirementId],
    queryFn: async () => {
      if (!requirementId) return null;

      const response = await resources.get('functional_requirements', requirementId);

      return response as unknown as FunctionalRequirement;
    },
    enabled: !!requirementId,
  });
}

// ? NEW: Get FRs by Epic (proper hierarchy)
export function useFunctionalRequirementsByEpic(epicId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', 'epic', epicId],
    queryFn: async () => {
      if (!epicId) return [];

      const response = await resources.list('functional_requirements', [
        query.equal('epicId', epicId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as FunctionalRequirement[];
    },
    enabled: !!epicId,
  });
}

// ? NEW: Get FRs by Sprint
export function useFunctionalRequirementsBySprint(sprintId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', 'sprint', sprintId],
    queryFn: async () => {
      if (!sprintId) return [];

      const response = await resources.list('functional_requirements', [
        query.equal('sprintId', sprintId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as FunctionalRequirement[];
    },
    enabled: !!sprintId,
  });
}

// Create functional requirement
export function useCreateFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      projectCode: string;
      epicId?: string; // ? FIXED: Primary parent (epic)
      sprintId?: string; // ? NEW: Optional sprint assignment
      clientRequirementId?: string; // Keep for traceability
      parentRequirementId?: string;
      title: string;
      description?: string;
      type: 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'TECHNICAL' | 'BUSINESS'; // Required type field
      complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; // ? NEW: Priority field
      status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'IMPLEMENTED' | 'TESTED' | 'DEPLOYED';
      reusable?: boolean;
      assignedTo?: string[]; // ? NEW: Team member assignments
      assignedToNames?: string[]; // ? NEW: Denormalized names
      tags?: string;
      linkedProjectIds?: string;
      createdBy: string;
      createdByName?: string;
    }) => {
      // ? NEW: Generate hierarchical id based on parent entities
      let hierarchyId: string;

      if (data.parentRequirementId) {
        // Child requirement: Get parent's hierarchyId and generate child id
        const parent = await resources.get('functional_requirements', data.parentRequirementId
        );

        const parentHierarchyId = parent.hierarchyId;

        // Count siblings to determine the next number
        const siblings = await resources.list('functional_requirements', [
          query.equal('projectId', data.projectId),
          query.equal('parentRequirementId', data.parentRequirementId),
        ]);

        const childNumber = String(siblings.total + 1).padStart(2, '0');
        hierarchyId = `${parentHierarchyId}.${childNumber}`;
      } else {
        // Top-level requirement: Use hierarchical naming
        // Format: P{ProjCode}-R{ReqCode}-E{EpicCode}-FR{FRCode}-{Num}

        // Count existing FRs for sequence number
        const existingFRs = await resources.list('functional_requirements', [
          query.equal('projectId', data.projectId),
        ]);
        const sequenceNumber = existingFRs.total + 1;

        // Fetch project details
        const project = await resources.get('projects', data.projectId
        );
        const projectName = project.name || '';

        if (data.epicId) {
          // Has epic: Fetch epic and potentially requirement
          const epic = await resources.get('epics', data.epicId);
          const epicName = epic.name || '';

          if (epic.requirementId) {
            // Has requirement through epic
            const requirement = await resources.get('client_requirements', epic.requirementId
            );
            const requirementName = requirement.title || '';

            // Full hierarchy: P-R-E-FR
            hierarchyId = generateFRId(
              data.projectCode,
              projectName,
              requirementName,
              epicName,
              data.title,
              sequenceNumber
            );
          } else {
            // Epic only: P-E-FR
            hierarchyId = generateFRIdWithEpicOnly(
              data.projectCode,
              projectName,
              epicName,
              data.title,
              sequenceNumber
            );
          }
        } else {
          // No epic or requirement: P-FR
          hierarchyId = generateFRIdStandalone(
            data.projectCode,
            projectName,
            data.title,
            sequenceNumber
          );
        }
      }

      const requirementData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        epicId: data.epicId || '', // ? FIXED: Link to parent epic
        sprintId: data.sprintId || '', // ? NEW: Optional sprint assignment
        clientRequirementId: data.clientRequirementId || '',
        parentRequirementId: data.parentRequirementId || '',
        hierarchyId,
        title: data.title,
        description: data.description || '',
        type: data.type, // Required type field
        complexity: data.complexity,
        priority: data.priority || 'MEDIUM', // ? NEW: Priority with default
        status: data.status,
        reusable: data.reusable || false,
        assignedTo: data.assignedTo || [], // ? NEW: Team assignments
        assignedToNames: data.assignedToNames || [], // ? NEW: Denormalized names
        tags: data.tags || '',
        linkedProjectIds: data.linkedProjectIds || '',
        createdBy: data.createdBy,
        createdByName: data.createdByName || '',
      };

      const response = await resources.create('functional_requirements', id.unique(),
        requirementData
      );

      return response as unknown as FunctionalRequirement;
    },
    onSuccess: async (createdFR, variables) => {
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
      if (variables.epicId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'epic', variables.epicId],
        });
      }
      if (variables.sprintId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'sprint', variables.sprintId],
        });
      }
      if (variables.clientRequirementId) {
        queryClient.invalidateQueries({
          queryKey: ['client-requirement', variables.clientRequirementId],
        });
      }

      // ? Send FR_CREATED notification to assigned team members
      if (variables.assignedTo && variables.assignedTo.length > 0) {
        try {
          // Get project name for notification
          let projectName = 'Project';
          try {
            const project = await resources.get('projects', variables.projectId
            );
            projectName = project.name || 'Project';
          } catch (error) {
            logger.error('Failed to get project name for notification', { error });
          }

          await createBulkNotifications({
            workspaceId: variables.workspaceId,
            userIds: variables.assignedTo,
            type: 'FR_CREATED',
            data: {
              frId: createdFR.id,
              frTitle: createdFR.title,
              frHierarchyId: createdFR.hierarchyId,
              projectId: variables.projectId,
              projectName,
              creatorName: variables.createdByName || 'Team Member',
              entityType: 'FR',
            },
          });
        } catch (error) {
          logger.error('Failed to send FR creation notifications', { error });
        }
      }

      toast({
        title: 'Success',
        description: 'Functional requirement created successfully!',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to create functional requirement',
        variant: 'destructive',
      });
    },
  });
}

// Update functional requirement
export function useUpdateFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      requirementId: string;
      projectId: string;
      updates: Partial<FunctionalRequirement>;
      previousSprintId?: string; // Track if sprint assignment is new
    }) => {
      const { requirementId, projectId, updates, previousSprintId } = data;

      // Process updates - no need to stringify since new fields are simple strings
      const processedUpdates: any = { ...updates };

      const response = await resources.update('functional_requirements', requirementId,
        processedUpdates
      );

      const updatedFR = response as unknown as FunctionalRequirement;

      // ? AUTO-CREATE TASK when FR is assigned to sprint for the first time
      const isNewSprintAssignment = updates.sprintId && updates.sprintId !== previousSprintId;

      if (isNewSprintAssignment && updates.sprintId) {
        try {
          // Get existing tasks to calculate position
          const existingTasks = await resources.list('tasks', [
            query.equal('projectId', projectId),
          ]);

          const topLevelTasks = existingTasks.items.filter((t: any) => !t.parentTaskId);
          const taskSequence = topLevelTasks.length + 1;

          // Get sprint and FR for hierarchy generation
          const sprint = await resources.get('sprints', updates.sprintId
          );

          // Generate hierarchyId: FR ? Sprint ? Task
          const hierarchyId = generateTaskId(
            updatedFR.hierarchyId,
            sprint.name,
            updatedFR.title,
            taskSequence
          );

          // Create task linked to FR - starts in BACKLOG until sprint is activated
          // When sprint becomes ACTIVE, task will be moved to TODO
          const taskData = {
            workspaceId: updatedFR.workspaceId,
            projectId: projectId,
            hierarchyId,
            title: updatedFR.title,
            description:
              updatedFR.description || `Task auto-created from FR: ${updatedFR.hierarchyId}`,
            status: 'BACKLOG' as const, // ? Start in BACKLOG until sprint is activated
            priority: updatedFR.priority || 'MEDIUM',
            assignedTo: updatedFR.assignedTo || [],
            assignedToNames: updatedFR.assignedToNames || [],
            assignedBy: updatedFR.createdBy,
            assignedByName: updatedFR.createdByName || '',
            createdBy: updatedFR.createdBy,
            createdByName: updatedFR.createdByName || '',
            dueDate: sprint.endDate || undefined, // ? Sprint end date becomes task due date
            estimatedHours: 0,
            actualHours: 0,
            sprintId: updates.sprintId, // ? Link to sprint
            epicId: updatedFR.epicId,
            functionalRequirementId: requirementId, // ? Link back to FR
            parentTaskId: undefined,
            labels: JSON.stringify([]),
            attachments: JSON.stringify([]),
            customFields: JSON.stringify({}),
            position: existingTasks.total,
          };

          await resources.create('tasks', id.unique(), taskData);

          // ? Also update existing tasks linked to this FR with sprint info and due date
          const existingFRTasks = await resources.list('tasks', [
            query.equal('functionalRequirementId', requirementId),
            query.limit(100),
          ]);

          // Update all existing tasks with sprint end date and sprintId
          await Promise.all(
            existingFRTasks.items.map((task) =>
              resources.update('tasks', task.id, {
                sprintId: updates.sprintId,
                dueDate: sprint.endDate || task.dueDate,
              })
            )
          );

          // Invalidate task queries to show new task
          queryClient.invalidateQueries({
            queryKey: ['tasks', projectId],
          });

          toast({
            title: 'Task Created',
            description: `Auto-created task for FR: ${updatedFR.hierarchyId}. Sprint end date set as due date.`,
          });
        } catch (error) {
          logger.error('Error auto-creating task', { error });
          // Don't fail the FR update if task creation fails
          toast({
            title: 'Warning',
            description: 'FR updated but task creation failed. Please create task manually.',
            variant: 'destructive',
          });
        }
      }

      return updatedFR;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
      queryClient.invalidateQueries({
        queryKey: ['functional-requirement', variables.requirementId],
      });

      // ? Invalidate epic and sprint queries if those fields were updated
      if (result.epicId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'epic', result.epicId],
        });
      }
      if (result.sprintId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'sprint', result.sprintId],
        });
      }

      toast({
        title: 'Success',
        description: 'Functional requirement updated successfully!',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to update functional requirement',
        variant: 'destructive',
      });
    },
  });
}

// Delete functional requirement
export function useDeleteFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { requirementId: string; projectId: string }) => {
      // Check for child requirements
      const children = await resources.list('functional_requirements', [
        query.equal('parentRequirementId', data.requirementId),
      ]);

      if (children.total > 0) {
        throw new Error(
          'Cannot delete requirement with child requirements. Delete children first.'
        );
      }

      // ? CASCADE DELETE: Delete all tasks linked to this FR
      const linkedTasks = await resources.list('tasks', [
        query.equal('functionalRequirementId', data.requirementId),
        query.limit(100),
      ]);

      await Promise.all(
        linkedTasks.items.map((task) =>
          resources.remove('tasks', task.id)
        )
      );

      // Now delete the FR
      await resources.remove('functional_requirements', data.requirementId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
      toast({
        title: 'Success',
        description: 'Functional requirement and linked tasks deleted successfully!',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to delete functional requirement',
        variant: 'destructive',
      });
    },
  });
}

// ? NEW: Clone/Reuse functional requirement to another project
export function useCloneFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      requirementId: string;
      targetProjectId: string;
      targetProjectCode: string;
      targetEpicId?: string;
      targetClientRequirementId?: string;
    }) => {
      const {
        requirementId,
        targetProjectId,
        targetProjectCode,
        targetEpicId,
        targetClientRequirementId,
      } = data;

      // Fetch original FR
      const originalFR = (await resources.get('functional_requirements', requirementId
      )) as unknown as FunctionalRequirement;

      // Get target project details for hierarchy generation
      const targetProject = await resources.get('projects', targetProjectId
      );

      // Get existing FRs in target project to calculate sequence
      const existingFRs = await resources.list('functional_requirements', [
        query.equal('projectId', targetProjectId),
      ]);

      const frSequence = existingFRs.total + 1;

      // Generate new hierarchyId based on target project structure
      let newHierarchyId: string;

      if (targetEpicId) {
        // If targeting an epic, fetch it and generate FR id with epic
        const targetEpic = await resources.get('epics', targetEpicId
        );

        if (targetClientRequirementId) {
          // Full hierarchy: Project ? Client Req ? Epic ? FR
          const targetClientReq = await resources.get('client_requirements', targetClientRequirementId
          );

          newHierarchyId = generateFRId(
            targetProjectCode,
            targetProject.name,
            targetClientReq.name,
            targetEpic.name,
            originalFR.title,
            frSequence
          );
        } else {
          // Project ? Epic ? FR (no client requirement)
          newHierarchyId = generateFRIdWithEpicOnly(
            targetProjectCode,
            targetProject.name,
            targetEpic.name,
            originalFR.title,
            frSequence
          );
        }
      } else {
        // Standalone FR (no epic)
        newHierarchyId = generateFRIdStandalone(
          targetProjectCode,
          targetProject.name,
          originalFR.title,
          frSequence
        );
      }

      // Create cloned FR with new project/hierarchy, reset sprint assignment
      const clonedFRData = {
        workspaceId: targetProject.workspaceId,
        projectId: targetProjectId,
        hierarchyId: newHierarchyId,
        title: originalFR.title,
        description: `${originalFR.description}\n\n(Cloned from ${originalFR.hierarchyId})`,
        complexity: originalFR.complexity,
        priority: originalFR.priority,
        status: 'DRAFT' as FunctionalRequirementStatus,
        epicId: targetEpicId || '',
        clientRequirementId: targetClientRequirementId || '',
        sprintId: '',
        reusable: originalFR.reusable || false,
        assignedTo: [],
        assignedToNames: [],
        createdBy: originalFR.createdBy,
        createdByName: originalFR.createdByName,
      };

      const response = await resources.create('functional_requirements', id.unique(),
        clonedFRData
      );

      return response as unknown as FunctionalRequirement;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['functional-requirements', variables.targetProjectId],
      });

      if (result.epicId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'epic', result.epicId],
        });
      }

      toast({
        title: 'FR Cloned Successfully!',
        description: `${result.hierarchyId} created in target project`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to clone functional requirement',
        variant: 'destructive',
      });
    },
  });
}

