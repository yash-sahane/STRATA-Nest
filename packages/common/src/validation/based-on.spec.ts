import { sameFieldValue } from './based-on';

/**
 * The comparison the whole lost-update check rests on.
 *
 * Every false NEGATIVE here is a save refused for a change nobody made, on a screen that
 * will then refuse it again. Every false POSITIVE is somebody's work overwritten in
 * silence. The pairs below are the ones the two sides of the wire actually produce.
 */
describe('sameFieldValue', () => {
  describe('the ways a field says "nothing here"', () => {
    const empties = [null, undefined, '', [], {}];
    it.each(empties.flatMap((a) => empties.map((b) => [a, b] as const)))(
      'treats %p and %p as the same absence',
      (a, b) => {
        expect(sameFieldValue(a, b)).toBe(true);
      },
    );

    it('does not confuse an absence with a value', () => {
      expect(sameFieldValue('', 'something')).toBe(false);
      expect(sameFieldValue([], ['someone'])).toBe(false);
      expect(sameFieldValue(null, 0)).toBe(false);
    });
  });

  describe('values rendered differently on the two sides', () => {
    it('matches a Date against the ISO string a response carries', () => {
      const d = new Date('2026-11-05T09:00:00.000Z');
      expect(sameFieldValue(d, '2026-11-05T09:00:00.000Z')).toBe(true);
    });

    it('matches a number against its string form', () => {
      // enableImplicitConversion and JSON round-trips both produce this.
      expect(sameFieldValue(3, '3')).toBe(true);
    });

    it('still separates two different dates', () => {
      const d = new Date('2026-11-05T09:00:00.000Z');
      expect(sameFieldValue(d, '2026-12-01T09:00:00.000Z')).toBe(false);
    });
  });

  describe('lists and objects', () => {
    it('matches an identical list', () => {
      expect(sameFieldValue(['a', 'b'], ['a', 'b'])).toBe(true);
    });

    it('treats a REORDERED list as a change', () => {
      // Order is meaningful in assignee lists — the first name is the one shown on a
      // card with no room for the rest. Somebody who reordered it made a change, and
      // ignoring that would overwrite it in silence.
      expect(sameFieldValue(['a', 'b'], ['b', 'a'])).toBe(false);
    });

    it('matches an identical object', () => {
      expect(sameFieldValue({ a: 1 }, { a: 1 })).toBe(true);
    });

    it('separates objects that differ', () => {
      expect(sameFieldValue({ a: 1 }, { a: 2 })).toBe(false);
    });
  });

  describe('plain values', () => {
    it('matches equal strings and separates different ones', () => {
      expect(sameFieldValue('LOW', 'LOW')).toBe(true);
      expect(sameFieldValue('LOW', 'CRITICAL')).toBe(false);
    });

    it('separates booleans from their absence', () => {
      // `false` is a value, not an absence — an archived flag that was turned off is not
      // the same as one nobody has set.
      expect(sameFieldValue(false, null)).toBe(false);
      expect(sameFieldValue(false, false)).toBe(true);
      expect(sameFieldValue(false, true)).toBe(false);
    });
  });
});
