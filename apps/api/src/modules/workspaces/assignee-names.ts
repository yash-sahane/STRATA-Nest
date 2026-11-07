import type { PrismaService } from '@strata/prisma';

/**
 * The names to show for an assignee list, index-aligned with it.
 *
 * A name is not derivable from an id without a lookup, and only the server can
 * do that: a client that sent ids alone (Clone Project did, and so does any API
 * caller) produced a task that read as assigned to nobody on every screen that
 * shows names — and one that sent `assignedToNames: []` blanked them. So the
 * names are never taken from a request; they are resolved here from the user
 * table on every write of the ids. An id with no account behind it gets '' so
 * the two lists stay aligned.
 */
export async function assigneeNamesFor(
  prisma: Pick<PrismaService, 'user'>,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.name || u.email]));
  return ids.map((id) => byId.get(id) ?? '');
}
