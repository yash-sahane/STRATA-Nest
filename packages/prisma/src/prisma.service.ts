import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// NOTE: `@prisma/client` types/values exist only after `pnpm prisma:generate`.
// In a fresh checkout run `pnpm prisma:pull && pnpm prisma:generate` first.
import { PrismaClient } from '@prisma/client';

export type WriteAction = 'create' | 'update' | 'delete';
/** Invoked after every single-row write (used by RealtimeModule to broadcast). */
export type WriteHook = (model: string, action: WriteAction, result: unknown) => void;

/**
 * Thin Nest wrapper over PrismaClient — the single DB access point (arch §4).
 * Connection lifecycle is tied to the Nest module lifecycle so the health
 * check and graceful shutdown work in both api and worker processes.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private writeHook?: WriteHook;

  /** Register a post-write hook (RealtimeModule wires this — replaces the Django
   *  post_save/post_delete signal with an explicit, decoupled callback). */
  setWriteHook(hook: WriteHook): void {
    this.writeHook = hook;
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
