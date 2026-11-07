import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_TYPES, NotifiableEvent } from '@strata/shared';

/**
 * The frontend cannot import packages/shared, so it keeps its own copy of the
 * notification types. This keeps the copy honest: the bell's type, and the
 * preference screen's rows, are exactly what the API sends.
 */
const FRONTEND = join(__dirname, '../../../../frontend/src');
const read = (rel: string) => readFileSync(join(FRONTEND, rel), 'utf8');

describe('notification types', () => {
  it('every account notice is one of the list', () => {
    for (const type of Object.values(NotifiableEvent)) expect(NOTIFICATION_TYPES).toContain(type);
  });

  it("the frontend's NotificationType is the same list", () => {
    const source = read('types/index.ts');
    const union = source.slice(source.indexOf('export type NotificationType ='));
    const listed = union.slice(0, union.indexOf(';')).match(/'([A-Z_]+)'/g)?.map((t) => t.slice(1, -1)) ?? [];
    expect([...listed].sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it('the preference screen offers only types the API sends', () => {
    const offered = read('components/settings/notification-preferences.tsx')
      .match(/type: '([A-Z_]+)'/g)
      ?.map((t) => t.slice("type: '".length, -1)) ?? [];
    expect(offered.length).toBeGreaterThan(10);
    for (const type of offered) expect(NOTIFICATION_TYPES).toContain(type);
  });
});
