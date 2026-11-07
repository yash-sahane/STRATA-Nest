import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@strata/prisma';
import type { GitJob } from '@strata/shared';
import { GitProcessor, isInfrastructureError } from './git.processor';

// Named as Prisma names them: the processor tells them apart by class name.
class PrismaClientKnownRequestError extends Error {
  constructor(readonly code: string) {
    super(`prisma ${code}`);
  }
}
class PrismaClientUnknownRequestError extends Error {}
class PrismaClientValidationError extends Error {}

describe('GitProcessor.parseTaskRefs', () => {
  it('extracts #-prefixed and bare hierarchy refs', () => {
    expect(GitProcessor.parseTaskRefs('fixes #ABC-12 and PROJ-3')).toEqual(['ABC-12', 'PROJ-3']);
  });
  it('reads the ids tasks really have, subtasks included', () => {
    expect(GitProcessor.parseTaskRefs('fixes #PTE-RAU-FRL-01-T02')).toEqual(['PTE-RAU-FRL-01-T02']);
    // A subtask is its parent's id plus a dotted number...
    expect(GitProcessor.parseTaskRefs('closes #PRJ-T03.1, see #PRJ-T03.1.2')).toEqual([
      'PRJ-T03.1',
      'PRJ-T03.1.2',
    ]);
    // ...but a sentence's full stop is not part of one.
    expect(GitProcessor.parseTaskRefs('Fixes #PRJ-T03.')).toEqual(['PRJ-T03']);
  });
  it('dedupes and returns [] when none present', () => {
    expect(GitProcessor.parseTaskRefs('no refs here')).toEqual([]);
    expect(GitProcessor.parseTaskRefs('#T-1 #T-1')).toEqual(['T-1']);
  });
});

describe('GitProcessor.closingRefs', () => {
  it('reads a closing keyword directly before the reference, in any case, with or without a colon', () => {
    expect(GitProcessor.closingRefs('fixes #ABC-12')).toEqual(['ABC-12']);
    expect(GitProcessor.closingRefs('Closes: PRJ-12')).toEqual(['PRJ-12']);
    expect(GitProcessor.closingRefs('RESOLVED #PRJ-T03.1')).toEqual(['PRJ-T03.1']);
    expect(GitProcessor.closingRefs('Fixes #PRJ-T03.')).toEqual(['PRJ-T03']);
  });

  it('ignores a keyword anywhere else in the message', () => {
    expect(GitProcessor.closingRefs('WIP #PRJ-T03, still need to fix tests')).toEqual([]);
    expect(GitProcessor.closingRefs('Fix the build. Refs #PRJ-T03')).toEqual([]);
    expect(GitProcessor.closingRefs('prefix #PRJ-T03')).toEqual([]);
  });

  it('closes only what each keyword names', () => {
    expect(GitProcessor.closingRefs('fixes #A-1, #A-2 and closes BB-3')).toEqual(['A-1', 'BB-3']);
  });

  it('keeps a bare reference to upper case, as linking does', () => {
    expect(GitProcessor.closingRefs('fixes utf-8 handling')).toEqual([]);
  });

  it('closes nothing in a revert, though it quotes the fix it takes back', () => {
    expect(
      GitProcessor.closingRefs('Revert "Fix login (fixes #PRJ-T03)"\n\nThis reverts commit 1a2b3c4d.'),
    ).toEqual([]);
    // A merged revert pull request: the revert is the body, not the subject.
    expect(
      GitProcessor.closingRefs(
        'Merge pull request #45 from org/revert-44-login\n\nRevert "Fix login (fixes #PRJ-T03)"',
      ),
    ).toEqual([]);
  });
});

describe('isInfrastructureError', () => {
  it('is the database failing: no connection, a dead engine, an unknown error, a timeout', () => {
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P1001'))).toBe(true);
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P1017'))).toBe(true);
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P2024'))).toBe(true);
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P2028'))).toBe(true);
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P2034'))).toBe(true);
    expect(isInfrastructureError(new PrismaClientUnknownRequestError('?'))).toBe(true);
  });

  it('is not one commit’s bad data', () => {
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P2003'))).toBe(false);
    expect(isInfrastructureError(new PrismaClientKnownRequestError('P2000'))).toBe(false);
    expect(isInfrastructureError(new PrismaClientValidationError('Invalid Date'))).toBe(false);
    expect(isInfrastructureError(new TypeError('message.matchAll is not a function'))).toBe(false);
    expect(isInfrastructureError(undefined)).toBe(false);
  });
});

