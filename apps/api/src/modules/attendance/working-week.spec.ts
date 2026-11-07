import {
  DEFAULT_WORKING_SATURDAYS,
  settingsToStore,
  withWorkingSaturdays,
  workScheduleOf,
  workingSaturdaysOn,
  workingWeekOf,
} from '@strata/config';
import { isWeekend } from './attendance-compute';
import { countWorkingDays } from '../leave/leave-balance';

/**
 * Which Saturdays a workspace works is its own (Settings → Workspace), kept as a
 * history so a change applies from the day it is made. November 2026: the 7th is
 * the month's 1st Saturday, the 14th its 2nd, the 21st its 3rd.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('the working week — a history, read by the day', () => {
  it('a workspace that never said works the 1st and 3rd Saturdays, as every workspace did', () => {
    expect(DEFAULT_WORKING_SATURDAYS).toEqual([1, 3]);
    const schedule = workScheduleOf({});
    expect(isWeekend(day('2026-11-07'), schedule)).toBe(false);
    expect(isWeekend(day('2026-11-14'), schedule)).toBe(true);
    expect(isWeekend(day('2026-11-21'), schedule)).toBe(false);
    // And with no schedule at all — callers with no workspace in hand.
    expect(isWeekend(day('2026-11-14'))).toBe(true);
  });

  it('each day is read by the rule in force on it', () => {
    const schedule = workScheduleOf({ workingWeek: [{ from: '2026-11-10', saturdays: [] }] });
    // Before the change: the default, the 1st Saturday worked.
    expect(isWeekend(day('2026-11-07'), schedule)).toBe(false);
    // From it: no Saturday worked, the 3rd included.
    expect(isWeekend(day('2026-11-21'), schedule)).toBe(true);
    // Sundays never were.
    expect(isWeekend(day('2026-11-08'), schedule)).toBe(true);
  });

  it('a leave across the change costs what its days cost on each side of it', () => {
    const schedule = workScheduleOf({ workingWeek: [{ from: '2026-11-10', saturdays: [] }] });
    // Mon 2 – Sat 21 November: 15 weekdays, the 7th (worked then), not the 14th
    // (never) nor the 21st (no longer).
    expect(countWorkingDays(day('2026-11-02'), day('2026-11-21'), undefined, schedule)).toBe(16);
    expect(countWorkingDays(day('2026-11-02'), day('2026-11-21'))).toBe(17);
  });

  it('a change from a day replaces anything from that day on, and a restatement adds nothing', () => {
    const history = [{ from: '2026-01-05', saturdays: [2, 4] }];
    expect(withWorkingSaturdays(history, [1, 2, 3, 4, 5], '2026-11-07')).toEqual([
      ...history,
      { from: '2026-11-07', saturdays: [1, 2, 3, 4, 5] },
    ]);
    // Corrected the same day: the first change of the day goes.
    const twice = withWorkingSaturdays(
      withWorkingSaturdays(history, [], '2026-11-07'),
      [1],
      '2026-11-07',
    );
    expect(twice).toEqual([...history, { from: '2026-11-07', saturdays: [1] }]);
    // Back to what was already in force: nothing new.
    expect(withWorkingSaturdays(history, [4, 2], '2026-11-07')).toEqual(history);
  });

  it('reads a stored history tolerantly, oldest first, skipping what it cannot use', () => {
    expect(
      workingWeekOf({
        workingWeek: [
          { from: '2026-11-07', saturdays: [3, 1, 3] },
          { from: 'yesterday', saturdays: [1] },
          { from: '2026-01-05', saturdays: [9] },
          { from: '2026-02-02', saturdays: [] },
        ],
      }),
    ).toEqual([
      { from: '2026-02-02', saturdays: [] },
      { from: '2026-11-07', saturdays: [1, 3] },
    ]);
    expect(workingSaturdaysOn('2026-03-01', workingWeekOf({ workingWeek: 'all' }))).toEqual([1, 3]);
  });

  it('the stored settings: the request folded into the history, which no request writes directly', () => {
    expect(
      settingsToStore(
        { timezone: 'Asia/Kolkata', workingSaturdays: [2] },
        { workingWeek: [{ from: '2026-01-05', saturdays: [] }] },
        '2026-11-07',
      ),
    ).toEqual({
      timezone: 'Asia/Kolkata',
      workingWeek: [
        { from: '2026-01-05', saturdays: [] },
        { from: '2026-11-07', saturdays: [2] },
      ],
    });
  });
});
