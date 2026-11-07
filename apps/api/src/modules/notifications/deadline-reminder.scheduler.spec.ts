import type { PrismaService } from '@strata/prisma';
import { DeadlineReminderScheduler } from './deadline-reminder.scheduler';
import type { DeadlineReminderService } from './deadline-reminder.service';

function build(scan: jest.Mock, workspaces = [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }]) {
  const prisma = {
    workspace: { findMany: jest.fn().mockResolvedValue(workspaces) },
  } as unknown as PrismaService;
  return new DeadlineReminderScheduler(prisma, { scan } as unknown as DeadlineReminderService);
}

describe('DeadlineReminderScheduler', () => {
  const NOW = new Date('2026-10-13T08:00:00.000Z');

  it('scans every workspace, whether or not anybody opened it today', async () => {
    const scan = jest.fn().mockResolvedValue(2);
    await expect(build(scan).tick(NOW)).resolves.toBe(6);
    expect(scan.mock.calls).toEqual([
      ['w1', NOW],
      ['w2', NOW],
      ['w3', NOW],
    ]);
  });

  it('does not let one workspace failing cost the others their reminders', async () => {
    const scan = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(4);
    await expect(build(scan).tick(NOW)).resolves.toBe(5);
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it('does not start a second pass while one is still running', async () => {
    let release: (value: number) => void = () => undefined;
    const scan = jest.fn().mockReturnValue(new Promise<number>((resolve) => (release = resolve)));
    const scheduler = build(scan, [{ id: 'w1' }]);

    const first = scheduler.tick(NOW);
    await expect(scheduler.tick(NOW)).resolves.toBe(0);
    release(3);
    await expect(first).resolves.toBe(3);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('starts no timers under test, where a background scan would write into the suite’s database', () => {
    const scheduler = build(jest.fn());
    const spy = jest.spyOn(global, 'setInterval');
    scheduler.onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    scheduler.onModuleDestroy();
  });
});