function makeProcessor(
  overrides: Partial<Record<string, unknown>> = {},
  opts: { alreadyRecorded?: string[] } = {},
) {
  // ON CONFLICT DO NOTHING: a sha already recorded counts 0.
  const createMany = jest.fn(({ data }: { data: Array<{ commitSha: string }> }) =>
    Promise.resolve({ count: (opts.alreadyRecorded ?? []).includes(data[0].commitSha) ? 0 : 1 }),
  );
  const commitUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  // Both reads of the task: resolving the refs, and the ones to move.
  const findMany = jest.fn().mockResolvedValue([
    { id: 'task-1', hierarchyId: 'ABC-12', status: 'TODO', functionalRequirementId: 'fr1', epicId: 'e1' },
  ]);
  // The roll-up: three of the requirement's four tasks are now under way.
  const count = jest.fn(({ where }: { where: { status?: unknown } }) =>
    Promise.resolve(where.status === 'DONE' ? 0 : where.status === undefined ? 4 : 3),
  );
  const requirementUpdate = jest.fn().mockResolvedValue({});
  const epicUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    gitHubIntegration: { findUnique: jest.fn().mockResolvedValue({ autoUpdateStatus: true }) },
    gitLabIntegration: { findUnique: jest.fn().mockResolvedValue(null) },
    discordIntegration: { findUnique: jest.fn().mockResolvedValue(null) },
    gitCommit: { createMany, updateMany: commitUpdateMany },
    task: { findMany, updateMany, count },
    functionalRequirement: {
      findUnique: jest.fn().mockResolvedValue({ status: 'APPROVED', progress: 0 }),
      update: requirementUpdate,
      // An epic's roll-up also counts its requirements that have no task yet: none here.
      findMany: jest.fn().mockResolvedValue([]),
    },
    epic: {
      findUnique: jest.fn().mockResolvedValue({ status: 'TODO', progress: 0 }),
      update: epicUpdate,
    },
    ...overrides,
  } as Record<string, unknown>;
  // The transaction client is the same mock: what matters is what ran inside it.
  const $transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  prisma.$transaction = $transaction;
  const config = { get: (_k: string, d?: unknown) => d } as never as ConfigService;
  return {
    proc: new GitProcessor(config, prisma as unknown as PrismaService),
    createMany,
    commitUpdateMany,
    updateMany,
    findMany,
    requirementUpdate,
    epicUpdate,
    $transaction,
  };
}

const commit = (sha: string, message: string) => ({
  sha,
  message,
  author: 'A',
  authorEmail: 'a@b.c',
  timestamp: '2026-01-01T00:00:00Z',
  url: 'u',
});
const jobOf = (...commits: ReturnType<typeof commit>[]): { data: GitJob } => ({
  data: { provider: 'GITHUB', projectId: 'p1', event: 'push', commits },
});
const job = (message: string) => jobOf(commit('sha1', message));

