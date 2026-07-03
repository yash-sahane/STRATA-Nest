import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@lt/prisma';
import type { GitJob } from '@lt/shared';
import { GitProcessor } from './git.processor';

describe('GitProcessor.parseTaskRefs', () => {
  it('extracts #-prefixed and bare hierarchy refs', () => {
    expect(GitProcessor.parseTaskRefs('fixes #ABC-12 and PROJ-3')).toEqual(['ABC-12', 'PROJ-3']);
  });
  it('dedupes and returns [] when none present', () => {
    expect(GitProcessor.parseTaskRefs('no refs here')).toEqual([]);
    expect(GitProcessor.parseTaskRefs('#T-1 #T-1')).toEqual(['T-1']);
  });
});

function makeProcessor(overrides: Partial<Record<string, unknown>> = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findMany = jest.fn().mockResolvedValue([{ id: 'task-1' }]);
  const prisma = {
    gitHubIntegration: { findUnique: jest.fn().mockResolvedValue({ autoUpdateStatus: true }) },
    gitLabIntegration: { findUnique: jest.fn().mockResolvedValue(null) },
    discordIntegration: { findUnique: jest.fn().mockResolvedValue(null) },
    gitCommit: { upsert },
    task: { findMany, updateMany },
    ...overrides,
  } as unknown as PrismaService;
  const config = { get: (_k: string, d?: unknown) => d } as never as ConfigService;
  return { proc: new GitProcessor(config, prisma), upsert, updateMany, findMany };
}

const job = (message: string): { data: GitJob } => ({
  data: {
    provider: 'GITHUB',
    projectId: 'p1',
    event: 'push',
    commits: [
      { sha: 'sha1', message, author: 'A', authorEmail: 'a@b.c', timestamp: '2026-01-01T00:00:00Z', url: 'u' },
    ],
  },
});

describe('GitProcessor.handle', () => {
  it('records the commit idempotently and links resolved tasks', async () => {
    const { proc, upsert } = makeProcessor();
    const res = await proc.handle(job('fixes #ABC-12'));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId_commitSha: { projectId: 'p1', commitSha: 'sha1' } } }),
    );
    expect(res).toEqual({ recorded: 1, linked: 1 });
  });

  it('auto-advances linked tasks to DONE on a close-intent message when enabled', async () => {
    const { proc, updateMany } = makeProcessor();
    await proc.handle(job('fixes #ABC-12'));
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['task-1'] } }, data: { status: 'DONE' } });
  });

  it('does not change status without close-intent', async () => {
    const { proc, updateMany } = makeProcessor();
    await proc.handle(job('mentions #ABC-12 but no keyword'));
    expect(updateMany).not.toHaveBeenCalled();
  });
});
