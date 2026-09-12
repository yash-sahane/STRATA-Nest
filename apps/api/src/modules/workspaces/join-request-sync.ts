import type { Prisma } from '@prisma/client';

/**
 * Close every PENDING request from `userId` to join `workspaceId`.
 *
 * A join request is a question — "may I have access?" — and the moment the
 * person HAS access it has been answered, whichever door they came through.
 * Without this, a request raised before an invitation was accepted stayed
 * PENDING and the manager's queue went on offering Approve/Decline for somebody
 * who was already an ACTIVE member. Approving such a row is at least idempotent
 * (JoinRequestApprovalService reuses the existing membership rather than
 * creating a second one), but the manager is reviewing decisions that no longer
 * mean anything.
 *
 * APPROVED, not a new terminal state: the requester did get in, every client
 * filters the queue on PENDING, and `approve`/`reject` already refuse a request
 * that is not PENDING — so resolving it here also stops the stale row 400ing an
 * approval later.
 *
 * Returns the PrismaPromise UNAWAITED, so a caller can hand it to
 * `$transaction([...])` and close the request in the same commit that creates
 * the membership; awaiting it directly is equally valid.
 *
 * Deliberately silent — no JoinRequestApproved event. The membership creation
 * that occasions it already emits MemberAdded, which notifies and audits; a
 * second "your request was approved" for the same act is noise, and nobody
 * *decided* anything here.
 *
 * The parameter is typed as the transaction client because a full PrismaClient
 * is assignable to it, so one signature serves both call shapes.
 */
export function closePendingJoinRequests(
  db: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  handledById?: string,
): Prisma.PrismaPromise<Prisma.BatchPayload> {
  return db.joinRequest.updateMany({
    where: { workspaceId, userId, status: 'PENDING' },
    // handledById only when somebody actually acted on the requester's behalf
    // (a manager adding them). When they let themselves in with an invitation
    // there is no handler, and naming the requester as their own approver would
    // be a lie in the audit trail.
    data: { status: 'APPROVED', ...(handledById ? { handledById } : {}) },
  });
}
