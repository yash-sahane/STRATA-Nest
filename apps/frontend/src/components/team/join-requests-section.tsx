'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useJoinRequests, useApproveJoinRequest, useRejectJoinRequest } from '@/hooks/use-join-request';
import { getInitials } from '@/lib/utils';
import { Check, UserPlus, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

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

  const pending = (id: string) =>
    (approve.isPending && approve.variables === id) || (reject.isPending && reject.variables === id);

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
                        <p className="truncate text-sm font-medium">{name}</p>
                        {request.alreadyMember && (
                          <Badge variant="secondary">Already a member</Badge>
                        )}
                      </div>
                      {request.userEmail && request.userName && (
                        <p className="truncate text-xs text-muted-foreground">{request.userEmail}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Requested {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                        {request.alreadyMember && ' — they have since joined by another route'}
                      </p>
                      {request.message && (
                        <p className="mt-1 text-sm text-muted-foreground">“{request.message}”</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
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
                        onClick={() => approve.mutate(request.id)}
                      >
                        <Check className="h-4 w-4" />
                        Clear request
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => reject.mutate(request.id)}
                        >
                          <X className="h-4 w-4" />
                          Decline
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => approve.mutate(request.id)}>
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
