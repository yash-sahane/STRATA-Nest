'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { roleDisplayName, useRoleOptions } from '@/hooks/use-role-options';
import { ApiError, restClient } from '@/lib/api/rest-client';
import { toast } from 'sonner';
import { useMyPermissionKeys } from '@/hooks/use-permissions';
import { useConfirm } from '@/components/providers/confirm-provider';
import { cn, formatDate } from '@/lib/utils';


/** One row of `/invite_codes` — only the fields these surfaces render. */
interface InviteCodeRow {
  id: string;
  code: string;
  role: string;
  createdAt: string;
  usedCount?: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

const PERMISSION_MESSAGE = 'You do not have permission to manage invite codes in this workspace.';

/**
 * How long a new code lasts. A week by default: codes are pasted into chats and
 * e-mails, and one made here used to work for ever, for any number of people,
 * unless somebody remembered to revoke it — the API took a limit and an expiry,
 * and this panel sent neither.
 */
const EXPIRY_CHOICES = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'never', label: 'Never' },
] as const;
type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]['value'];
const DEFAULT_EXPIRY: ExpiryChoice = '7';

/** Uses a code may be limited to. The column is a 32-bit integer; a team is not. */
const MAX_USES_LIMIT = 10_000;

/** '' means "no limit"; anything else must be a whole number in range. */
function parseMaxUses(input: string): { ok: true; value: number | null } | { ok: false } {
  const text = input.trim();
  if (text === '') return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false };
  const value = Number(text);
  return value >= 1 && value <= MAX_USES_LIMIT ? { ok: true, value } : { ok: false };
}

const isExpired = (row: InviteCodeRow, now: number): boolean =>
  !!row.expiresAt && new Date(row.expiresAt).getTime() <= now;
const isUsedUp = (row: InviteCodeRow): boolean =>
  row.maxUses != null && (row.usedCount ?? 0) >= row.maxUses;

/** "used 2 of 5" / "used 1 time". */
function usesLabel(row: InviteCodeRow): string {
  const used = row.usedCount ?? 0;
  return row.maxUses != null
    ? `used ${used} of ${row.maxUses}`
    : `used ${used} ${used === 1 ? 'time' : 'times'}`;
}

/** "never expires" / "expires Nov 13, 2026" / "expired Nov 13, 2026". */
function expiryLabel(row: InviteCodeRow, now: number): string {
  if (!row.expiresAt) return 'never expires';
  return `${isExpired(row, now) ? 'expired' : 'expires'} ${formatDate(row.expiresAt)}`;
}

/** What the code on show will still do: "It works until Nov 13, 2026, and can admit 3 more people." */
function termsOf(row: InviteCodeRow): string {
  const until = row.expiresAt ? `It works until ${formatDate(row.expiresAt)}` : 'It never expires';
  if (row.maxUses == null) return `${until}.`;
  const left = Math.max(0, row.maxUses - (row.usedCount ?? 0));
  return `${until}, and can admit ${left} more ${left === 1 ? 'person' : 'people'}.`;
}

/** `restClient` throws `ApiError` with the HTTP status on `.code`. Only a 403
 *  means "not allowed" — a 500 or a dropped connection must not be reported as
 *  one, or the manager goes looking for a permission they already hold. */
const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.code === 403;

/** The workspace role <Select> shared by every invite surface. Offers the
 *  roles the caller may hand out in `workspaceId` — built-in and the workspace's
 *  own — and only those: the API refuses the rest. */
