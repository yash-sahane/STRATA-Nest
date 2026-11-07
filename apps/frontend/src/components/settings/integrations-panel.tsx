'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ErrorState } from '@/components/ui/error-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  KeyRound,
  Loader2,
  Plug,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useHasPermissionKey } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/providers/confirm-provider';
import {
  PROVIDER_LABEL,
  useCreateIntegration,
  useDeleteIntegration,
  useIntegrations,
  useRotateWebhookSecret,
  useTestIntegration,
  useUpdateIntegration,
  webhookUrlFor,
  type DiscordIntegration,
  type GitHubIntegration,
  type GitLabIntegration,
  type IntegrationProvider,
} from '@/hooks/use-integrations';

/**
 * Git and Discord integrations, per project.
 *
 * Two halves, and for a long time only one of them was here. Connecting a
 * repository stores how to reach it; commits come the OTHER way, through a
 * webhook the provider calls, signed with a secret. The form never asked for a
 * secret and nothing generated one, so a repository could be connected, tested
 * and shown as "Working" while every push it sent was turned away. The webhook
 * block on each row is that second half: the address, a secret minted on demand
 * and shown once, and what to paste where.
 *
 * The verification state is the other part worth designing carefully. Saving a
 * credential never used to check it, so a garbage token and a repository that
 * does not exist saved happily and then silently never worked. "Not verified" is
 * therefore shown as its own state, distinct from "working" and from "failing" —
 * a blank would leave the user exactly where they were.
 */

type GitProvider = 'github' | 'gitlab';
type GitIntegration = GitHubIntegration | GitLabIntegration;
type AnyIntegration = GitIntegration | DiscordIntegration;

const isGit = (provider: IntegrationProvider): provider is GitProvider => provider !== 'discord';

/** Which fields each provider needs, so one form serves all three. */
const FIELDS: Record<
  IntegrationProvider,
  Array<{ name: string; label: string; placeholder: string; secret?: boolean; hint?: string }>
> = {
  github: [
    { name: 'repoOwner', label: 'Repository owner', placeholder: 'octocat' },
    { name: 'repoName', label: 'Repository name', placeholder: 'hello-world' },
    {
      name: 'accessToken',
      label: 'Access token',
      placeholder: 'ghp_…',
      secret: true,
      hint: 'Read access to the repository is enough. It is only used to check the repository can be reached.',
    },
  ],
  gitlab: [
    { name: 'projectPath', label: 'Project path', placeholder: 'group/subgroup/project' },
    {
      name: 'accessToken',
      label: 'Access token',
      placeholder: 'glpat-…',
      secret: true,
      hint: 'The read_api scope is enough. It is only used to check the project can be reached.',
    },
  ],
  discord: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/…',
      secret: true,
      hint: 'In Discord: channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL.',
    },
  ],
};

/** What each provider is for — exactly what it does today, and no more. */
const PURPOSE: Record<IntegrationProvider, string> = {
  github:
    'Record the commits pushed to a repository and link each one to the tasks its message mentions.',
  gitlab:
    'Record the commits pushed to a project and link each one to the tasks its message mentions.',
  discord:
    'Post a message to a Discord channel when new commits are recorded for this project. Needs GitHub or GitLab connected as well.',
};

/** Where, in the provider's own interface, a webhook is added. */
const WEBHOOK_STEPS: Record<GitProvider, { where: string; url: string; secret: string; rest: string }> =
  {
    github: {
      where: 'In the repository on GitHub, open Settings > Webhooks > Add webhook.',
      url: 'Payload URL',
      secret: 'Secret',
      rest: 'Set Content type to application/json and keep “Just the push event”.',
    },
    gitlab: {
      where: 'In the project on GitLab, open Settings > Webhooks > Add new webhook.',
      url: 'URL',
      secret: 'Secret token',
      rest: 'Tick “Push events” and leave the rest off.',
    },
  };

