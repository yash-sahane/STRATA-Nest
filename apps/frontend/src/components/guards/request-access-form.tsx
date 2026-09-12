'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspaceDirectory, useCreateJoinRequest } from '@/hooks/use-join-request';
import { Loader2 } from 'lucide-react';

/**
 * The second way into a workspace, for someone who has no invite code.
 *
 * The picker is fed by GET /workspaces/directory, which exists because
 * POST /join_requests needs a workspaceId and the ordinary workspace list only
 * returns workspaces you are already in — so there was previously no id a
 * non-member could name.
 */
export function RequestAccessForm() {
  const { data: workspaces = [], isLoading } = useWorkspaceDirectory();
  const createRequest = useCreateJoinRequest();
  const [workspaceId, setWorkspaceId] = React.useState('');
  const [message, setMessage] = React.useState('');

  const selected = workspaces.find((w) => w.id === workspaceId);
  const alreadyAsked = workspaces.filter((w) => w.requested);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    try {
      await createRequest.mutateAsync({ workspaceId, message: message.trim() });
      setWorkspaceId('');
      setMessage('');
    } catch {
      // the mutation surfaces the reason as a toast
    }
  };

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Looking for workspaces you can join…</p>
    );
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no workspaces to request access to yet. Ask an administrator for an invite code.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="request-workspace">Workspace</Label>
        <Select value={workspaceId} onValueChange={setWorkspaceId}>
          <SelectTrigger id="request-workspace">
            <SelectValue placeholder="Choose a workspace" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              // Disabled rather than hidden: seeing "Requested" is the answer to
              // "did my request go through?", which an absent row is not.
              <SelectItem key={w.id} value={w.id} disabled={w.requested}>
                {w.name}
                {w.requested ? ' — requested' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="request-message">Message (optional)</Label>
        <Textarea
          id="request-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell the manager who you are and why you need access"
          className="min-h-20"
          maxLength={500}
        />
      </div>

      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={!workspaceId || selected?.requested || createRequest.isPending}
      >
        {createRequest.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending
          </>
        ) : (
          'Request access'
        )}
      </Button>

      {alreadyAsked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Awaiting a decision on {alreadyAsked.map((w) => w.name).join(', ')}.
        </p>
      )}
    </form>
  );
}
