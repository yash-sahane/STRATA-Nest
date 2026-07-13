import { Injectable, Logger } from '@nestjs/common';
import { generateId } from '@strata/common';
import type { Prisma } from '@prisma/client';

/** A minimal Prisma delegate shape (works for both the client and a $transaction client). */
interface ReadDeleteDelegate {
  findMany(args: unknown): Promise<Array<{ id: string }>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
}
interface ArchiveWriter {
  createMany(args: unknown): Promise<{ count: number }>;
}

/**
 * ArchiveService — "no silent destruction of historical records". Before an
 * aggregate-root delete removes HR/audit rows, snapshot each into
 * `retention_archive`, THEN delete the live rows — all inside the caller's
 * Zone-1 transaction so it is atomic.
 */
@Injectable()
export class ArchiveService {
  private readonly logger = new Logger('Archive');

  /**
   * Snapshot every row matched by `where` into retention_archive, then delete
   * them. Returns the archived ids (for realtime emission). Runs on the passed
   * transaction client (`tx`), so it commits/rolls back with the root delete.
   */
  async archiveAndDelete(
    tx: {
      retentionArchive: ArchiveWriter;
      [model: string]: unknown;
    },
    params: {
      model: string; // Prisma delegate name, e.g. 'attendance'
      entityType: string; // archive label, e.g. 'attendance'
      where: Record<string, unknown>;
      workspaceId: string;
      reason: string;
    },
  ): Promise<string[]> {
    const delegate = (tx as unknown as Record<string, ReadDeleteDelegate>)[params.model];
    const rows = await delegate.findMany({ where: params.where });
    if (rows.length === 0) return [];

    const snapshots = rows.map((row) => ({
      id: generateId(),
      entityType: params.entityType,
      entityId: String(row.id),
      workspaceId: params.workspaceId,
      reason: params.reason,
      // Normalize Dates → JSON (HR/audit rows carry no BigInt, so this is safe).
      snapshot: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
    }));
    await tx.retentionArchive.createMany({ data: snapshots });
    await delegate.deleteMany({ where: params.where });
    this.logger.log(`archived+deleted ${rows.length} ${params.entityType} (${params.reason})`);
    return rows.map((r) => String(r.id));
  }
}