/** How each provider identifies itself in the list. */
function describe(provider: IntegrationProvider, row: AnyIntegration): string {
  if (provider === 'github') {
    const g = row as GitHubIntegration;
    return `${g.repoOwner}/${g.repoName}`;
  }
  if (provider === 'gitlab') return (row as GitLabIntegration).projectPath;
  // Never the URL: a Discord webhook URL IS the credential, and the API no
  // longer sends it back at all — only enough of its id to tell two apart.
  const hint = (row as DiscordIntegration).webhookHint;
  return hint ? `Webhook …${hint}` : 'Webhook';
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

/** A value somebody has to paste somewhere else, with the button to take it. */
function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy automatically — select the text and copy it.');
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={`Copy ${label}`}
          onClick={copy}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * The receiving half of a repository integration: where the provider sends
 * commits, and the secret it signs them with.
 */
function WebhookSetup({
  provider,
  row,
  canManage,
}: {
  provider: GitProvider;
  row: GitIntegration;
  canManage: boolean;
}) {
  const rotate = useRotateWebhookSecret(provider);
  const update = useUpdateIntegration(provider);
  const confirm = useConfirm();
  // The secret exists in the response that minted it and nowhere else, so it is
  // held here, for as long as this row stays on screen.
  const [secret, setSecret] = React.useState<string | null>(null);
  const steps = WEBHOOK_STEPS[provider];
  const url = webhookUrlFor(row);
  // A provider cannot call a machine's own loopback address.
  const unreachable = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(url);

  const generate = async () => {
    if (row.webhookConfigured) {
      const ok = await confirm({
        title: 'Replace the webhook secret?',
        description: `The current secret stops working straight away. Commits will not be recorded again until the new one is saved in ${PROVIDER_LABEL[provider]}.`,
        confirmText: 'Replace Secret',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      const result = await rotate.mutateAsync({ id: row.id, projectId: row.projectId });
      setSecret(result.webhookSecret);
    } catch (error) {
      toast.error('Could not generate a webhook secret', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const setAutoUpdate = async (autoUpdateStatus: boolean) => {
    try {
      await update.mutateAsync({
        id: row.id,
        projectId: row.projectId,
        changes: { autoUpdateStatus },
      });
    } catch (error) {
      toast.error('Could not change that setting', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const switchId = `${provider}-${row.id}-auto-update`;

  return (
    <div className="space-y-4 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Receiving commits</p>
          <p className="text-sm text-muted-foreground">
            {row.webhookConfigured
              ? `${PROVIDER_LABEL[provider]} sends each push to the webhook below.`
              : `Not set up yet, so no commits are being recorded. ${PROVIDER_LABEL[provider]} has to be given a webhook to send them to.`}
          </p>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" onClick={generate} disabled={rotate.isPending}>
            {rotate.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="mr-1 h-3.5 w-3.5" />
            )}
            {row.webhookConfigured ? 'Replace Secret' : 'Set Up Webhook'}
          </Button>
        )}
      </div>

      {(row.webhookConfigured || secret) && (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
          <CopyField id={`${provider}-${row.id}-webhook-url`} label={steps.url} value={url} />
          {secret && (
            <>
              <CopyField
                id={`${provider}-${row.id}-webhook-secret`}
                label={steps.secret}
                value={secret}
              />
              <p className="text-sm text-muted-foreground">
                Copy the secret now — it is not shown again. If it is lost, replace it.
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{steps.where}</li>
                <li>
                  Paste the {steps.url} and the {steps.secret} from above.
                </li>
                <li>{steps.rest}</li>
              </ol>
            </>
          )}
          {unreachable && (
            <p className="text-sm text-warning-text">
              This address is on this machine, so {PROVIDER_LABEL[provider]} cannot reach it. The
              API needs a public address before commits can arrive.
            </p>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor={switchId}>Move a task to Review when a commit fixes it</Label>
          {/* The rule the worker applies (git.processor closingRefs): the keyword
              right before the ID, never a revert. */}
          <p className="text-sm text-muted-foreground">
            A commit that mentions a task by its ID after a # is linked to that task either way.
            With this on, a commit that says fixes, closes or resolves directly before the ID — for
            example <code className="rounded bg-muted px-1 py-0.5 text-xs">fixes #PRJ-T03</code>{' '}
            — also moves it to Review, the first time that commit arrives. A revert never does.
            Marking it done stays a person&apos;s call.
          </p>
        </div>
        <Switch
          id={switchId}
          checked={row.autoUpdateStatus}
          onCheckedChange={setAutoUpdate}
          disabled={!canManage || update.isPending}
        />
      </div>
    </div>
  );
}

function ProviderSection({
  provider,
  projectId,
  canManage,
}: {
  provider: IntegrationProvider;
  projectId?: string;
  canManage: boolean;
}) {
  const {
    data: rows = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useIntegrations<AnyIntegration>(provider, projectId);
  // A failed read is not "nothing connected". It left `rows` empty, so a 5xx
  // read "Not connected" and offered the form — and connecting again was
  // refused, because the integration the read failed to fetch was still there
  // (one per project per provider). Only a read that succeeded empty says so.
  const notConnected = !isLoading && !isError && rows.length === 0;
  const retrying = isError && isFetching;
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
      toast.success(`${PROVIDER_LABEL[provider]} connected`, {
        // Connecting is neither verifying nor receiving: say what is still to do.
        description: isGit(provider)
          ? 'Saved, but not checked: press "Test connection" to verify it. Then set up the webhook so commits start arriving.'
          : 'Saved, but not checked: press "Test connection" to verify the webhook is live.',
      });
    } catch (error) {
      toast.error(`Could not connect ${PROVIDER_LABEL[provider]}`, {
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
      description: `${describe(provider, row)} will be disconnected and its stored credential deleted. Commits already recorded stay on their tasks. This cannot be undone.`,
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
        <CardDescription>{PURPOSE[provider]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || retrying ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <ErrorState
            className="p-6"
            title={`Couldn't load the ${PROVIDER_LABEL[provider]} integration`}
            description="Whether one is connected is not known until this loads."
            onRetry={() => refetch()}
          />
        ) : notConnected ? (
          <p className="text-sm text-muted-foreground">
            {canManage
              ? 'Not connected. Fill in the fields below to connect one.'
              : 'Not connected.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium" title={describe(provider, row)}>{describe(provider, row)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <VerificationBadge row={row} />
                    </div>
                    {row.lastTestOk === false && row.lastTestError ? (
                      // The reason, not just the verdict: "not working" alone leaves
                      // the user guessing between a bad token and a wrong repo name.
                      <p className="text-xs text-destructive-text">{row.lastTestError}</p>
                    ) : null}
                  </div>
                  {canManage && (
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
                  )}
                </div>
                {isGit(provider) && (
                  <WebhookSetup
                    provider={provider}
                    row={row as GitIntegration}
                    canManage={canManage}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {/* One integration per project per provider — the model has projectId
            @unique — so the form is hidden once one exists, and until a read
            has shown that none does. */}
        {notConnected && canManage && (
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
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
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
  // Reading an integration is open to every member; connecting, testing and
  // removing one take integration:write, which is what the API checks. The
  // controls used to be offered to everybody and came back 403.
  const canManage = useHasPermissionKey(currentWorkspace?.id, 'integration:write');

  // Integrations are per PROJECT, so one has to be chosen before anything here
  // means something — and the choice must not outlive the workspace it was made
  // in, or the panel goes on showing a project from the one just left.
  React.useEffect(() => {
    if (projects.length === 0) {
      if (projectId) setProjectId('');
      return;
    }
    if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0].id);
  }, [projectId, projects]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Connect a repository to a project so its commits show up on the tasks they mention, and
            optionally announce them in a Discord channel. Credentials are encrypted before they
            are stored and are never shown again.
            {!canManage && ' Your role can see what is connected, but not change it.'}
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
          <ProviderSection provider="github" projectId={projectId} canManage={canManage} />
          <ProviderSection provider="gitlab" projectId={projectId} canManage={canManage} />
          <ProviderSection provider="discord" projectId={projectId} canManage={canManage} />
        </>
      )}
    </div>
  );
}
