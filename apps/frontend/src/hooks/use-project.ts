import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import { parseJsonObject, parseJsonStringArray } from '@/lib/api/json-fields';
import type { Project, ProjectMethodology, ProjectStatus } from '@/types';
import { toast } from '@/hooks/use-toast';
import { generateProjectCode } from '@/lib/utils';
import { saveFailureToast } from '@/lib/api/mutation-error';

/**
 * Derive a project code that is free within the workspace.
 *
 * `generateProjectCode` builds a 3-letter code from the name, so collisions are
 * routine ("Mobile App" and "Mobile Alpha" both give "MOA"). The code prefixes
 * every task hierarchy id in the project — and the clone flow rewrites that
 * prefix by string replacement, which silently no-ops when the clone derives
 * the source's code — so the API now rejects a duplicate with 409. Probe first
 * and append a numeric suffix, otherwise the user is blocked by a code they
 * never chose. `shortCode` is capped at 10 chars server-side, so a 3-letter base
 * plus a suffix always fits.
 */
async function resolveProjectCode(workspaceId: string, name: string): Promise<string> {
  const base = generateProjectCode(name);
  const existing = await resources.listAll<{ shortCode?: string | null }>('projects', [
    query.equal('workspaceId', workspaceId),
  ]);
  const taken = new Set(existing.items.map((p) => String(p.shortCode)));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not derive a unique project code from "${name}". Please rename the project.`);
}

export function useProjects(workspaceId?: string) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];

      // listAll, not list: the backend defaults to pageSize 100, and this query
      // backs every project picker in the app (both requirements pages, the
      // task/sprint filters, the analytics roll-ups). A workspace with more than
      // 100 projects silently lost the rest from every one of them.
      const response = await resources.listAll('projects', [query.equal('workspaceId', workspaceId), query.orderDesc('createdAt')]
      );

      // Parse JSON fields
      const projects = response.items.map(doc => ({
        ...doc,
        settings: parseJsonObject(doc.settings),
        memberIds: Array.isArray(doc.memberIds) ? doc.memberIds : [doc.memberIds],
        archived: doc.archived ?? false, // Fallback to false if attribute doesn't exist
      })) as unknown as Project[];

      return projects;
    },
    enabled: !!workspaceId,
  });
}

export function useProject(projectId?: string) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const response = await resources.get('projects', projectId
      );

      // Parse JSON fields
      const project = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds) ? response.memberIds : [response.memberIds],
        archived: response.archived ?? false, // Fallback to false if attribute doesn't exist
      } as unknown as Project;

      return project;
    },
    enabled: !!projectId,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      name: string;
      description?: string;
      clientName?: string;
      methodology: ProjectMethodology;
      startDate?: string;
      endDate?: string;
      ownerId: string;
      createdBy?: string;
      createdByName?: string;
    }) => {
      // DEFENSIVE: Validate workspaceId is provided
      if (!data.workspaceId) {
        throw new Error('Workspace id is required. Please select a workspace first.');
      }

      const projectCode = await resolveProjectCode(data.workspaceId, data.name);

      const projectData = {
        workspaceId: data.workspaceId,
        name: data.name,
        shortCode: projectCode, // Match database field name
        description: data.description || '',
        clientName: data.clientName || '',
        methodology: data.methodology,
        status: 'PLANNING' as ProjectStatus,
        archived: false,
        // Date-only ('YYYY-MM-DD'): the column is @db.Date, and an ISO instant
        // is truncated to the PREVIOUS day for any UTC+ timezone.
        startDate: data.startDate || new Date().toISOString().slice(0, 10),
        endDate: data.endDate,
        ownerId: data.ownerId,
        createdBy: data.createdBy || data.ownerId,
        createdByName: data.createdByName || '',
        memberIds: [data.ownerId], // Native array, not JSON string
        settings: { // Native object — the DTO validates @IsObject
          enableTimeTracking: true,
          enableCustomFields: false,
          autoAssignToCreator: true,
          requireEstimates: false,
        },
      };

      const response = await resources.create('projects', id.unique(),
        projectData
      );

      // Parse response (the API returns settings as a native object)
      const project = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds) ? response.memberIds : [response.memberIds],
      };

      return project as unknown as Project;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects', variables.workspaceId] });
      toast({
        title: 'Success',
        description: 'Project created successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to create project',
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      workspaceId: string;
      name?: string;
      description?: string;
      clientName?: string;
      status?: ProjectStatus;
      // `string | null`: null CLEARS the column server-side, and it is the only
      // way to say so — an `undefined` property is dropped by JSON.stringify, so
      // the PATCH would carry no field at all and the old date would survive a
      // save the user was told had succeeded.
      startDate?: string | null;
      endDate?: string | null;
      settings?: Project['settings'];
      /** See EditBasedOn: refuses the save if somebody else has edited these fields. */
      basedOn?: Record<string, unknown>;
    }) => {
      const { projectId, workspaceId, ...updates } = data;

      // settings passes through as a native object (the DTO validates @IsObject)
      const updateData: any = { ...updates };

      const response = await resources.update('projects', projectId,
        updateData
      );

      // Parse response
      const project = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds)
          ? response.memberIds
          : [response.memberIds],
      };

      return project as unknown as Project;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.workspaceId] });
      toast({
        title: 'Success',
        description: 'Project updated successfully!',
      });
    },
    onError: (error: Error) => {
      toast(saveFailureToast(error, 'Failed to update project'));
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { projectId: string; workspaceId: string }) => {
      await resources.remove('projects', data.projectId
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects', data.workspaceId] });
      toast({
        title: 'Success',
        description: 'Project deleted successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to delete project',
        variant: 'destructive',
      });
    },
  });
}

export function useAddProjectMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      workspaceId: string;
      userId: string;
      currentMembers: string[];
    }) => {
      const updatedMembers = [...data.currentMembers, data.userId];

      const response = await resources.update('projects', data.projectId,
        { memberIds: updatedMembers }
      );

      return response as unknown as Project;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.workspaceId] });
      toast({
        title: 'Success',
        description: 'Member added to project!',
      });
    },
  });
}

export function useChangeProjectMethodology() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      workspaceId: string;
      methodology: ProjectMethodology;
    }) => {
      const response = await resources.update('projects', data.projectId,
        { methodology: data.methodology }
      );

      const project = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds)
          ? response.memberIds
          : [response.memberIds],
      };

      return project as unknown as Project;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.workspaceId] });
      toast({
        title: 'Methodology Changed',
        description: `Project methodology updated to ${variables.methodology}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to change methodology',
        variant: 'destructive',
      });
    },
  });
}

