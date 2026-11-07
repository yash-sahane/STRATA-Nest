import type { DeletedEntity } from './deletion-side-effects.service';

/** Loose delegate shape shared by the Prisma client and a `$transaction` client. */
export interface CrudDelegate {
  findMany(a: unknown): Promise<Array<{ id: string }>>;
  deleteMany(a: unknown): Promise<{ count: number }>;
  updateMany(a: unknown): Promise<{ count: number }>;
}
export type TxLike = Record<string, CrudDelegate>;

/**
 * Select ids (for realtime), `deleteMany`, and record the removed rows for
 * Zone-2 emission. `deleteMany` bypasses the write-hook, so callers MUST emit
 * these frames explicitly. Returns removed ids.
 */
export async function collectDelete(
  tx: TxLike,
  model: string,
  collection: string,
  where: Record<string, unknown>,
  deleted: DeletedEntity[],
  workspaceId?: string,
): Promise<string[]> {
  const rows = await tx[model].findMany({ where, select: { id: true } });
  if (!rows.length) return [];
  await tx[model].deleteMany({ where });
  for (const r of rows) deleted.push({ collection, id: String(r.id), workspaceId });
  return rows.map((r) => String(r.id));
}

/**
 * Same as `collectDelete` for the DETACH half of a cascade: select ids, run the
 * `updateMany`, and record the touched rows for a Zone-2 `<collection>.update`
 * emission.
 *
 * `updateMany` bypasses the Prisma write-hook exactly like `deleteMany` does, so
 * without this the rows change silently: the deleting client refetches, but
 * every OTHER open client keeps rendering the old link (a task still sitting in
 * a sprint that no longer exists, or attached to a deleted requirement) until
 * something unrelated makes it refetch.
 *
 * Used for every detach the screens show: tasks, functional requirements and
 * epics all have pages that subscribe to them (hooks/use-realtime.ts).
 */
export async function collectUpdate(
  tx: TxLike,
  model: string,
  collection: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
  touched: DeletedEntity[],
  workspaceId?: string,
): Promise<string[]> {
  const rows = await tx[model].findMany({ where, select: { id: true } });
  if (!rows.length) return [];
  await tx[model].updateMany({ where, data });
  for (const r of rows) touched.push({ collection, id: String(r.id), workspaceId });
  return rows.map((r) => String(r.id));
}

const idList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Take tasks that are about to go off every link a SURVIVING task holds to
 * them: its "blocked by" and "blocks" lists, and a sub-task's parent.
 *
 * Deleting one task does this (TaskDeletionService). Deleting a project took
 * every task in it with a bare `deleteMany`, so a task in another project of
 * the workspace that depended on one of them kept the id: a "blocked by" the
 * task dialog could not show, that the card still counted, and that nobody
 * could remove — taking an edge off looks the far end up first, and answered
 * 404. `survivors` narrows the tasks to look at (those outside what is being
 * deleted). One `updateMany` per task for the reason collectUpdate gives:
 * nothing in a cascade may reach the realtime hook before the commit.
 */
export async function detachTaskLinks(
  tx: TxLike,
  workspaceId: string,
  removedIds: readonly string[],
  survivors: Record<string, unknown>,
  touched: DeletedEntity[],
): Promise<void> {
  if (!removedIds.length) return;
  const removed = new Set(removedIds);
  const linked = (await tx.task.findMany({
    where: {
      workspaceId,
      ...survivors,
      OR: [{ NOT: { blockedBy: { equals: [] } } }, { NOT: { blocks: { equals: [] } } }],
    },
    select: { id: true, blockedBy: true, blocks: true },
  })) as Array<{ id: string; blockedBy?: unknown; blocks?: unknown }>;
  for (const row of linked) {
    const blockedBy = idList(row.blockedBy);
    const blocks = idList(row.blocks);
    if (!blockedBy.some((id) => removed.has(id)) && !blocks.some((id) => removed.has(id))) continue;
    await tx.task.updateMany({
      where: { id: row.id },
      data: {
        blockedBy: blockedBy.filter((id) => !removed.has(id)),
        blocks: blocks.filter((id) => !removed.has(id)),
        version: { increment: 1 },
      },
    });
    touched.push({ collection: 'tasks', id: row.id, workspaceId });
  }
  // A sub-task whose parent goes becomes a task of its own, as when one task is deleted.
  await collectUpdate(
    tx,
    'task',
    'tasks',
    { workspaceId, ...survivors, parentTaskId: { in: [...removed] } },
    { parentTaskId: '' },
    touched,
    workspaceId,
  );
}
