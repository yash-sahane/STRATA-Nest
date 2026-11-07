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
