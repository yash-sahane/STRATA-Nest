'use client';

import { formatDistanceToNow } from 'date-fns';
import { Loader2, MailOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { roleDisplayName } from '@/hooks/use-role-options';
import {
  useAnswerInvitation,
  useMyInvitations,
  type InvitationAnswer,
  type WorkspaceInvitation,
} from '@/hooks/use-invitations';

/**
 * The invitations waiting on the signed-in person, each with Accept and Decline.
 *
 * Being added to a workspace used to happen TO somebody: one day a stranger's
 * workspace was in their switcher, with a role in it they had never agreed to.
 * Now an add is an invitation that grants nothing until it is accepted here.
 * Renders nothing when there are none, so it can sit at the top of any screen.
 */
export function PendingInvitations({
  poll = false,
  onAccepted,
}: {
  /** Ask again every half minute — for a screen somebody waits on. */
  poll?: boolean;
  /** After an accept has gone through: where the screen goes next. */
  onAccepted?: (invitation: WorkspaceInvitation) => void;
}) {
  const { data: invitations } = useMyInvitations({ poll });
  const answer = useAnswerInvitation();
  if (!invitations?.length) return null;

  const respond = (invitation: WorkspaceInvitation, reply: InvitationAnswer) =>
    answer.mutate(
      { invitation, answer: reply },
      { onSuccess: () => (reply === 'accept' ? onAccepted?.(invitation) : undefined) },
    );
  const busyWith = (invitation: WorkspaceInvitation, reply: InvitationAnswer) =>
    answer.isPending &&
    answer.variables?.invitation.id === invitation.id &&
    answer.variables?.answer === reply;

  return (
    <section aria-labelledby="pending-invitations-heading" className="space-y-3">
      <h2 id="pending-invitations-heading" className="flex items-center gap-2 text-sm font-semibold">
        <MailOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {invitations.length === 1 ? 'An invitation is waiting for you' : `${invitations.length} invitations are waiting for you`}
      </h2>
      <ul className="space-y-2">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">{invitation.workspaceName}</p>
              <p className="text-sm text-muted-foreground">
                {invitation.invitedByName ? `${invitation.invitedByName} invited you` : 'You were invited'} as{' '}
                {roleDisplayName(invitation.role)}
                {' · '}
                {formatDistanceToNow(new Date(invitation.invitedAt), { addSuffix: true })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                You are not a member until you accept.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={answer.isPending}
                onClick={() => respond(invitation, 'decline')}
                aria-label={`Decline the invitation to ${invitation.workspaceName}`}
              >
                {busyWith(invitation, 'decline') && <Loader2 className="h-4 w-4 animate-spin" />}
                Decline
              </Button>
              <Button
                size="sm"
                disabled={answer.isPending}
                onClick={() => respond(invitation, 'accept')}
                aria-label={`Accept the invitation to ${invitation.workspaceName}`}
              >
                {busyWith(invitation, 'accept') && <Loader2 className="h-4 w-4 animate-spin" />}
                Accept
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
