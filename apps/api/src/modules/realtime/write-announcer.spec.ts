import { PrismaService, WriteAnnouncer, type WriteAction } from '@strata/prisma';

/**
 * The realtime broadcast must not run ahead of the commit: a client that
 * refetched on a frame sent mid-transaction read the old row and kept it, and a
 * transaction that rolled back had announced writes that never happened. These
 * pin when each kind of write is handed to the hook.
 */
type Sent = { model: string; action: WriteAction; id: string };

function announcer() {
  const sent: Sent[] = [];
  const warnings: string[] = [];
  const a = new WriteAnnouncer((message) => warnings.push(message));
  a.setHook((model, action, row) => sent.push({ model, action, id: (row as { id: string }).id }));
  return { a, sent, ids: () => sent.map((s) => s.id), warnings };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('WriteAnnouncer — writes go out once they are committed', () => {
  it('sends a write made outside any transaction at once', () => {
    const { a, ids } = announcer();
    a.written('Task', 'update', { id: 't1' }, false);
    a.announced('Task', 'update', { id: 't2' });
    expect(ids()).toEqual(['t1', 't2']);
  });

  it('holds a write made on a transaction until the transaction commits', async () => {
    const { a, ids } = announcer();
    let duringTransaction: string[] = [];
    await a.around(async () => {
      a.written('Task', 'update', { id: 't1' }, true);
      await settle();
      duringTransaction = ids();
    });
    expect(duringTransaction).toEqual([]);
    expect(ids()).toEqual(['t1']);
  });

  it('holds an announcement made during the transaction until it settles, too', async () => {
    const { a, ids } = announcer();
    let duringTransaction: string[] = [];
    await a.around(async () => {
      a.announced('Task', 'update', { id: 't1' });
      duringTransaction = ids();
    });
    expect(duringTransaction).toEqual([]);
    expect(ids()).toEqual(['t1']);
  });

  it('sends at once a write that ran on the plain client while the transaction was open', async () => {
    const { a, ids } = announcer();
    let duringTransaction: string[] = [];
    await a.around(async () => {
      // `runInTransaction` false: it committed by itself, whatever the
      // surrounding transaction then does.
      a.written('Notification', 'create', { id: 'n1' }, false);
      duringTransaction = ids();
    });
    expect(duringTransaction).toEqual(['n1']);
  });

  it('drops what the transaction wrote when it rolls back, and still sends what was announced', async () => {
    const { a, ids } = announcer();
    await expect(
      a.around(async () => {
        a.written('Task', 'update', { id: 'rolled-back' }, true);
        // An announcement may describe a write made OUTSIDE the transaction (an
        // `updateMany` claim). A spurious frame costs a refetch; a missing one
        // leaves screens stale.
        a.announced('Task', 'update', { id: 'announced' });
        throw new Error('constraint violated');
      }),
    ).rejects.toThrow('constraint violated');
    expect(ids()).toEqual(['announced']);
  });

  it('releases each transaction at its own commit, inner before outer', async () => {
    const { a, ids } = announcer();
    let afterInner: string[] = [];
    await a.around(async () => {
      a.written('Sprint', 'update', { id: 'outer-1' }, true);
      await a.around(async () => {
        a.written('Task', 'update', { id: 'inner' }, true);
      });
      afterInner = ids();
      a.written('Epic', 'update', { id: 'outer-2' }, true);
    });
    expect(afterInner).toEqual(['inner']);
    expect(ids()).toEqual(['inner', 'outer-1', 'outer-2']);
  });

  it('two transactions running side by side keep their writes apart', async () => {
    const { a, ids } = announcer();
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => (releaseSlow = resolve));
    const slow = a.around(async () => {
      a.written('Task', 'update', { id: 'slow' }, true);
      await slowGate;
    });
    await a.around(async () => {
      a.written('Task', 'update', { id: 'fast' }, true);
    });
    expect(ids()).toEqual(['fast']);
    releaseSlow();
    await slow;
    expect(ids()).toEqual(['fast', 'slow']);
  });

  it('sends a write from a continuation that outlives its transaction instead of losing it', async () => {
    const { a, ids } = announcer();
    let detached: Promise<void> | undefined;
    await a.around(async () => {
      // Set off and not awaited — an event handler, a `void` promise. It keeps
      // the transaction's context after the transaction has settled.
      detached = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        a.announced('Task', 'update', { id: 'late-announced' });
        a.written('Task', 'update', { id: 'late-written' }, true);
      })();
    });
    await detached;
    expect(ids()).toEqual(['late-announced', 'late-written']);
  });

  it('keeps the order the writes were made in', async () => {
    const { a, sent } = announcer();
    await a.around(async () => {
      a.written('Task', 'create', { id: 't1' }, true);
      a.announced('Task', 'update', { id: 't1' });
      a.written('Task', 'delete', { id: 't1' }, true);
    });
    expect(sent.map((s) => s.action)).toEqual(['create', 'update', 'delete']);
  });

  it('a hook that throws is logged and does not stop the writes after it', async () => {
    const warnings: string[] = [];
    const a = new WriteAnnouncer((message) => warnings.push(message));
    const sent: string[] = [];
    a.setHook((_model, _action, row) => {
      const { id } = row as { id: string };
      if (id === 'bad') throw new Error('cannot serialise');
      sent.push(id);
    });
    await a.around(async () => {
      a.written('Task', 'update', { id: 'bad' }, true);
      a.written('Task', 'update', { id: 'good' }, true);
    });
    expect(sent).toEqual(['good']);
    expect(warnings).toEqual(['writeHook failed: cannot serialise']);
  });

  it('returns what the transaction returned', async () => {
    const { a } = announcer();
    await expect(a.around(async () => 42)).resolves.toBe(42);
  });
});

