import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// NOTE: `@prisma/client` types/values exist only after `pnpm prisma:generate`.
// In a fresh checkout run `pnpm prisma:pull && pnpm prisma:generate` first.
import { PrismaClient } from '@prisma/client';

export type WriteAction = 'create' | 'update' | 'delete';
/** Invoked after every single-row write (used by RealtimeModule to broadcast). */
export type WriteHook = (model: string, action: WriteAction, result: unknown) => void;

/**
 * Thin Nest wrapper over PrismaClient — the single DB access point.
 * Connection lifecycle is tied to the Nest module lifecycle so the health
 * check and graceful shutdown work in both api and worker processes.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private writeHook?: WriteHook;

  /** Register a post-write hook (RealtimeModule wires this to broadcast realtime
   *  events via an explicit, decoupled callback). */
  setWriteHook(hook: WriteHook): void {
    this.writeHook = hook;
  }

  /**
   * Tell the write hook about a write it could not see for itself.
   *
   * The middleware below reports `create`, `update` and `delete`. A
   * compare-and-swap has to be written as `updateMany` (the condition is on a
   * non-unique column), and that is invisible to it — which is every save made
   * through an edit dialog since rows got a `version`, and every leave or time
   * decision. Those changed the row and told nobody: a colleague's open board
   * kept the old card until they navigated away. The caller re-reads the row
   * and hands it over here.
   */
  announceWrite(model: string, action: WriteAction, row: unknown): void {
    if (!this.writeHook) return;
    try {
      this.writeHook(model, action, row);
    } catch (err) {
      this.logger.warn(`writeHook failed: ${(err as Error).message}`);
    }
  }

  async onModuleInit(): Promise<void> {
    this.$use(async (params, next) => {
      const result = await next(params);
      const action = params.action;
      if (
        this.writeHook &&
        params.model &&
        (action === 'create' || action === 'update' || action === 'delete')
      ) {
        try {
          this.writeHook(params.model, action, result);
        } catch (err) {
          this.logger.warn(`writeHook failed: ${(err as Error).message}`);
        }
      }
      return result;
    });
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight liveness probe used by the health endpoint. */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