export function InviteRoleSelect({
  id,
  workspaceId,
  value,
  onChange,
  disabled,
}: {
  id: string;
  workspaceId: string;
  /** A built-in role key, or the name of one of the workspace's custom roles. */
  value: string;
  onChange: (role: string) => void;
  disabled?: boolean;
}) {
  const { grantable } = useRoleOptions(workspaceId);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select a role" />
      </SelectTrigger>
      <SelectContent>
        {grantable.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The one place that produces a REDEEMABLE invite code (Team > Add Members >
 * Invite code).
 *
 * Invite codes live in their own table, and nothing in the product ever wrote
 * to it: the "Invite Code" the Settings tab used to print was
 * `Workspace.inviteCode`, a column minted at workspace creation that
 * `POST /workspaces/accept-invitation` has never looked at — so the code the app
 * told managers to share came back "Invalid invite code" from the one box built
 * to take it. Everything that offers a code now mints it here, so there is no
 * second, dead version of the same affordance to drift out of sync.
 *
 * The query and mutation are declared in this module rather than in
 * `hooks/use-workspace` because this component is their only consumer.
 */
export function InviteCodePanel({
  workspaceId,
  role,
  /** Skip the request until the panel is actually on screen: listing codes
   *  takes `invite:manage`, which a custom role holding only `member:invite`
   *  need not have, and a 403 fired on mount would be noise. */
  enabled = true,
  idPrefix = 'invite-code',
}: {
  workspaceId: string;
  role: string;
  enabled?: boolean;
  idPrefix?: string;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = React.useState(false);
  const [expiry, setExpiry] = React.useState<ExpiryChoice>(DEFAULT_EXPIRY);
  const [maxUsesInput, setMaxUsesInput] = React.useState('');
  const maxUses = parseMaxUses(maxUsesInput);
  const confirm = useConfirm();
  // The permission the API reads and mints codes by. Both screens that host
  // this panel sit behind a different one, so somebody without `invite:manage`
  // used to be shown the panel and then a failed request.
  const { keys: heldKeys, isLoading: keysLoading } = useMyPermissionKeys(workspaceId);
  const canManageCodes = heldKeys.has('*') || heldKeys.has('invite:manage');

  const codesQuery = useQuery({
    queryKey: ['invite-codes', workspaceId],
    queryFn: async () => {
      const response = (await restClient.get('/api/v1/invite_codes/', {
        params: { workspaceId },
      })) as { items?: InviteCodeRow[] };
      return response.items ?? [];
    },
    enabled: enabled && Boolean(workspaceId) && canManageCodes,
  });

  const createCode = useMutation({
    mutationFn: async (input: { role: string; days: number | null; maxUses: number | null }) =>
      (await restClient.post('/api/v1/invite_codes/', {
        workspaceId,
        role: input.role,
        // Omitted, not null, for "never" and "no limit": the API's defaults.
        ...(input.days !== null
          ? { expiresAt: new Date(Date.now() + input.days * 86_400_000).toISOString() }
          : {}),
        ...(input.maxUses !== null ? { maxUses: input.maxUses } : {}),
      })) as InviteCodeRow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes', workspaceId] });
      toast.success('Invite code created', {
        description: 'Share it with anyone who should join at this role.',
      });
    },
    onError: (error: unknown) => {
      // Same distinction as the read path: a 403 here is a permission answer,
      // anything else is a failure, and reporting the raw envelope for a 403
      // ("You do not have permission to perform this action.") tells the
      // manager nothing about WHICH permission.
      toast.error(
        isForbidden(error)
          ? PERMISSION_MESSAGE
          : (error instanceof Error ? error.message : String(error)) ||
              'Failed to create an invite code'
      );
    },
  });

  const revokeCode = useMutation({
    mutationFn: async (codeId: string) => {
      await restClient.delete(`/api/v1/invite_codes/${codeId}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes', workspaceId] });
      toast.success('Invite code revoked');
    },
    onError: (error: unknown) => {
      toast.error(
        isForbidden(error)
          ? PERMISSION_MESSAGE
          : (error instanceof Error ? error.message : String(error)) ||
              'Failed to revoke the invite code'
      );
    },
  });

  // The newest live code for the selected role. Generating is explicit, so an
  // existing code is reused rather than a fresh row minted on every open — but
  // never one that has expired or run out of uses: offering that to copy
  // handed out a code that answers "expired" to whoever it is sent to.
  const activeCode = React.useMemo(() => {
    const now = Date.now();
    const rows = (codesQuery.data ?? []).filter(
      (c) => c.role === role && !isExpired(c, now) && !isUsedUp(c)
    );
    return rows.length
      ? rows.reduce((newest, c) => (c.createdAt > newest.createdAt ? c : newest))
      : undefined;
  }, [codesQuery.data, role]);

  const roleLabel = roleDisplayName(role);

  // The copy affordance is per-code: leaving "Copied" up after the role changes
  // (and with it the code on screen) would claim the wrong string is on the
  // clipboard.
  React.useEffect(() => setCopied(false), [activeCode?.code]);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      // Revert the button rather than leaving a permanent "Copied", which stops
      // telling the truth the moment the clipboard is used for anything else.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded browsers; the code is selectable, so say so instead of
      // failing silently.
      toast.error('Could not copy automatically — select the code and copy it.');
    }
  };

  // `isPending`, not `isLoading`: with no data yet there is nothing truthful to
  // render, and falling through would print "No invite code for this role yet"
  // over a list that has not arrived — inviting a duplicate code.
  // Asked first: with the permission missing the codes query never runs, and
  // a query that never runs stays "pending" — so a role without invite:manage
  // was told "Looking for an existing code…" for ever.
  if (keysLoading) {
    return <p className="text-sm text-muted-foreground">Looking for an existing code…</p>;
  }
  if (!canManageCodes) {
    return (
      <p className="text-sm text-muted-foreground">
        Your role cannot create or see invite codes for this workspace.
      </p>
    );
  }
  if (codesQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Looking for an existing code…</p>;
  }

  if (codesQuery.isError) {
    return isForbidden(codesQuery.error) ? (
      <p className="text-sm text-destructive-text">{PERMISSION_MESSAGE}</p>
    ) : (
      <div className="space-y-2">
        <p className="text-sm text-destructive-text">
          Could not load this workspace&apos;s invite codes.
        </p>
        <p className="text-xs text-muted-foreground">
          {codesQuery.error instanceof Error
            ? codesQuery.error.message
            : 'The request did not come back.'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={codesQuery.isFetching}
          onClick={() => void codesQuery.refetch()}
        >
          {codesQuery.isFetching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Retrying
            </>
          ) : (
            'Try again'
          )}
        </Button>
      </div>
    );
  }

  const allCodes = [...(codesQuery.data ?? [])].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
  // Read once per render for the list's labels; a code passing its expiry while
  // the panel is open is caught by the API on redemption either way.
  const now = Date.now();

  const handleRevoke = async (row: InviteCodeRow) => {
    const proceed = await confirm({
      title: 'Revoke this invite code?',
      description: `Nobody will be able to join with ${row.code} any more. People who already joined with it are not affected.`,
      confirmText: 'Revoke',
      destructive: true,
    });
    if (proceed) revokeCode.mutate(row.id);
  };

  return (
    <div className="space-y-4">
      {activeCode ? (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-value`}>Invite code</Label>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-value`}
              value={activeCode.code}
              readOnly
              className="font-mono tracking-widest"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={() => handleCopy(activeCode.code)}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone who already has an account can join as {roleLabel} with this code: on the
            &ldquo;No workspace yet&rdquo; screen, or under Workspaces &gt; Join a workspace.{' '}
            {termsOf(activeCode)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No working invite code for the {roleLabel} role.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-expiry`}>New code expires after</Label>
          <Select value={expiry} onValueChange={(value) => setExpiry(value as ExpiryChoice)}>
            <SelectTrigger id={`${idPrefix}-expiry`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-max-uses`}>Number of people it can admit</Label>
          {/* Text, not type="number": a browser hands back "" for "1e" or "-",
              which would read as "no limit". */}
          <Input
            id={`${idPrefix}-max-uses`}
            inputMode="numeric"
            placeholder="No limit"
            value={maxUsesInput}
            onChange={(e) => setMaxUsesInput(e.target.value)}
            aria-invalid={!maxUses.ok}
            aria-describedby={maxUses.ok ? undefined : `${idPrefix}-max-uses-error`}
          />
          {!maxUses.ok && (
            <p id={`${idPrefix}-max-uses-error`} className="text-xs text-destructive-text">
              A whole number from 1 to {MAX_USES_LIMIT.toLocaleString('en-US')}, or leave it
              empty for no limit.
            </p>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant={activeCode ? 'outline' : 'default'}
        className="w-full"
        disabled={createCode.isPending || !maxUses.ok}
        onClick={() => {
          if (!maxUses.ok) return;
          setCopied(false);
          createCode.mutate({
            role,
            days: expiry === 'never' ? null : Number(expiry),
            maxUses: maxUses.value,
          });
        }}
      >
        {createCode.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating code...
          </>
        ) : (
          <>
            <KeyRound className="mr-2 h-4 w-4" />
            {activeCode ? 'Create a new code' : 'Create an invite code'}
          </>
        )}
      </Button>

      {/* Every code, with the means to stop it working. Creating a new one
          does not retire the old, and until this list existed nothing showed
          them or could revoke them — a code copied by somebody since removed
          kept letting them back in. One that has expired or run out of uses is
          marked so, and revoking it just tidies the list. Only codes for roles
          the viewer could grant are listed; the API withholds the rest. */}
      {allCodes.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Codes ({allCodes.length})</p>
          <p className="text-xs text-muted-foreground">
            Each one works until it expires, has admitted as many people as it allows, or is
            revoked. Creating a new code does not retire the old ones.
          </p>
          <ul className="space-y-2">
            {allCodes.map((row) => {
              const dead = isExpired(row, now) ? 'Expired' : isUsedUp(row) ? 'Used up' : null;
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'font-mono text-sm tracking-widest',
                          dead && 'text-muted-foreground line-through'
                        )}
                      >
                        {row.code}
                      </span>
                      {dead && <Badge variant="secondary">{dead}</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {roleDisplayName(row.role)} · {usesLabel(row)} · {expiryLabel(row, now)} ·
                      created {formatDate(row.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revokeCode.isPending}
                    onClick={() => void handleRevoke(row)}
                  >
                    Revoke
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
