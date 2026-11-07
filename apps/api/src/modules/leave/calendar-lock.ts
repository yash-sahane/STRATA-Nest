import type { Prisma } from '@prisma/client';

/**
 * The workspace calendar — its holidays and its working week — held still
 * while something that counts working days reads it.
 *
 * Changing the calendar re-counts the leave and attendance it covers (see
 * holiday-reconcile.ts), and that re-count reads the requests as they stand.
 * A request being written at the same moment was counted against the calendar
 * as it stood a moment before, and was not yet there for the re-count to find:
 * leave asked for across a holiday declared in the same second was charged for
 * the holiday, and nothing later noticed.
 *
 * So a calendar change takes this lock EXCLUSIVELY for its whole transaction,
 * and every leave write that counts days or charges a balance takes it SHARED
 * first: leave writes do not wait on each other, a calendar change waits for
 * those in flight and then re-counts them, and those that arrive meanwhile
 * count against the new calendar.
 *
 * Always the first lock a transaction takes. A leave write takes the member's
 * own lock (`leave:<workspace>:<user>`) after this one, and a calendar change
 * takes no other advisory lock at all, so the order can never cross.
 *
 * Every read and write after it goes through the same `tx` — see
 * `lockAdministration` for why the plain client must not be used inside.
 */
const key = (workspaceId: string) => `calendar:${workspaceId}`;

/** For a write that changes the calendar: holidays, or the working week. */
export async function lockCalendar(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  workspaceId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key(workspaceId)})::bigint)`;
}

/** For a leave write that counts working days or charges a balance by them. */
export async function shareCalendar(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  workspaceId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key(workspaceId)})::bigint)`;
}
