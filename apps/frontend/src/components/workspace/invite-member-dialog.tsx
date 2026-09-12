'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInviteMember } from '@/hooks/use-workspace';
import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, restClient } from '@/lib/api/rest-client';
import { toast } from 'sonner';
import type { UserRole } from '@/types';

interface InviteMemberDialogProps {
  workspaceId: string;
}

/** The seven built-in roles, in the order ROLE_PERMISSIONS declares them.
 *  Exported so every invite surface offers exactly the same list. */
export const INVITE_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ASSISTANT_MANAGER', label: 'Assistant Manager' },
  { value: 'SOFTWARE_DEVELOPER', label: 'Software Developer' },
  { value: 'DEVELOPER_INTERN', label: 'Developer Intern' },
  { value: 'TESTER', label: 'Tester' },
  { value: 'CONTENT_ENGINEER', label: 'Content Engineer' },
  { value: 'MEMBER', label: 'Member' },
];

export const inviteRoleLabel = (role: UserRole | string): string =>
  INVITE_ROLE_OPTIONS.find((r) => r.value === role)?.label ?? String(role);

/** One row of `/invite_codes` — only the fields these surfaces render. */
interface InviteCodeRow {
  id: string;
  code: string;
  role: string;
  createdAt: string;
}

const PERMISSION_MESSAGE = 'You do not have permission to manage invite codes in this workspace.';

/** `restClient` throws `ApiError` with the HTTP status on `.code`. Only a 403
 *  means "not allowed" — a 500 or a dropped connection must not be reported as
 *  one, or the manager goes looking for a permission they already hold. */
const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.code === 403;

/** The workspace role <Select> shared by every invite surface. */
export function InviteRoleSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: UserRole;
  onChange: (role: UserRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as UserRole)} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select a role" />
      </SelectTrigger>
      <SelectContent>
        {INVITE_ROLE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The one place that produces a REDEEMABLE invite code, used by both surfaces
 * that offer one (this dialog, and Settings > Workspace).
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
  role: UserRole;
  enabled?: boolean;
  idPrefix?: string;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = React.useState(false);

  const codesQuery = useQuery({
    queryKey: ['invite-codes', workspaceId],
    queryFn: async () => {
      const response = (await restClient.get('/api/v1/invite_codes/', {
        params: { workspaceId },
      })) as { items?: InviteCodeRow[] };
      return response.items ?? [];
    },
    enabled: enabled && Boolean(workspaceId),
  });

  const createCode = useMutation({
    mutationFn: async (forRole: UserRole) =>
      (await restClient.post('/api/v1/invite_codes/', {
        workspaceId,
        role: forRole,
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

  // The newest live code for the selected role. Generating is explicit, so an
  // existing code is reused rather than a fresh row minted on every open.
  const activeCode = React.useMemo(() => {
    const rows = (codesQuery.data ?? []).filter((c) => c.role === role);
    return rows.length
      ? rows.reduce((newest, c) => (c.createdAt > newest.createdAt ? c : newest))
      : undefined;
  }, [codesQuery.data, role]);

  const roleLabel = inviteRoleLabel(role);

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
            Anyone with this code joins as {roleLabel}. They enter it on the &ldquo;No workspace
            yet&rdquo; screen after signing in.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No invite code for the {roleLabel} role yet.
        </p>
      )}

      <Button
        type="button"
        variant={activeCode ? 'outline' : 'default'}
        className="w-full"
        disabled={createCode.isPending}
        onClick={() => {
          setCopied(false);
          createCode.mutate(role);
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
    </div>
  );
}

export function InviteMemberDialog({ workspaceId }: InviteMemberDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<'email' | 'code'>('email');
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<UserRole>('MEMBER');
  const inviteMember = useInviteMember();
  const { user } = useAuth();

  const reset = () => {
    setName('');
    setEmail('');
    setRole('MEMBER');
    setTab('email');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    try {
      await inviteMember.mutateAsync({ workspaceId, name, email, role });
    } catch {
      // error toast handled inside the mutation; keep the dialog open so the
      // admin can correct the address instead of retyping everything
      return;
    }

    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Email an invitation, or hand out a code they can redeem themselves after signing in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <InviteRoleSelect id="role" value={role} onChange={setRole} />
          <p className="text-xs text-muted-foreground">
            This role determines what the member can do in the workspace.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as 'email' | 'code')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email">Email invitation</TabsTrigger>
            <TabsTrigger value="code">Invite code</TabsTrigger>
          </TabsList>

          <TabsContent value="email">
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-name">Full Name</Label>
                  <Input
                    id="invite-name"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="colleague@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={inviteMember.isPending}>
                  {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="code">
            <div className="py-4">
              <InviteCodePanel
                workspaceId={workspaceId}
                role={role}
                enabled={open && tab === 'code'}
                idPrefix="dialog-invite-code"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
