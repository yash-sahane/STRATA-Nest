import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { query } from '@/lib/api/client';
import type { Project, ProjectStatus } from '@/types';
import { showSaveFailure } from '@/lib/api/mutation-error';
import { toast } from 'sonner';

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

      return response.items as unknown as Project[];
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

      return response as unknown as Project;
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
      startDate?: string;
      endDate?: string;
    }) => {
      // DEFENSIVE: Validate workspaceId is provided
      if (!data.workspaceId) {
        throw new Error('Workspace id is required. Please select a workspace first.');
      }

      // No code: the server mints one from the name that no other project in
      // the workspace uses. Owner and creator are the caller.
      const projectData = {
        workspaceId: data.workspaceId,
        name: data.name,
        description: data.description || '',
        clientName: data.clientName || '',
        status: 'PLANNING' as ProjectStatus,
        // Date-only ('YYYY-MM-DD'): the column is @db.Date, and an ISO instant
        // is truncated to the PREVIOUS day for any UTC+ timezone.
        startDate: data.startDate || new Date().toISOString().slice(0, 10),
        endDate: data.endDate,
      };

      const response = await resources.create('projects', projectData);
      return response as unknown as Project;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects', variables.workspaceId] });
      toast.success('Project created');
    },
    onError: (error: Error) => {
      toast.error('Failed to create project', { description: error instanceof Error ? error.message : String(error) });
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
      /** See EditBasedOn: refuses the save if somebody else has edited these fields. */
      basedOn?: Record<string, unknown>;
    }) => {
      const { projectId, workspaceId, ...updates } = data;
      const response = await resources.update('projects', projectId, updates);
      return response as unknown as Project;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.workspaceId] });
      toast.success('Project updated');
    },
    onError: (error: Error) => {
      showSaveFailure(error, 'Failed to update project');
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
      toast.success('Project deleted');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete project', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

/** What a copy brought with it, as the server counted it. */
export interface CloneSummary {
  sprints: number;
  clientRequirements: number;
  epics: number;
  functionalRequirements: number;
  tasks: number;
  /** Assignments left off because the person has left the workspace. */
  assignmentsDropped: number;
}

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 tasks, 3 epics and 2 sprints" — the parts that came with the copy, or ''. */
function describeCopy(copied: CloneSummary | undefined): string {
  if (!copied) return '';
  const parts = [
    copied.tasks ? counted(copied.tasks, 'task') : '',
    copied.functionalRequirements ? counted(copied.functionalRequirements, 'requirement') : '',
    copied.epics ? counted(copied.epics, 'epic') : '',
    copied.clientRequirements ? counted(copied.clientRequirements, 'client requirement') : '',
    copied.sprints ? counted(copied.sprints, 'sprint') : '',
  ].filter(Boolean);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function useCloneProject() {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * One request. The copy used to be made here — a create per sprint,
     * requirement, epic and task, with nothing holding them together — so a
     * failure part-way left half a project behind, and every create's own
     * notices went out, one per assigned task. The server copies the project in
     * one transaction: all of it, or none of it.
     */
    mutationFn: async (data: {
      sourceProjectId: string;
      newName: string;
      includeTasks: boolean;
      includeSprints: boolean;
    }) => {
      const response = await restClient.post(`/api/v1/projects/${data.sourceProjectId}/clone/`, {
        name: data.newName,
        includeTasks: data.includeTasks,
        includeSprints: data.includeSprints,
      });
      return response as unknown as Project & { copied?: CloneSummary };
    },
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      const what = describeCopy(newProject.copied);
      const dropped = newProject.copied?.assignmentsDropped ?? 0;
      toast.success('Project cloned', { description: `${newProject.name} was created${what ? ` with ${what}` : ''}.` +
          (dropped
            ? ` ${counted(dropped, 'assignment')} to people who have left the workspace ${dropped === 1 ? 'was' : 'were'} left off.`
            : '') });
    },
    onError: (error: Error) => {
      toast.error('Failed to clone project', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}
