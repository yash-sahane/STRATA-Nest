'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, CheckCircle2, HelpCircle, Loader2, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useConfirm } from '@/components/providers/confirm-provider';
import {
  PROVIDER_LABEL,
  useCreateIntegration,
  useDeleteIntegration,
  useIntegrations,
  useTestIntegration,
  type DiscordIntegration,
  type GitHubIntegration,
  type GitLabIntegration,
  type IntegrationProvider,
} from '@/hooks/use-integrations';

/**
 * Git and Discord integrations, per project.
 *
 * The API for these was complete and had no client whatsoever: three providers
 * with CRUD, tokens encrypted at rest, webhook receivers that verify signatures —
 * and no way to configure any of it from the application. Nothing here is new
 * server capability; it is the missing half.
 *
 * The verification state is the part worth designing carefully. Saving a
 * credential never used to check it, so a garbage token and a repository that
 * does not exist saved happily and then silently never worked. "Not verified" is
 * therefore shown as its own state, distinct from "working" and from "failing" —
 * a blank would leave the user exactly where they were.
 */

type AnyIntegration = (GitHubIntegration | GitLabIntegration | DiscordIntegration) & {
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestError?: string | null;
};

/** Which fields each provider needs, so one form serves all three. */
const FIELDS: Record<
  IntegrationProvider,
  Array<{ name: string; label: string; placeholder: string; secret?: boolean }>
> = {
  github: [
    { name: 'repoOwner', label: 'Repository owner', placeholder: 'octocat' },
    { name: 'repoName', label: 'Repository name', placeholder: 'hello-world' },
    {
      name: 'accessToken',
      label: 'Access token',
      placeholder: 'ghp_…',
      secret: true,
    },
  ],
  gitlab: [
    { name: 'projectPath', label: 'Project path', placeholder: 'group/subgroup/project' },
    { name: 'accessToken', label: 'Access token', placeholder: 'glpat-…', secret: true },
  ],
  discord: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/…',
      secret: true,
    },
  ],
};

/** How each provider identifies itself in the list. */
function describe(provider: IntegrationProvider, row: AnyIntegration): string {
  if (provider === 'github') {
    const g = row as GitHubIntegration;
    return `${g.repoOwner}/${g.repoName}`;
  }
  if (provider === 'gitlab') return (row as GitLabIntegration).projectPath;
  // Never the full URL: a Discord webhook URL IS the credential.
  const d = row as DiscordIntegration;
  const tail = d.webhookUrl?.split('/').filter(Boolean).slice(-2, -1)[0] ?? '';
  return tail ? `Webhook …${tail.slice(-6)}` : 'Webhook';
}