describe('PrismaService.$transaction', () => {
  type Transaction = (...args: unknown[]) => Promise<unknown>;
  // The generated client the service extends, whichever copy of the package
  // resolved it: spying on this prototype is spying on what the service calls.
  const client = Object.getPrototypeOf(PrismaService.prototype) as { $transaction: Transaction };

  afterEach(() => jest.restoreAllMocks());

  it('holds an interactive transaction’s writes until the client resolves it', async () => {
    const service = new PrismaService();
    const sent: string[] = [];
    service.setWriteHook((_model, _action, row) => sent.push((row as { id: string }).id));
    const begin = jest
      .spyOn(client, '$transaction')
      .mockImplementation(async (callback: unknown) => (callback as (tx: unknown) => Promise<unknown>)({}));

    let duringTransaction: string[] = [];
    const result = await service.$transaction(async () => {
      service.announceWrite('Task', 'update', { id: 't1' });
      duringTransaction = [...sent];
      return 'done';
    });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(result).toBe('done');
    expect(duringTransaction).toEqual([]);
    expect(sent).toEqual(['t1']);
  });

  it('wraps the array form too', async () => {
    const service = new PrismaService();
    const sent: string[] = [];
    service.setWriteHook((_model, _action, row) => sent.push((row as { id: string }).id));
    jest.spyOn(client, '$transaction').mockImplementation(async () => {
      // What the middleware does for a query of the batch.
      (service as unknown as { announcer: WriteAnnouncer }).announcer.written(
        'Task',
        'update',
        { id: 'batched' },
        true,
      );
      expect(sent).toEqual([]);
      return [1];
    });

    await expect(service.$transaction([] as never)).resolves.toEqual([1]);
    expect(sent).toEqual(['batched']);
  });

  it('a transaction the client rolls back announces none of its own writes', async () => {
    const service = new PrismaService();
    const sent: string[] = [];
    service.setWriteHook((_model, _action, row) => sent.push((row as { id: string }).id));
    jest.spyOn(client, '$transaction').mockImplementation(async () => {
      (service as unknown as { announcer: WriteAnnouncer }).announcer.written(
        'Task',
        'update',
        { id: 'never' },
        true,
      );
      throw new Error('serialization failure');
    });

    await expect(service.$transaction(async () => undefined)).rejects.toThrow('serialization failure');
    expect(sent).toEqual([]);
  });
});
