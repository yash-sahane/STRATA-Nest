'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { id, query } from '@/lib/api/client';
import { ApiError, restClient } from '@/lib/api/rest-client';
import { toast } from '@/hooks/use-toast';
import {
  generateFRId,
  generateFRIdWithEpicOnly,
  generateFRIdStandalone,
  generateTaskId,
} from '@/lib/hierarchy-id-generator';
import { createBulkNotifications } from '@/hooks/use-notification';
import { deriveEpicMetrics } from '@/hooks/use-epic';
import type { EditBasedOn, FunctionalRequirement, FunctionalRequirementStatus, Task } from '@/types';
import { logger } from '@/lib/logger';
import { saveFailureToast } from '@/lib/api/mutation-error';

/**
 * Derive an FR's status from its linked tasks. The FR detail dialog labels
 * Status "(Auto-calculated from tasks)" and use-task.ts re-persists this after
 * every task create, status change and delete.
 *
 * FR lifecycle: DRAFT → REVIEW → APPROVED → IMPLEMENTED → TESTED → DEPLOYED.
 *
 * `currentStatus` covers the two states a task set cannot express:
 *  - DEPLOYED is TERMINAL. The sprint board writes it when an FR card is dragged
 *    into Done (getFRStatusForBoard in sprint-board.tsx) and nothing about a set
 *    of tasks means "shipped", so recomputing blind knocked every deployed FR
 *    back to TESTED on the next task edit.
 *  - an FR with no tasks keeps whatever a human set rather than snapping to
 *    DRAFT (it still defaults to DRAFT when the caller passes nothing).
 */
export function calculateFRStatusFromTasks(
  tasks: Task[],
  currentStatus?: FunctionalRequirement['status']
): FunctionalRequirement['status'] {
  if (currentStatus === 'DEPLOYED') return 'DEPLOYED';
  if (!tasks || tasks.length === 0) return currentStatus ?? 'DRAFT';

  // All tasks done - TESTED (ready for deployment)
  if (tasks.every((t) => t.status === 'DONE')) return 'TESTED';
  // Some work underway - IMPLEMENTED (being developed)
  if (tasks.some((t) => t.status === 'IN_PROGRESS' || t.status === 'REVIEW')) return 'IMPLEMENTED';
  // Tasks exist but none started - APPROVED (ready to work on). BACKLOG counts
  // here alongside TODO: an FR assigned to a PLANNING sprint auto-creates a
  // BACKLOG task (useUpdateFunctionalRequirement), and treating that as "no
  // tasks" demoted the FR to DRAFT the moment it was scheduled.
  return 'APPROVED';
}

/**
 * Re-persist BOTH parents' task-derived rollups from their CURRENT task sets —
 * the FR itself and, when it hangs off one, its epic.
 *
 * use-task.ts runs the same recompute (`updateParentProgress`, FR *and* epic)
 * after every task create, status change and delete, but the sprint-assignment
 * branch below creates its task with `resources.create` directly, so nothing
 * ran for it: the FR sat at DRAFT / 0% inside a dialog that already listed the
 * new task under a Status field labelled "(Auto-calculated from tasks)", and
 * the epic's stored columns never learned the task existed at all.
 *
 * The two writes are INDEPENDENT on purpose. Doing them in one try block is
 * exactly the shape of the bug in use-task.ts: the FR PATCH needs
 * `requirement:write`, the epic PATCH only needs `planning:write` or
 * `task:update`, so one shared catch lets a refusal on the FR silently cancel
 * an epic rollup that would have succeeded.
 *
 * Returns the re-read FR when its own rollup landed, else null — a rollup is
 * best-effort bookkeeping and must never fail the sprint move that triggered it.
 */
async function recalculateParentRollups(
  requirementId: string,
  epicId: string | undefined,
  currentStatus?: FunctionalRequirement['status']
): Promise<FunctionalRequirement | null> {
  let updatedFR: FunctionalRequirement | null = null;

  try {
    const frTasks = await resources.listAll('tasks', [
      query.equal('functionalRequirementId', requirementId),
    ]);
    const items = frTasks.items as unknown as Task[];
    const completed = items.filter((t) => t.status === 'DONE').length;

    const response = await resources.update('functional_requirements', requirementId, {
      progress: items.length > 0 ? Math.round((completed / items.length) * 100) : 0,
      status: calculateFRStatusFromTasks(items, currentStatus),
    });
    updatedFR = response as unknown as FunctionalRequirement;
  } catch (error) {
    logger.error('Failed to refresh the FR rollup after its task was created', { error });
  }

  if (epicId) {
    try {
      const epicTasks = await resources.listAll('tasks', [query.equal('epicId', epicId)]);
      // deriveEpicMetrics is the app's one definition of an epic's rollup (the
      // /epics cards and the epic dialog render it), so the numbers written
      // here cannot disagree with the ones the user is looking at.
      const { progress, status } = deriveEpicMetrics(epicTasks.items as unknown as Task[]);
      await resources.update('epics', epicId, { progress, status });
    } catch (error) {
      logger.error('Failed to refresh the epic rollup after its task was created', { error });
    }
  }

  return updatedFR;
}

