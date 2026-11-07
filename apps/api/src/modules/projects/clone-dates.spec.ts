import { dayIn, dayMarker, daysBetween, markerDay, shiftInstant, shiftMarker } from './clone-dates';

describe('clone-dates', () => {
  it('reads and writes a date column as the day it stands for', () => {
    expect(dayMarker('2026-11-07')).toEqual(new Date('2026-11-07T00:00:00.000Z'));
    expect(markerDay(new Date('2026-11-07T00:00:00.000Z'))).toBe('2026-11-07');
  });

  it('counts whole days between two days, either way round', () => {
    expect(daysBetween('2026-01-05', '2026-11-07')).toBe(306);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-11-07', '2026-11-01')).toBe(-6);
    expect(daysBetween('2026-11-07', '2026-11-07')).toBe(0);
  });

  it('moves a date column by whole days', () => {
    expect(shiftMarker(dayMarker('2026-01-18'), 306)).toEqual(dayMarker('2026-11-20'));
    expect(shiftMarker(dayMarker('2026-03-02'), -2)).toEqual(dayMarker('2026-02-28'));
  });

  it('reads the day an instant falls on in a zone', () => {
    // 20:00 UTC on the 12th is already the 13th in India.
    expect(dayIn(new Date('2026-11-12T20:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-11-13');
    expect(dayIn(new Date('2026-11-12T20:00:00.000Z'), 'UTC')).toBe('2026-11-12');
  });

  it("moves an instant by calendar days, keeping its time of day on the zone's clock", () => {
    // India's midnight on the 13th, 306 days on: India's midnight on 15 November.
    expect(shiftInstant(new Date('2026-01-12T18:30:00.000Z'), 306, 'Asia/Kolkata')).toEqual(
      new Date('2026-11-14T18:30:00.000Z'),
    );
    // 09:15 and a few seconds in New York stays 09:15 and those seconds.
    expect(shiftInstant(new Date('2026-05-04T13:15:42.250Z'), 7, 'America/New_York')).toEqual(
      new Date('2026-05-11T13:15:42.250Z'),
    );
  });

  it('lands on the same wall-clock time across a daylight-saving change', () => {
    // Midnight in London in summer (23:00 UTC the day before) …
    const summer = new Date('2026-07-01T23:00:00.000Z');
    // … 153 days on is midnight in winter, 00:00 UTC — not 23:00, the day before.
    expect(shiftInstant(summer, 153, 'Europe/London')).toEqual(new Date('2026-12-02T00:00:00.000Z'));
    // And back again.
    expect(shiftInstant(new Date('2026-12-02T00:00:00.000Z'), -153, 'Europe/London')).toEqual(summer);
  });

  it('leaves an instant where it is for no days', () => {
    const at = new Date('2026-11-07T06:00:00.000Z');
    const moved = shiftInstant(at, 0, 'Asia/Kolkata');
    expect(moved).toEqual(at);
    expect(moved).not.toBe(at);
  });
});
