import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// NOTE: `@prisma/client` types/values exist only after `pnpm prisma:generate`.
// In a fresh checkout run `pnpm prisma:pull && pnpm prisma:generate` first.
import { PrismaClient } from '@prisma/client';
import { WriteAnnouncer, type WriteAction, type WriteHook } from './write-announcer';

type AnyTransaction = (...args: unknown[]) => Promise<unknown>;

/**
 * Thin Nest wrapper over PrismaClient — the single DB access point.
 * Connection lifecycle is tied to the Nest module lifecycle so the health
 * check and graceful shutdown work in both api and worker processes.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  /** Holds what a transaction writes until it commits — see WriteAnnouncer. */
  private readonly announcer = new WriteAnnouncer((message) => this.logger.warn(message));

  static {
    // `$transaction` is a method of the generated client's prototype. Wrapping it
    // here, rather than redeclaring it, keeps its overloads — the callback's `tx`
    // stays typed at every call site — while every transaction, interactive or
    // array, runs inside the announcer's scope. The client's own method is looked
    // up at call time, so nothing is captured before Prisma is ready.
    PrismaService.prototype.$transaction = function (this: PrismaService, ...args: unknown[]) {
      const begin = PrismaClient.prototype.$transaction as unknown as AnyTransaction;
      return this.announcer.around(() => begin.apply(this, args));
    } as unknown as PrismaClient['$transaction'];
  }

  /** Register a post-write hook (RealtimeModule wires this to broadcast realtime
   *  events via an explicit, decoupled callback). */
  setWriteHook(hook: WriteHook): void {
    this.announcer.setHook(hook);
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
   *
   * Called inside a transaction's callback, the announcement waits for that
   * transaction to settle, like the writes the middleware sees.
   */
  announceWrite(model: string, action: WriteAction, row: unknown): void {
    this.announcer.announced(model, action, row);
  }

  async onModuleInit(): Promise<void> {
    this.$use(async (params, next) => {
      const result = await next(params);
      const action = params.action;
      if (params.model && (action === 'create' || action === 'update' || action === 'delete')) {
        // On a transaction, this is before its commit: the announcer holds it.
        this.announcer.written(params.model, action, result, params.runInTransaction === true);
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