// Fetch all functional requirements for a project
export function useFunctionalRequirements(projectId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // listAll: the stats, search and status filter all operate on this array,
      // so a silently truncated first page would make every one of them wrong.
      const response = await resources.listAll('functional_requirements', [
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

      const response = await resources.listAll('functional_requirements', [
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

      const response = await resources.listAll('functional_requirements', [
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
      updates: EditBasedOn<Partial<FunctionalRequirement>>;
      /** The FR's sprint BEFORE this update. Optional: read from the server
       *  when the caller does not know it (see below). */
      previousSprintId?: string;
    }) => {
      const { requirementId, projectId, updates, previousSprintId } = data;

      // Process updates - no need to stringify since new fields are simple strings
      // `basedOn` addresses the save rather than the record, but it travels in the
      // same object; it goes to the API and nowhere else.
      const processedUpdates: any = { ...updates };

      // The sprint the FR is moving OFF, resolved BEFORE the write. The detail
      // dialog passes it, but the sprint backlog's Add/Remove buttons do not —
      // and its "Remove from Sprint" sends sprintId:'', which is
      // indistinguishable from "it never had a sprint" unless we look. One
      // extra read, and only on the callers that leave it out.
      let priorSprintId = previousSprintId;
      if (updates.sprintId !== undefined && priorSprintId === undefined) {
        const before = (await resources.get(
          'functional_requirements',
          requirementId
        )) as unknown as FunctionalRequirement;
        priorSprintId = before.sprintId || '';
      }

      const response = await resources.update('functional_requirements', requirementId,
        processedUpdates
      );

      let updatedFR = response as unknown as FunctionalRequirement;

      // ? The FR changed sprint — INCLUDING the move to "no sprint". This used
      // to test `updates.sprintId` for truthiness, so the '' that detaches an FR
      // skipped the block entirely and the task the assignment had created kept
      // its old sprintId forever: the sprint board still counted the card and
      // the backlog screen no longer showed an FR that could explain it.
      const nextSprintId = updates.sprintId;
      const sprintMoved = nextSprintId !== undefined && nextSprintId !== (priorSprintId ?? '');

      // Set when this move auto-created the FR's first task, which is the only
      // case that changes either parent's rollup. Read after the try/catch: the
      // rollup is a separate concern from the task move and must not be
      // reported (or aborted) as one — see the catch below.
      let autoCreatedTask = false;

      if (sprintMoved) {
        try {
          // Tasks already linked to this FR. A sprint CHANGE must only re-point
          // them — creating unconditionally meant Sprint1→Sprint2→Sprint3 left
          // three near-identical tasks on the board.
          // listAll: every one of these rows is re-pointed below, so a
          // page-limited read would silently strand tasks 101+ on the old sprint.
          const existingFRTasks = await resources.listAll('tasks', [
            query.equal('functionalRequirementId', requirementId),
          ]);

          if (!nextSprintId) {
            // Taking the FR out of a sprint takes its tasks out with it, the
            // same way assigning re-points them. Left behind they were orphans:
            // "Sprint Progress 0 / 1 tasks" over an FR list that no longer
            // mentioned them.
            //
            // Only the tasks that were in the sprint the FR is LEAVING. A plain
            // truthiness test pulled a task that somebody had hand-moved to a
            // different sprint out of that other sprint too — the FR's move was
            // never anything to do with it.
            await Promise.all(
              existingFRTasks.items
                .filter((task) => task.sprintId === priorSprintId)
                .map((task) => resources.update('tasks', task.id, { sprintId: '' }))
            );

            queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
            queryClient.invalidateQueries({
              queryKey: ['tasks', 'functional-requirement', requirementId],
            });

            return updatedFR;
          }

          // Get sprint and FR for hierarchy generation
          const sprint = await resources.get('sprints', nextSprintId
          );

          if (existingFRTasks.total === 0) {
            // Get existing tasks to calculate position. listAll: `items` drives
            // the sequence number, and a 100-row first page made every task
            // past that reuse sequence 101.
            const existingTasks = await resources.listAll('tasks', [
              query.equal('projectId', projectId),
            ]);

            const topLevelTasks = existingTasks.items.filter((t: any) => !t.parentTaskId);
            const taskSequence = topLevelTasks.length + 1;

            // Generate hierarchyId: FR ? Sprint ? Task
            const hierarchyId = generateTaskId(
              updatedFR.hierarchyId,
              sprint.name,
              updatedFR.title,
              taskSequence
            );

            // Create task linked to FR. Only useStartSprint moves BACKLOG → TODO,
            // so an FR dropped into an ALREADY-ACTIVE sprint has to start in TODO
            // itself — otherwise its task never leaves the backlog.
            const taskData = {
              workspaceId: updatedFR.workspaceId,
              projectId: projectId,
              hierarchyId,
              title: updatedFR.title,
              description:
                updatedFR.description || `Task auto-created from FR: ${updatedFR.hierarchyId}`,
              status: sprint.status === 'ACTIVE' ? ('TODO' as const) : ('BACKLOG' as const),
              priority: updatedFR.priority || 'MEDIUM',
              // assigneeIds is the column every consumer reads (My Tasks, the task
              // details dialog, all workload analytics); assignedTo/assignedToNames
              // are only the denormalised display copy.
              assigneeIds: updatedFR.assignedTo || [],
              assignedTo: updatedFR.assignedTo || [],
              assignedToNames: updatedFR.assignedToNames || [],
              assignedBy: updatedFR.createdBy,
              assignedByName: updatedFR.createdByName || '',
              createdBy: updatedFR.createdBy,
              createdByName: updatedFR.createdByName || '',
              dueDate: sprint.endDate || undefined, // ? Sprint end date becomes task due date
              estimatedHours: 0,
              actualHours: 0,
              sprintId: nextSprintId, // ? Link to sprint
              epicId: updatedFR.epicId,
              functionalRequirementId: requirementId, // ? Link back to FR
              parentTaskId: undefined,
              labels: [],
              attachments: [],
              customFields: {},
              position: existingTasks.total,
            };

            await resources.create('tasks', id.unique(), taskData);
            autoCreatedTask = true;

            toast({
              title: 'Task Created',
              description: `Auto-created task for FR: ${updatedFR.hierarchyId}. Sprint end date set as due date.`,
            });
          }

          // ? Re-point every task already linked to this FR at the new sprint
          await Promise.all(
            existingFRTasks.items.map((task) =>
              resources.update('tasks', task.id, {
                sprintId: nextSprintId,
                dueDate: sprint.endDate || task.dueDate,
              })
            )
          );

          // Invalidate task queries to show the new/moved tasks
          queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
          queryClient.invalidateQueries({
            queryKey: ['tasks', 'functional-requirement', requirementId],
          });
        } catch (error) {
          logger.error('Error syncing the FR tasks with its sprint', { error });
          // Don't fail the FR update if the task side of the move fails
          toast({
            title: 'Warning',
            description: nextSprintId
              ? 'FR updated but its task could not be moved into the sprint. Please check the task.'
              : 'FR updated but its task could not be taken out of the sprint. Please check the task.',
            variant: 'destructive',
          });
        }
      }

      // Outside the block above, and with its own message. The FR's and the
      // epic's status/progress are derived from the task set, and creating the
      // row bypasses useCreateTask — the hook that normally re-persists them —
      // so the FR sat at DRAFT / 0% under its own "(Auto-calculated from
      // tasks)" label and the epic never learned the task existed. A refusal
      // here is a ROLLUP failure, not a failed sprint move, and saying "its
      // task could not be moved into the sprint" sent people to look at a task
      // that had in fact been created and scheduled correctly.
      if (autoCreatedTask) {
        const rolledUp = await recalculateParentRollups(
          requirementId,
          updatedFR.epicId || undefined,
          updatedFR.status
        );
        if (updatedFR.epicId) {
          // The epic's stored rollup just moved; /epics derives its cards from
          // the task set (already invalidated) but the epic row itself feeds
          // the detail query and global search.
          queryClient.invalidateQueries({ queryKey: ['epics', projectId] });
          queryClient.invalidateQueries({ queryKey: ['epic', updatedFR.epicId] });
        }
        if (rolledUp) {
          updatedFR = rolledUp;
        } else {
          toast({
            title: 'Warning',
            description:
              'Task created, but the FR status and progress could not be recalculated.',
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
      // ['tasks', 'functional-requirement', id] does NOT share a prefix with
      // ['tasks', projectId], so it needs its own invalidation.
      queryClient.invalidateQueries({
        queryKey: ['tasks', 'functional-requirement', variables.requirementId],
      });

      // Prefixes, not ['functional-requirements','epic'|'sprint', result.<id>]:
      // the only ids on the RESULT are the ones the FR moved TO, so the list it
      // moved OUT of was never refreshed — and a clear (sprintId:'') refreshed
      // nothing at all, because '' is falsy. After "Remove from Sprint" the
      // backlog rendered the same FR in "Sprint FRs" (stale) and in "FR Backlog"
      // (fresh) at the same time, in contradictory states.
      //
      // Only epicId and sprintId decide WHICH of those lists an FR belongs to,
      // so only they need the refetch. Every other edit — a sprint-board drag
      // (status), an assignee change from fr-assignment-card — leaves the FR in
      // exactly the lists it was already in and merely changes how its row
      // renders, which the cache can be told directly. Invalidating on those
      // too refetched every epic- and sprint-scoped list in the cache for
      // nothing; simply skipping them would have been worse, because the board
      // and the backlog would then keep rendering the pre-drag status for the
      // whole 60s staleTime.
      if (variables.updates.epicId !== undefined || variables.updates.sprintId !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['functional-requirements', 'epic'] });
        queryClient.invalidateQueries({ queryKey: ['functional-requirements', 'sprint'] });
      } else {
        queryClient.setQueriesData<FunctionalRequirement[]>(
          { queryKey: ['functional-requirements'] },
          (rows) =>
            Array.isArray(rows)
              ? rows.map((row) => (row.id === result.id ? { ...row, ...result } : row))
              : rows
        );
      }
      // No success toast here on purpose: every caller already emits its own,
      // more specific one, and a shared hook toast stacked N+3 of them on a
      // single save. Errors are still surfaced below.
    },
    onError: (error: unknown) => {
      toast(saveFailureToast(error, 'Failed to update functional requirement'));
    },
  });
}

// Delete functional requirement
export function useDeleteFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { requirementId: string; projectId: string; cascade?: boolean }) => {
      // The server owns the cascade: without the cascade flag it responds 409
      // when child requirements exist; with cascade=true it deletes the
      // descendant requirements and unlinks any tasks (kept).
      await restClient.delete(
        `/api/v1/functional_requirements/${data.requirementId}/`,
        data.cascade ? { params: { cascade: 'true' } } : undefined,
      );
    },
    onSuccess: (_, variables) => {
      // Root prefix, not ['functional-requirements', projectId]: a cascade also
      // removes descendants, and the epic- and sprint-scoped lists
      // (['functional-requirements','epic'|'sprint', id]) do not share that key,
      // so the epic dialog kept rendering FRs that no longer exist.
      queryClient.invalidateQueries({ queryKey: ['functional-requirements'] });
      queryClient.invalidateQueries({ queryKey: ['functional-requirement', variables.requirementId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
      toast({
        title: 'Success',
        description: 'Functional requirement deleted successfully!',
      });
    },
    onError: (error: unknown) => {
      // Same as the client-requirement delete: 409 means "children block this",
      // which the detail dialog turns into a cascade prompt. Toasting it here
      // leaked the API's `retry with cascade=true` hint as an error.
      if (error instanceof ApiError && error.code === 409) return;
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
      const existingFRs = await resources.listAll('functional_requirements', [
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
            targetClientReq.title, // the API exposes `title`, never `name`
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
        // Without this the clone fell back to the server default and every copy
        // of a NON_FUNCTIONAL / TECHNICAL / BUSINESS FR came back as FUNCTIONAL.
        type: originalFR.type || 'FUNCTIONAL',
        complexity: originalFR.complexity,
        priority: originalFR.priority,
        status: 'DRAFT' as FunctionalRequirementStatus,
        epicId: targetEpicId || '',
        clientRequirementId: targetClientRequirementId || '',
        sprintId: '',
        reusable: originalFR.reusable || false,
        assignedTo: [],
        assignedToNames: [],
        // Classification travels with the clone; without these the copy silently
        // reverted to the server defaults. `createdBy` is stamped from the
        // authenticated caller server-side, so sending it here is dead weight.
        tags: originalFR.tags || '',
        linkedProjectIds: originalFR.linkedProjectIds || '',
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

