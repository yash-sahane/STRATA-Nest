import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_LATE_GRACE_MINUTES,
  DEFAULT_WORKDAY_START,
  DEFAULT_WORKING_SATURDAYS,
  MAX_LATE_GRACE_MINUTES,
} from '@strata/config';

/**
 * The settings form shows the workday a workspace has when it has not set one,
 * and refuses a grace period past the limit. It cannot import the API's
 * settings contract, so it states them again; this keeps the two the same.
 */
const settingsPage = readFileSync(
  join(__dirname, '../../../../frontend/src/app/(dashboard)/settings/page.tsx'),
  'utf8',
);
const constant = (name: string) => settingsPage.match(new RegExp(`const ${name} = ([^;]+);`))?.[1].trim();

describe('the settings form states the workday the API applies', () => {
  it('the same default start, grace period and limit', () => {
    expect(constant('DEFAULT_WORKDAY_START')).toBe(`'${DEFAULT_WORKDAY_START}'`);
    expect(Number(constant('DEFAULT_LATE_GRACE_MINUTES'))).toBe(DEFAULT_LATE_GRACE_MINUTES);
    expect(Number(constant('MAX_LATE_GRACE_MINUTES'))).toBe(MAX_LATE_GRACE_MINUTES);
  });
});

/**
 * The browser's calendar and attendance rate count working days themselves,
 * so they state the default working week again; a workspace that has never set
 * one must see the Saturdays on screen the API counts.
 */
describe('the browser counts the working week the API counts', () => {
  const workingDays = readFileSync(
    join(__dirname, '../../../../frontend/src/lib/utils/working-days.ts'),
    'utf8',
  );
  it('the same default Saturdays', () => {
    const stated = workingDays.match(
      /export const DEFAULT_WORKING_SATURDAYS: readonly number\[\] = \[([^\]]*)\];/,
    )?.[1];
    expect(stated?.split(',').map((w) => Number(w.trim()))).toEqual([...DEFAULT_WORKING_SATURDAYS]);
  });
});
