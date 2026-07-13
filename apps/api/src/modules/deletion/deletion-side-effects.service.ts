import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { GitQueueService } from '../integrations/git-queue.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface DeletedEntity {
  collection: string; // realtime slug, e.g. 'tasks'
  id: string;
  workspaceId?: string;
}
export interface FileRef {
  id: string;
  filePath: string;
}

/**
 * Zone 2 of an aggregate delete (DELETE_TRANSACTION_REPORT). Runs AFTER the DB
 * transaction commits. Every method is idempotent + failure-isolated: a side
 * effect that throws is logged and does not abort the others (the rows are
 * already gone; re-running is safe). Because `deleteMany` bypasses the Prisma
 * write-hook, realtime frames MUST be emitted here explicitly.
 */
@Injectable()
export class DeletionSideEffectsService {
  private readonly logger = new Logger('DeletionSideEffects');

  constructor(
    private readonly storage: StorageService,
    private readonly git: GitQueueService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Emit a `<collection>.delete` frame per removed row (bulk deletes bypass the Prisma write hook, so this is the only signal). */
  emitDeletes(entities: DeletedEntity[]): void {
    for (const e of entities) {
      try {
        this.realtime.emitEvent(e.collection, `${e.collection}.delete`, e.id, e.workspaceId ?? '', {
          id: e.id,
        });
      } catch (err) {
        this.logger.warn(`realtime emit failed for ${e.collection}.${e.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Delete object-storage blobs for removed files (no FK cascade can do this). */
  async deleteBlobs(files: FileRef[]): Promise<void> {
    for (const f of files) {
      try {
        await this.storage.remove(f.filePath);
      } catch (err) {
        this.logger.warn(`blob delete failed for ${f.id} (${f.filePath}): ${(err as Error).message}`);
      }
    }
  }

  /** Best-effort purge of pending git-queue jobs referencing deleted projects. */
  async purgeGitJobs(projectIds: string[]): Promise<void> {
    if (projectIds.length === 0) return;
    try {
      await this.git.purgeByProjectIds(projectIds);
    } catch (err) {
      this.logger.warn(`git-queue purge failed: ${(err as Error).message}`);
    }
  }

  /**
   * Best-effort provider-webhook revocation. NOTE: the integration row does not
   * persist the provider's webhook id, so true remote revocation cannot be
   * performed from stored data alone — logged as a known limitation. The
   * encrypted credential + row are removed by the caller regardless.
   */
  revokeWebhooks(integrations: Array<{ provider: string; projectId: string }>): void {
    for (const i of integrations) {
      this.logger.log(
        `[webhook-revoke] ${i.provider} integration for project ${i.projectId} deleted — ` +
          `remote webhook revocation requires the provider hook id (not stored); left to provider cleanup.`,
      );
    }
  }
}
