import type { DeletedEntity } from './deletion-side-effects.service';

/** Loose delegate shape shared by the Prisma client and a `$transaction` client. */
export interface CrudDelegate {
  findMany(a: unknown): Promise<Array<{ id: string }>>;
  deleteMany(a: unknown): Promise<{ count: number }>;
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
