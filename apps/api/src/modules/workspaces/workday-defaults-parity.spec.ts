import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_LATE_GRACE_MINUTES,
  DEFAULT_WORKDAY_START,
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
