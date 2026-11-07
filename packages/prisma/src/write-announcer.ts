import { AsyncLocalStorage } from 'node:async_hooks';

export type WriteAction = 'create' | 'update' | 'delete';
/** Invoked after every single-row write (used by RealtimeModule to broadcast). */
export type WriteHook = (model: string, action: WriteAction, result: unknown) => void;

interface HeldWrite {
  model: string;
  action: WriteAction;
  row: unknown;
  /** Written ON the transaction, so it is undone if the transaction is. */
  onTransaction: boolean;
}

interface OpenTransaction {
  writes: HeldWrite[];
  /** Set once the transaction has settled and its writes went out. */
  settled: boolean;
}

/**
 * Hands each write to the hook once it is visible to everybody else — that is,
 * after the transaction it belongs to has committed.
 *
 * The hook used to fire from the middleware the moment a query returned, and
 * inside `$transaction` that is BEFORE the commit. A frame only tells a client
 * "refetch", so a client quick enough to refetch read the row as it was before
 * the change, kept it, and was told nothing more: the change never reached its
 * screen. And a transaction that then rolled back had announced writes that
 * never happened. ADR-0007 puts side effects after the commit; the realtime
 * broadcast is one.
 *
 * Writes made on a transaction are held until it settles: sent if it commits,
 * dropped if it rolls back. Two kinds of write are not dropped:
 *  - a query that runs OUTSIDE the transaction while it is open (on the plain
 *    client, not `tx`) commits by itself, so it is sent at once;
 *  - an `announceWrite` made during the transaction may describe exactly such a
 *    write (it reports `updateMany` claims, which the middleware cannot see),
 *    so it is held to the end and sent either way. A spurious frame costs a
 *    refetch; a missing one leaves every open screen stale.
 */
export class WriteAnnouncer {
  private hook?: WriteHook;
  private readonly open = new AsyncLocalStorage<OpenTransaction>();

  constructor(private readonly warn: (message: string) => void) {}

  setHook(hook: WriteHook): void {
    this.hook = hook;
  }

  /** A write the query middleware saw; `onTransaction` is its `runInTransaction`. */
  written(model: string, action: WriteAction, row: unknown, onTransaction: boolean): void {
    if (!this.hook) return;
    const open = onTransaction ? this.current() : undefined;
    if (open) open.writes.push({ model, action, row, onTransaction: true });
    else this.send(model, action, row);
  }

  /** A write the caller reports itself (see `PrismaService.announceWrite`). */
  announced(model: string, action: WriteAction, row: unknown): void {
    if (!this.hook) return;
    const open = this.current();
    if (open) open.writes.push({ model, action, row, onTransaction: false });
    else this.send(model, action, row);
  }

  /**
   * Run one transaction and release what it wrote once it has settled. Each
   * transaction holds its own writes, so one started inside another's callback
   * sends its writes at its own commit.
   */
  async around<T>(run: () => Promise<T>): Promise<T> {
    const open: OpenTransaction = { writes: [], settled: false };
    let result: T;
    try {
      result = await this.open.run(open, run);
    } catch (err) {
      this.release(open, (write) => !write.onTransaction);
      throw err;
    }
    this.release(open, () => true);
    return result;
  }

  /**
   * The transaction this call belongs to, if it is still open. A continuation
   * the callback set off without awaiting (an event handler, a `void` promise)
   * keeps the transaction's context after the transaction has settled; holding
   * its write then would put it in a list that has already been sent, and lose
   * it.
   */
  private current(): OpenTransaction | undefined {
    const open = this.open.getStore();
    return open && !open.settled ? open : undefined;
  }

  private release(open: OpenTransaction, keep: (write: HeldWrite) => boolean): void {
    open.settled = true;
    for (const write of open.writes) {
      if (keep(write)) this.send(write.model, write.action, write.row);
    }
    open.writes = [];
  }

  private send(model: string, action: WriteAction, row: unknown): void {
    if (!this.hook) return;
    try {
      this.hook(model, action, row);
    } catch (err) {
      this.warn(`writeHook failed: ${(err as Error).message}`);
    }
  }
}