function VerificationBadge({ row }: { row: AnyIntegration }) {
  // Three states, not two. `lastTestOk === null` means nobody has ever checked,
  // which is different from "checked and broken" — and was previously
  // indistinguishable from "working".
  if (row.lastTestOk === true) {
    return (
      <Badge variant="outline" className="gap-1 text-success-text">
        <CheckCircle2 className="h-3 w-3" />
        Working
        {row.lastTestedAt
          ? ` · checked ${formatDistanceToNow(new Date(row.lastTestedAt), { addSuffix: true })}`
          : ''}
      </Badge>
    );
  }
  if (row.lastTestOk === false) {
    return (
      <Badge variant="outline" className="gap-1 text-destructive-text">
        <AlertCircle className="h-3 w-3" />
        Not working
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 text-muted-foreground"
      title="Saving a credential does not check it. Press Test connection to find out whether it works."
    >
      <HelpCircle className="h-3 w-3" />
      Not verified
    </Badge>
  );
}

function ProviderSection({
  provider,
  projectId,
}: {
  provider: IntegrationProvider;
  projectId?: string;
}) {
  const { data: rows = [], isLoading } = useIntegrations<AnyIntegration>(provider, projectId);
  const create = useCreateIntegration(provider);
  const remove = useDeleteIntegration(provider);
  const test = useTestIntegration(provider);
  const confirm = useConfirm();

  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const fields = FIELDS[provider];
  const complete = fields.every((f) => (draft[f.name] ?? '').trim().length > 0);

  const onCreate = async () => {
    if (!projectId || !complete) return;
    try {
      await create.mutateAsync({ projectId, ...draft });
      setDraft({});
      toast.success(`${PROVIDER_LABEL[provider]} integration saved`, {
        // Say plainly that saving is not verifying — this is the whole finding.
        description: 'Saving does not check the credential. Press "Test connection" to verify it.',
      });
    } catch (error) {
      toast.error(`Could not save the ${PROVIDER_LABEL[provider]} integration`, {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onTest = async (row: AnyIntegration) => {
    try {
      const result = await test.mutateAsync({ id: row.id, projectId });
      if (result.ok) toast.success(`${PROVIDER_LABEL[provider]}: ${result.detail}`);
      else toast.error(`${PROVIDER_LABEL[provider]}: ${result.detail}`);
    } catch (error) {
      toast.error('The test could not be run', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onRemove = async (row: AnyIntegration) => {
    const ok = await confirm({
      title: `Remove this ${PROVIDER_LABEL[provider]} integration?`,
      description: `${describe(provider, row)} will be disconnected and its stored credential deleted. This cannot be undone.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: row.id, projectId });
      toast.success(`${PROVIDER_LABEL[provider]} integration removed`);
    } catch (error) {
      toast.error('Could not remove the integration', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{PROVIDER_LABEL[provider]}</CardTitle>
        <CardDescription>
          {provider === 'discord'
            ? 'Post project activity to a Discord channel.'
            : 'Link commits to tasks, and optionally move a task when its commit lands.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not connected. Fill in the fields below to connect one.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{describe(provider, row)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <VerificationBadge row={row} />
                  </div>
                  {row.lastTestOk === false && row.lastTestError ? (
                    // The reason, not just the verdict: "not working" alone leaves
                    // the user guessing between a bad token and a wrong repo name.
                    <p className="text-xs text-destructive-text">{row.lastTestError}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onTest(row)}
                    disabled={test.isPending}
                  >
                    {test.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plug className="mr-1 h-3.5 w-3.5" />
                    )}
                    Test connection
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive-text hover:text-destructive-text"
                    aria-label={`Remove ${PROVIDER_LABEL[provider]} integration ${describe(provider, row)}`}
                    onClick={() => onRemove(row)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* One integration per project per provider — the model has projectId
            @unique — so the form is hidden once one exists. */}
        {rows.length === 0 && (
          <div className="space-y-3 rounded-lg border border-dashed p-3">
            {fields.map((f) => (
              <div key={f.name} className="grid gap-2">
                <Label htmlFor={`${provider}-${f.name}`}>{f.label}</Label>
                <Input
                  id={`${provider}-${f.name}`}
                  // Secrets are never rendered back by the API, and should not be
                  // readable here either.
                  type={f.secret ? 'password' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  placeholder={f.placeholder}
                  value={draft[f.name] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                />
              </div>
            ))}
            <Button onClick={onCreate} disabled={!projectId || !complete || create.isPending}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect {PROVIDER_LABEL[provider]}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IntegrationsPanel() {
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [], isLoading: projectsLoading } = useProjects(currentWorkspace?.id);
  const [projectId, setProjectId] = React.useState<string>('');

  // Integrations are per PROJECT, so one has to be chosen before anything here
  // means something.
  React.useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Connect a repository or a Discord channel to a project. Credentials are encrypted before
            they are stored and are never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <Skeleton className="h-9 w-full sm:w-[320px]" />
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Integrations belong to a project, and this workspace has none yet.
            </p>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="integration-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="integration-project" className="w-full sm:w-[320px]">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {projectId && (
        <>
          <ProviderSection provider="github" projectId={projectId} />
          <ProviderSection provider="gitlab" projectId={projectId} />
          <ProviderSection provider="discord" projectId={projectId} />
        </>
      )}
    </div>
  );
}