// Archiving a project is expressed as `status: 'ARCHIVED'` (settable from the
// edit dialog and the settings page). The hooks that wrote the parallel
// `archived` boolean had no call site anywhere in the app, so that flag could
// never be set — they are gone rather than left as a second representation.

export function useCloneProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      sourceProjectId: string;
      newName: string;
      includeSettings: boolean;
      includeTasks: boolean;
      includeMembers: boolean;
      includeSprints: boolean;
      userId: string;
    }) => {
      // Set the moment the new project row exists. Everything after that point
      // is a long serial chain of individual REST calls with no transaction
      // behind it, so a failure part-way leaves this project standing with only
      // some of its contents. Deleting it automatically would destroy rows the
      // user can already see, so the error names it instead of pretending the
      // clone left nothing behind.
      let createdProject: Project | null = null;
      try {
        // Get source project
        const sourceProject = await resources.get('projects', data.sourceProjectId
        );

        // Parse source project
        const parsedSource = {
          ...sourceProject,
          settings: parseJsonObject(sourceProject.settings),
          memberIds: parseJsonStringArray(sourceProject.memberIds),
        } as unknown as Project;

        // Generate a new project code that is FREE in the workspace: if the
        // clone derived the source's own code, the hierarchyId rewrite below
        // would no-op and every cloned task would keep the source's id.
        const projectCode = await resolveProjectCode(parsedSource.workspaceId, data.newName);

        // Prepare new project data
        const newProjectData = {
          workspaceId: parsedSource.workspaceId,
          name: data.newName,
          shortCode: projectCode,
          description: parsedSource.description || `Cloned from ${parsedSource.name}`,
          // The dialog offers "a duplicate of <project>", and clientName is a
          // REQUIRED field on the create form that is stamped onto every
          // requirement — dropping it left the clone with no client at all.
          clientName: parsedSource.clientName || '',
          methodology: parsedSource.methodology,
          status: 'PLANNING' as ProjectStatus,
          archived: false,
          // Date-only ('YYYY-MM-DD'): the column is @db.Date, so a full ISO
          // instant is truncated to the PREVIOUS day for any UTC+ timezone.
          // The source's own window carries over ("dates will be preserved");
          // only a project with no start date falls back to today.
          startDate: parsedSource.startDate || new Date().toISOString().slice(0, 10),
          endDate: parsedSource.endDate || undefined,
          ownerId: data.userId,
          memberIds: data.includeMembers ? parsedSource.memberIds : [data.userId],
          settings: data.includeSettings
            ? parsedSource.settings
            : {
              enableTimeTracking: true,
              enableCustomFields: false,
              autoAssignToCreator: true,
              requireEstimates: false,
            },
        };

        // Create new project
        const newProject = await resources.create('projects', id.unique(),
          newProjectData
        );

        const parsedNewProject = {
          ...newProject,
          settings: parseJsonObject(newProject.settings),
          memberIds: Array.isArray(newProject.memberIds) ? newProject.memberIds : [newProject.memberIds],
        } as unknown as Project;
        createdProject = parsedNewProject;

        const workspaceId = parsedNewProject.workspaceId;
        const projectId = parsedNewProject.id;

        // Every child's hierarchyId is prefixed with the project's shortCode.
        const rehome = (hierarchyId: unknown): string =>
          String(hierarchyId ?? '').replace(parsedSource.shortCode, projectCode);

        /**
         * Every row of one collection belonging to the source project. listAll,
         * not list: a single page stops at the backend's MAX_PAGE_SIZE, and a
         * silently partial clone is still reported to the user as a success.
         */
        const sourceRows = async (collection: string) =>
          (await resources.listAll(collection, [query.equal('projectId', data.sourceProjectId)]))
            .items;

        // Labels are the project's tag vocabulary — configuration, not task
        // data — so they ride with the Project Settings checkbox, which now
        // names them. Cloning them unconditionally meant a clone with every box
        // unticked still duplicated the source's vocabulary, which no line of
        // the dialog offered.
        if (data.includeSettings) {
          for (const label of await sourceRows('labels')) {
            await resources.create('labels', id.unique(), {
              workspaceId,
              projectId,
              name: label.name,
              color: label.color,
              description: label.description || '',
            });
          }
        }

        // Sprints go first even though the checkbox lists them last: an FR and a
        // task can each name a sprint, and the id has to be remappable by then.
        const sprintIds = new Map<string, string>();
        if (data.includeSprints) {
          for (const sprint of await sourceRows('sprints')) {
            const created = await resources.create('sprints', id.unique(), {
              workspaceId,
              projectId,
              name: sprint.name,
              goal: sprint.goal || '',
              // 'PLANNING', not the legacy 'PLANNED': the API's SPRINT_STATUSES
              // allowlist is a hard 400 on anything else, and a clone that fails
              // here leaves a fully-populated project with no sprints behind.
              status: 'PLANNING' as const,
              // startDate/endDate are NOT NULL on a sprint and the API rejects a
              // create without them, so they are copied rather than cleared and
              // the dialog now says as much.
              startDate: sprint.startDate,
              endDate: sprint.endDate,
              // capacity removed - sprint workload tracked by task counts
            });
            sprintIds.set(String(sprint.id), String(created.id));
          }
        }

        // "Tasks & Requirements: all tasks, epics, and requirements" — only the
        // tasks were ever copied. The children form a chain (CR -> epic -> FR ->
        // task), so each level is created before the next and its old->new ids
        // kept: a cloned child that carried a source id would point out of its
        // own project, which the API rejects with "belongs to a different
        // project".
        if (data.includeTasks) {
          const clientRequirementIds = new Map<string, string>();
          for (const requirement of await sourceRows('client_requirements')) {
            const created = await resources.create('client_requirements', id.unique(), {
              workspaceId,
              projectId,
              title: requirement.title,
              description: requirement.description || '',
              clientName: requirement.clientName || parsedSource.clientName || '',
              priority: requirement.priority,
              status: requirement.status,
              attachments: [],
            });
            clientRequirementIds.set(String(requirement.id), String(created.id));
          }

          const epicIds = new Map<string, string>();
          for (const epic of await sourceRows('epics')) {
            const created = await resources.create('epics', id.unique(), {
              workspaceId,
              projectId,
              hierarchyId: rehome(epic.hierarchyId),
              name: epic.name,
              description: epic.description || '',
              color: epic.color || '',
              startDate: epic.startDate || undefined,
              endDate: epic.endDate || undefined,
              status: epic.status,
              progress: 0,
              requirementId: clientRequirementIds.get(String(epic.requirementId)) || '',
              assignedTeam: epic.assignedTeam || '',
              createdBy: data.userId,
            });
            epicIds.set(String(epic.id), String(created.id));
          }

          // parentRequirementId and parentTaskId point at a SIBLING, which may
          // not exist yet on the first pass, so those two links are filled in
          // afterwards from the finished id map.
          const functionalRequirements = await sourceRows('functional_requirements');
          const functionalRequirementIds = new Map<string, string>();
          for (const requirement of functionalRequirements) {
            const created = await resources.create('functional_requirements', id.unique(), {
              workspaceId,
              projectId,
              hierarchyId: rehome(requirement.hierarchyId),
              title: requirement.title,
              description: requirement.description || '',
              epicId: epicIds.get(String(requirement.epicId)) || '',
              sprintId: sprintIds.get(String(requirement.sprintId)) || '',
              clientRequirementId:
                clientRequirementIds.get(String(requirement.clientRequirementId)) || '',
              type: requirement.type,
              complexity: requirement.complexity,
              priority: requirement.priority,
              status: requirement.status,
              progress: 0,
              reusable: requirement.reusable ?? false,
              assignedTo: Array.isArray(requirement.assignedTo) ? requirement.assignedTo : [],
              assignedToNames: Array.isArray(requirement.assignedToNames)
                ? requirement.assignedToNames
                : [],
              tags: requirement.tags || '',
              createdBy: data.userId,
            });
            functionalRequirementIds.set(String(requirement.id), String(created.id));
          }
          for (const requirement of functionalRequirements) {
            const parentId = functionalRequirementIds.get(String(requirement.parentRequirementId));
            const clonedId = functionalRequirementIds.get(String(requirement.id));
            if (parentId && clonedId) {
              await resources.update('functional_requirements', clonedId, {
                parentRequirementId: parentId,
              });
            }
          }

          const tasks = await sourceRows('tasks');
          const taskIds = new Map<string, string>();
          for (const task of tasks) {
            const created = await resources.create('tasks', id.unique(), {
              workspaceId,
              projectId,
              hierarchyId: rehome(task.hierarchyId),
              title: task.title,
              description: task.description || '',
              status: 'TODO' as const,
              priority: task.priority,
              sprintId: sprintIds.get(String(task.sprintId)) || '',
              epicId: epicIds.get(String(task.epicId)) || '',
              functionalRequirementId:
                functionalRequirementIds.get(String(task.functionalRequirementId)) || '',
              // "All task assignments ... will be preserved" means the WHOLE
              // assignment record, not just the id list. assignedTo mirrors
              // assigneeIds server-side, but assignedToNames does not: it is
              // denormalized and defaults to [], so carrying only the ids left
              // every screen that renders names off it (the board card, the task
              // table) blank on cloned tasks. assignedBy/assignedByName and the
              // watcher list are on CreateTaskDto too and were dropped the same
              // way.
              assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds : [],
              assignedTo: Array.isArray(task.assignedTo) ? task.assignedTo : [],
              assignedToNames: Array.isArray(task.assignedToNames) ? task.assignedToNames : [],
              assignedBy: typeof task.assignedBy === 'string' ? task.assignedBy : '',
              assignedByName: typeof task.assignedByName === 'string' ? task.assignedByName : '',
              watcherIds: Array.isArray(task.watcherIds) ? task.watcherIds : [],
              createdBy: data.userId,
              // "...and dates will be preserved" — the due date was simply
              // dropped, so every cloned task landed undated.
              dueDate: task.dueDate || undefined,
              estimatedHours: task.estimatedHours ?? undefined,
              labels: Array.isArray(task.labels) ? task.labels : [],
              attachments: [],
              customFields: {},
              position: task.position || 0,
              blockedBy: [],
              blocks: [],
            });
            taskIds.set(String(task.id), String(created.id));
          }
          for (const task of tasks) {
            const parentId = taskIds.get(String(task.parentTaskId));
            const clonedId = taskIds.get(String(task.id));
            if (parentId && clonedId) {
              await resources.update('tasks', clonedId, { parentTaskId: parentId });
            }
          }
        }

        return parsedNewProject;
      } catch (error: unknown) {
        const raw = error instanceof Error ? error.message : String(error);
        let message = raw;
        // Translate the API's schema complaints into something actionable.
        if (raw.includes('Unknown attribute')) {
          if (raw.includes('archived')) {
            message = 'The projects API is missing the "archived" field. Please update the backend schema.';
          } else if (raw.includes('blockedBy') || raw.includes('blocks')) {
            message = 'The tasks API is missing dependency fields "blockedBy" and "blocks". Please update the backend schema.';
          }
        }
        if (createdProject) {
          throw new Error(
            `"${createdProject.name}" was created, but copying its contents stopped part-way: ${message} ` +
              'The partial project is in your projects list — review or delete it before retrying.'
          );
        }
        if (message !== raw) throw new Error(message);
        throw error;
      }
    },
    onSuccess: (newProject, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({
        title: 'Project cloned successfully',
        description: `${newProject.name} has been created with ${variables.includeTasks ? 'tasks' : 'no tasks'}.`,
      });
    },
    onError: (error: Error) => {
      // The clone may have got as far as creating the project before it failed,
      // and the message below says so — so refresh the list the user is being
      // sent to look at, or the half-built project is not there when they look.
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to clone project',
        variant: 'destructive',
      });
    },
  });
}


