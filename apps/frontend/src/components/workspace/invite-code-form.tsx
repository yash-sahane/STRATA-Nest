'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJoinWorkspace } from '@/hooks/use-workspace';
import { Loader2 } from 'lucide-react';

/**
 * Redeem an invite code (or an invitation token — `useJoinWorkspace` routes by
 * shape, so the label does not promise only one).
 *
 * One form for both places a code can be entered: the "No workspace yet" screen,
 * and Workspaces > Join a workspace for somebody who already belongs to one.
 * The second did not exist, so a member of one workspace holding a perfectly
 * good code for another had nowhere to type it.
 */
export function InviteCodeForm({
  idPrefix = 'invite-code',
  onJoined,
}: {
  idPrefix?: string;
  onJoined: (result: { workspaceId: string; role?: string }) => void;
}) {
  const joinWorkspace = useJoinWorkspace();
  const [inviteCode, setInviteCode] = React.useState('');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim();
    if (!code) return;
    try {
      const result = await joinWorkspace.mutateAsync({ inviteCode: code });
      setInviteCode('');
      onJoined(result);
    } catch {
      // the mutation surfaces the reason as a toast
    }
  };

  return (
    <form onSubmit={handleJoin} className="space-y-2">
      <Label htmlFor={`${idPrefix}-input`}>Invite code</Label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-input`}
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="e.g. VCWVFFSF-Y"
          autoComplete="off"
          spellCheck={false}
          disabled={joinWorkspace.isPending}
        />
        <Button type="submit" disabled={!inviteCode.trim() || joinWorkspace.isPending}>
          {joinWorkspace.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Joining
            </>
          ) : (
            'Join'
          )}
        </Button>
      </div>
    </form>
  );
}
