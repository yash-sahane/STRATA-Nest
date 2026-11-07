'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useJoinRequests,
  useApproveJoinRequest,
  useRejectJoinRequest,
  type JoinRequestRow,
} from '@/hooks/use-join-request';
import { InviteRoleSelect } from '@/components/workspace/invite-code-panel';
import { roleDisplayName, useRoleOptions } from '@/hooks/use-role-options';
import { getInitials } from '@/lib/utils';
import { Check, UserPlus, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useConfirm } from '@/components/providers/confirm-provider';

/**
 * Pending requests to join this workspace, with the approve/reject controls.
 *
 * Approving is transactional on the server (JoinRequestApprovalService creates
 * the membership in the same transaction), so this only has to fire the call
 * and let the mutation invalidate the member lists.
 *
 * A row can also have been OVERTAKEN: the requester was let in by another door
 * (an invitation, an invite code, a direct add) while their request sat here.
 * The API reports that as `alreadyMember`, and those rows are labelled rather
 * than hidden — they still need clearing, and a queue that silently drops rows
 * is worse than one that explains them.
 */
export function JoinRequestsSection({ workspaceId }: { workspaceId?: string }) {
  const { data: requests = [], isLoading, isError, refetch } = useJoinRequests(workspaceId);
  const approve = useApproveJoinRequest();
  const reject = useRejectJoinRequest();
  const confirm = useConfirm();

  // Declining tells the requester no. It sat one click away, right beside
  // Approve, with nothing between a slip of the mouse and that message.
  const handleDecline = async (request: { id: string; userName?: string }) => {
    const proceed = await confirm({
      title: 'Decline this request?',
      // What actually happens: the request closes, they are told it was
      // declined (in the app, and by mail where mail works), and they can ask
      // again. This said "they are not notified", which was never true.
      description: `The request from ${request.userName || 'this person'} is closed. They are told it was declined, and they can ask again later.`,
      confirmText: 'Decline',
      destructive: true,
    });
    if (proceed) reject.mutate({ requestId: request.id });
  };
  // The role each requester will join at. Approval used to land everyone as the
  // read-only Member, so letting a developer in took a second edit on another
  // tab; it is chosen here, per request, and starts at the safest option —
  // except for somebody whose access was switched off, who starts at the role
  // they HELD. Member there quietly demoted a returning manager on approval.
  const [roles, setRoles] = React.useState<Record<string, string>>({});
  const { grantable, isLoading: rolesLoading } = useRoleOptions(workspaceId);
  const mayRestore = (request: JoinRequestRow): boolean =>
    !!request.previousRole && grantable.some((option) => option.value === request.previousRole);
  const roleFor = (request: JoinRequestRow): string =>
    roles[request.id] ??
    (mayRestore(request) ? (request.previousRole as string) : 'MEMBER');

  const pending = (id: string) =>
    (approve.isPending && approve.variables?.requestId === id) ||
    (reject.isPending && reject.variables?.requestId === id);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Join Requests</CardTitle>
            <CardDescription>People asking for access to this workspace</CardDescription>
          </div>
          {requests.length > 0 && (
            <Badge variant="secondary">{requests.length} pending</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn't load join requests"
            description="The pending requests for this workspace could not be fetched."
            onRetry={() => refetch()}
          />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No pending requests"
            description="When someone asks to join this workspace, their request appears here."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => {
              // Identity comes off the wire. It used to be looked up in the
              // member list, which by definition cannot contain the requester —
              // so every card read "Unknown user" and managers approved blind.
              const name = request.userName || request.userEmail || 'Unknown user';
              const busy = pending(request.id);
              return (
                <div
                  key={request.id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={request.userAvatar} alt={name} />
                      <AvatarFallback className="text-xs">{getInitials(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium" title={name}>{name}</p>
                        {request.alreadyMember && (
                          <Badge variant="secondary">Already a member</Badge>
                        )}
                        {!request.alreadyMember && request.previousRole && (
                          <Badge variant="outline">Former member</Badge>
                        )}
                      </div>
                      {request.userEmail && request.userName && (
                        <p className="truncate text-xs text-muted-foreground" title={request.userEmail}>{request.userEmail}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Requested {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                        {request.alreadyMember && ' — they have since joined by another route'}
                      </p>
                      {/* Not a stranger: a manager switched their access off.
                          Approving switches it back on. */}
                      {!request.alreadyMember && request.previousRole && (
                        <p className="text-xs text-muted-foreground">
                          Was {roleDisplayName(request.previousRole)} here until their access was
                          switched off.
                          {!rolesLoading &&
                            !mayRestore(request) &&
                            ' Only somebody whose role can do as much as that can let them back in.'}
                        </p>
                      )}
                      {request.message && (
                        <p className="mt-1 text-sm text-muted-foreground">“{request.message}”</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {request.alreadyMember ? (
                      /* Neither decision means anything once they are in:
                         approving grants nothing (the server reuses the
                         existing membership) and declining would mark the
                         request REJECTED while they keep their access. The one
                         honest action left is clearing the row, which the
                         approve endpoint does idempotently. */
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => approve.mutate({ requestId: request.id })}
                      >
                        <Check className="h-4 w-4" />
                        Clear request
                      </Button>
                    ) : (
                      <>
                        {workspaceId && (
                          <div className="w-44">
                            <label htmlFor={`join-role-${request.id}`} className="sr-only">
                              Role for {name}
                            </label>
                            <InviteRoleSelect
                              id={`join-role-${request.id}`}
                              workspaceId={workspaceId}
                              value={roleFor(request)}
                              onChange={(role) =>
                                setRoles((prev) => ({ ...prev, [request.id]: role }))
                              }
                              disabled={busy}
                            />
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleDecline(request)}
                        >
                          <X className="h-4 w-4" />
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            approve.mutate({ requestId: request.id, role: roleFor(request) })
                          }
                        >
                          <Check className="h-4 w-4" />
                          Approve
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
