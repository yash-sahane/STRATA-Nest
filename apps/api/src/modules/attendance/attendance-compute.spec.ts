import {
  calculateLateMinutes,
  calculateWorkHours,
  determineAttendanceStatus,
  isLateCheckIn,
} from './attendance-compute';

// Local-time Date at a given hour:minute (compute uses getHours/getMinutes).
const at = (h: number, m: number): Date => new Date(2026, 5, 15, h, m, 0);

describe('attendance-compute (ported from frontend attendance-utils)', () => {
  it('isLateCheckIn: late only after 08:30 + 15m grace', () => {
    expect(isLateCheckIn(at(8, 30))).toBe(false);
    expect(isLateCheckIn(at(8, 45))).toBe(false); // boundary
    expect(isLateCheckIn(at(8, 46))).toBe(true);
  });

  it('calculateLateMinutes measured from 08:30', () => {
    expect(calculateLateMinutes(at(8, 20))).toBe(0);
    expect(calculateLateMinutes(at(8, 30))).toBe(0);
    expect(calculateLateMinutes(at(8, 40))).toBe(10);
  });

  it('calculateWorkHours', () => {
    expect(calculateWorkHours(at(9, 0), at(17, 0))).toBe(8);
    expect(calculateWorkHours(at(9, 0), at(12, 30))).toBe(3.5);
  });

  it('determineAttendanceStatus', () => {
    expect(determineAttendanceStatus(null, null, null)).toBe('ABSENT');
    expect(determineAttendanceStatus(at(8, 30), at(17, 0), 8)).toBe('PRESENT'); // on time
    expect(determineAttendanceStatus(at(8, 30), at(11, 0), 2)).toBe('HALF_DAY'); // on time, < 4h
    expect(determineAttendanceStatus(at(10, 0), null, null)).toBe('LATE'); // late, not checked out
    expect(determineAttendanceStatus(at(10, 0), at(17, 0), 7)).toBe('LATE'); // late, full-ish day
    expect(determineAttendanceStatus(at(10, 0), at(12, 0), 2)).toBe('HALF_DAY'); // late + short
  });
});