describe('GitProcessor.handle', () => {
  it('records the commit idempotently and links resolved tasks', async () => {
    const { proc, createMany } = makeProcessor();
    const res = await proc.handle(job('fixes #ABC-12'));
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ projectId: 'p1', commitSha: 'sha1', linkedTaskIds: ['task-1'] })],
      skipDuplicates: true,
    });
    expect(res).toEqual({ recorded: 1, linked: 1 });
  });

  it('moves linked tasks to REVIEW — never DONE — on a close-intent message when enabled', async () => {
    const { proc, updateMany, $transaction } = makeProcessor();
    await proc.handle(job('fixes #ABC-12'));
    // Only from before review: a task already in review or done is left alone,
    // and completing one stays a person's decision.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['task-1'] }, status: { in: ['BACKLOG', 'TODO', 'IN_PROGRESS'] } },
      data: { status: 'REVIEW', version: { increment: 1 } },
    });
    // In the transaction that recorded the commit, so neither happens without the other.
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  // A push changed a task with no browser in the loop, so nothing summed its
  // parents: a requirement whose every task had been pushed still read "Planned".
  it('re-sums the requirement and the epic the moved task is under', async () => {
    const { proc, requirementUpdate, epicUpdate } = makeProcessor();
    await proc.handle(job('fixes #ABC-12'));
    expect(requirementUpdate).toHaveBeenCalledWith({
      where: { id: 'fr1' },
      data: { progress: 0, status: 'IMPLEMENTED', version: { increment: 1 } },
    });
    expect(epicUpdate).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { progress: 0, status: 'IN_PROGRESS', version: { increment: 1 } },
    });
  });

  it('leaves statuses alone when the integration has not opted in', async () => {
    const { proc, updateMany } = makeProcessor({
      gitHubIntegration: { findUnique: jest.fn().mockResolvedValue({ autoUpdateStatus: false }) },
    });
    await proc.handle(job('fixes #ABC-12'));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('posts to Discord only when the stored URL is Discord’s', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    const original = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const internal = makeProcessor({
        discordIntegration: {
          findUnique: jest.fn().mockResolvedValue({ webhookUrl: 'http://127.0.0.1:6379/' }),
        },
      });
      await internal.proc.handle(job('adds #ABC-12'));
      expect(fetchMock).not.toHaveBeenCalled();

      const real = makeProcessor({
        discordIntegration: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ webhookUrl: 'https://discord.com/api/webhooks/1/token' }),
        },
      });
      await real.proc.handle(job('adds #ABC-12'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.content).toBe('1 new commit pushed to GitHub.');
      expect(body.allowed_mentions).toEqual({ parse: [] });
    } finally {
      global.fetch = original;
    }
  });

  it('does not change status without close-intent', async () => {
    const { proc, updateMany } = makeProcessor();
    await proc.handle(job('mentions #ABC-12 but no keyword'));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not move a task the keyword is not attached to', async () => {
    const { proc, updateMany } = makeProcessor();
    const res = await proc.handle(job('WIP #ABC-12, still need to fix tests'));
    expect(updateMany).not.toHaveBeenCalled();
    expect(res).toEqual({ recorded: 1, linked: 1 }); // still linked
  });

  it('does not move a task from a revert of its fix', async () => {
    const { proc, updateMany } = makeProcessor();
    await proc.handle(job('Revert "Fix login (fixes #ABC-12)"\n\nThis reverts commit 1a2b3c4d.'));
    expect(updateMany).not.toHaveBeenCalled();
  });

  describe('a commit already recorded (a merge, a push to another branch)', () => {
    it('only refreshes its links: no move, no announcement, nothing new to count', async () => {
      const { proc, updateMany, commitUpdateMany, requirementUpdate } = makeProcessor({}, {
        alreadyRecorded: ['sha1'],
      });
      const res = await proc.handle(job('fixes #ABC-12'));
      expect(commitUpdateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', commitSha: 'sha1' },
        data: { linkedTaskIds: ['task-1'] },
      });
      expect(updateMany).not.toHaveBeenCalled();
      expect(requirementUpdate).not.toHaveBeenCalled();
      expect(res).toEqual({ recorded: 0, linked: 1 });
    });

    it('is left out of the Discord count, and a push of nothing new posts nothing', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      const original = global.fetch;
      global.fetch = fetchMock as unknown as typeof fetch;
      const discord = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ webhookUrl: 'https://discord.com/api/webhooks/1/token' }),
      };
      try {
        const merge = makeProcessor({ discordIntegration: discord }, { alreadyRecorded: ['old'] });
        await merge.proc.handle(jobOf(commit('old', 'adds #ABC-12'), commit('new', 'merge')));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).content).toBe(
          '1 new commit pushed to GitHub.',
        );

        const repeat = makeProcessor({ discordIntegration: discord }, { alreadyRecorded: ['old'] });
        await repeat.proc.handle(jobOf(commit('old', 'adds #ABC-12')));
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = original;
      }
    });
  });

  describe('failures', () => {
    it('fails the job when the database does, so BullMQ retries it', async () => {
      const { proc, createMany } = makeProcessor();
      createMany.mockRejectedValueOnce(new PrismaClientKnownRequestError('P1001'));
      await expect(proc.handle(job('fixes #ABC-12'))).rejects.toThrow('P1001');
    });

    it('fails the job when the move fails — and the transaction takes the commit back with it', async () => {
      const { proc, updateMany, $transaction } = makeProcessor();
      updateMany.mockRejectedValueOnce(new PrismaClientUnknownRequestError('connection reset'));
      await expect(proc.handle(job('fixes #ABC-12'))).rejects.toThrow('connection reset');
      // The insert and the move ran in one transaction, which rejected: Postgres
      // keeps neither, and the retry finds the commit new again.
      await expect($transaction.mock.results[0].value).rejects.toThrow('connection reset');
    });

    it('skips a commit whose own data is bad, and records the rest', async () => {
      const { proc, createMany } = makeProcessor();
      createMany.mockRejectedValueOnce(new PrismaClientValidationError('Invalid value for timestamp'));
      const res = await proc.handle(jobOf(commit('bad', 'adds #ABC-12'), commit('good', 'adds #ABC-12')));
      expect(res).toEqual({ recorded: 1, linked: 1 });
      expect(createMany).toHaveBeenCalledTimes(2);
    });
  });
});
