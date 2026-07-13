import { generateId, isNativeId, ID_ALPHABET, ID_LENGTH } from './generate-id';

/**
 * Guard: these IDs must remain in the application's permanent
 * format so existing data and frontend cache keys keep working.
 */
describe('generateId — permanent ID format', () => {
  it('produces ids of exactly 20 characters', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateId()).toHaveLength(ID_LENGTH);
    }
  });

  it('uses only the permanent alphabet [a-zA-Z0-9]', () => {
    const blob = Array.from({ length: 5000 }, () => generateId()).join('');
    expect(/^[A-Za-z0-9]+$/.test(blob)).toBe(true);
  });

  it('has the exact 62-symbol alphabet (ascii_letters + digits)', () => {
    expect(ID_ALPHABET).toHaveLength(62);
    expect(ID_ALPHABET).toBe(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    );
  });

  it('exercises every alphabet symbol across many samples (uniformity sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i += 1) {
      for (const ch of generateId()) seen.add(ch);
    }
    expect(seen.size).toBe(62);
  });

  it('is collision-free across a large batch', () => {
    const n = 100_000;
    const set = new Set<string>();
    for (let i = 0; i < n; i += 1) set.add(generateId());
    expect(set.size).toBe(n);
  });

  it('recognises native ids and rejects malformed ones', () => {
    expect(isNativeId(generateId())).toBe(true);
    expect(isNativeId('too-short')).toBe(false);
    expect(isNativeId('contains spaces!!!!!')).toBe(false);
    expect(isNativeId(12345)).toBe(false);
  });
});
