import { generateId } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';

const logger = new Logger('AuditWriter');

/** The CRUD verbs the trail records, appended to the entity name. */
export type AuditAction = 'created' | 'updated' | 'deleted';

/** Never copied into the trail — an audit row is readable by any member holding
 *  activity:read, and these fields carry credentials. */
const REDACTED_FIELDS = new Set(['accessToken', 'webhookSecret', 'password', 'token']);

export interface AuditRowInput {
  workspaceId?: string;
  userId: string;
  /** Entity name, e.g. `task`; the action becomes `task.created`. */
  entity: string;
  action: AuditAction;
  entityId: string;
  /** The row itself, read only for a human-readable `title`/`name` label. */
  row?: Record<string, unknown>;
  /** Field names touched by an update. Values are never stored. */
  changedFields?: string[];
  /** Extra context merged into `metadata`, e.g. the size of a delete cascade. */
  extraMetadata?: Record<string, unknown>;
}

/**
 * Append one row to the append-only audit trail.
 *
 * Best-effort by design: the trail records what happened, so failing to write it
 * must never fail the write it describes — the same contract AuditSubscriber
 * follows for domain events.
 *
 * Only the NAMES of changed fields are kept, never their values: an integration
 * patch carries an access token and the trail is not the place for it.
 */
export async function writeAuditRow(
  prisma: PrismaService,
  input: AuditRowInput,
): Promise<void> {
  if (!input.entity || !input.workspaceId || !input.entityId) return;
  try {
    const label = input.row?.title ?? input.row?.name;
    const fields = input.changedFields?.filter((f) => !REDACTED_FIELDS.has(f));
    const metadata: Record<string, unknown> = { ...(input.extraMetadata ?? {}) };
    if (typeof label === 'string' && label) metadata.label = label;
    await prisma.activityLog.create({
      data: {
        id: generateId(),
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: `${input.entity}.${input.action}`,
        entityType: input.entity,
        entityId: input.entityId,
        changes: (fields?.length ? { fields } : {}) as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // Never surface a trail failure to the caller — but say it happened: a
    // trail with silent holes is one nobody can rely on.
    logger.warn(`audit write failed (${input.entity}.${input.action} ${input.entityId}): ${(error as Error).message}`);
  }
}
