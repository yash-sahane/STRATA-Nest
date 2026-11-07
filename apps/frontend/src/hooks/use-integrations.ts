import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resources, query } from '@/lib/api/client';
import { API_BASE, restClient } from '@/lib/api/rest-client';
import { COLLECTIONS } from '@/lib/api/config';
import type { GitCommit } from '@/types';

/**
 * Git and Discord integrations for a project.
 *
 * The API for these has been complete for a while — CRUD on three providers,
 * tokens encrypted at rest and never echoed back — and had no client at all, so
 * none of it was reachable from the application. These hooks and the panel in
 * Settings are that client.
 *
 * `lastTestOk` is the field worth understanding: it is `null` until somebody
 * tests the credential, because saving one never used to check it. A garbage
 * token and a repository that does not exist saved happily and then silently
 * never worked, so "never verified" has to be a state the UI can show rather
 * than something it infers from a blank.
 */

export type IntegrationProvider = 'github' | 'gitlab' | 'discord';

interface VerificationState {
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestError?: string | null;
}

/**
 * The receiving half of a repository integration.
 *
 * Connecting a repository stores how to REACH it. Commits arrive the other way:
 * the provider calls a webhook, signed with a secret this server minted, and
 * without that secret every delivery is refused. `webhookConfigured` is whether
 * one exists; the secret itself is only ever in the response that created it.
 */
interface WebhookState {
  webhookConfigured: boolean;
  /** Relative to the API's `/api/v1` prefix — see `webhookUrlFor`. */
  webhookPath: string;
}

export interface GitHubIntegration extends VerificationState, WebhookState {
  id: string;
  projectId: string;
  repoOwner: string;
  repoName: string;
  autoUpdateStatus: boolean;
  enabledEvents: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface GitLabIntegration extends VerificationState, WebhookState {
  id: string;
  projectId: string;
  projectPath: string;
  autoUpdateStatus: boolean;
  enabledEvents: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface DiscordIntegration extends VerificationState {
  id: string;
  projectId: string;
  /** The tail of the webhook's id. The URL is a credential and is never sent back. */
  webhookHint: string;
  enabledEvents: unknown[];
  createdAt: string;
  updatedAt: string;
}

/** The address a provider has to be given, in full. */
export function webhookUrlFor(integration: WebhookState): string {
  return `${API_BASE}/api/v1${integration.webhookPath}`;
}

const COLLECTION: Record<IntegrationProvider, string> = {
  github: COLLECTIONS.GITHUB_INTEGRATIONS,
  gitlab: COLLECTIONS.GITLAB_INTEGRATIONS,
  discord: COLLECTIONS.DISCORD_INTEGRATIONS,
};

export const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  discord: 'Discord',
};

/** Every provider's integration for one project, in one query per provider. */
export function useIntegrations<T>(provider: IntegrationProvider, projectId?: string) {
  return useQuery<T[]>({
    queryKey: ['integrations', provider, projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return [];
      const response = await resources.listAll<T>(COLLECTION[provider], [
        query.equal('projectId', projectId),
      ]);
      return response.items;
    },
  });
}

export function useCreateIntegration(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      // The second argument is the server-ignored resourceId; the body is the
      // third. Passing the payload second creates an EMPTY row.
      resources.create(COLLECTION[provider], payload),
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', provider, (payload as { projectId?: string }).projectId],
      });
    },
  });
}

export function useDeleteIntegration(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId?: string }) =>
      resources.remove(COLLECTION[provider], id),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', provider, variables.projectId],
      });
    },
  });
}

export interface IntegrationTestResult {
  ok: boolean;
  detail: string;
  testedAt: string;
}

/**
 * Ask the provider whether the stored credential works, and record the answer.
 *
 * The result is persisted server-side, so the list can go on showing it after
 * this response is gone — which is the whole point. A verdict that lives only in
 * one HTTP response tells nobody, later, whether the integration ever worked.
 */
export function useTestIntegration(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  return useMutation<IntegrationTestResult, Error, { id: string; projectId?: string }>({
    mutationFn: async ({ id }) =>
      restClient.post(
        `/api/v1/${COLLECTION[provider]}/${id}/test/`,
        {},
      ) as Promise<IntegrationTestResult>,
    onSettled: (_data, _error, variables) => {
      // onSettled, not onSuccess: a FAILED test is a result worth showing, and
      // the row's lastTestOk/lastTestError have changed either way.
      queryClient.invalidateQueries({
        queryKey: ['integrations', provider, variables.projectId],
      });
    },
  });
}

/**
 * Mint the webhook secret for a repository integration — or replace it.
 *
 * Resolves with the secret, which no other response carries: the caller has to
 * show it there and then. Replacing one stops the old one working at once.
 */
export function useRotateWebhookSecret(provider: 'github' | 'gitlab') {
  const queryClient = useQueryClient();
  return useMutation<{ webhookSecret: string }, Error, { id: string; projectId?: string }>({
    mutationFn: async ({ id }) =>
      restClient.post(`/api/v1/${COLLECTION[provider]}/${id}/webhook-secret/`, {}) as Promise<{
        webhookSecret: string;
      }>,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', provider, variables.projectId],
      });
    },
  });
}

/** Change a setting on a repository integration (today: `autoUpdateStatus`). */
export function useUpdateIntegration(provider: 'github' | 'gitlab') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: string;
      projectId?: string;
      changes: { autoUpdateStatus: boolean };
    }) => resources.update(COLLECTION[provider], id, changes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', provider, variables.projectId],
      });
    },
  });
}

/**
 * The commits that mention a task, newest first.
 *
 * The worker has linked every pushed commit to the tasks its message names for
 * as long as there has been a webhook receiver, and nothing ever read the result
 * back: the link existed in the database and on no screen.
 */
export function useTaskCommits(taskId?: string, projectId?: string) {
  return useQuery<GitCommit[]>({
    queryKey: ['task-commits', taskId],
    enabled: Boolean(taskId && projectId),
    queryFn: async () => {
      if (!taskId || !projectId) return [];
      const response = await resources.list<GitCommit>(COLLECTIONS.GIT_COMMITS, [
        query.equal('projectId', projectId),
        query.equal('taskId', taskId),
        query.orderDesc('timestamp'),
        query.limit(20),
      ]);
      return response.items;
    },
    staleTime: 60 * 1000,
  });
}
