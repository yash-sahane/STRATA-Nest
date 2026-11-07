import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_KEYS, ROLE_PERMISSIONS } from './permissions';

/**
 * The frontend cannot import this module, so the roles screen keeps its own
 * catalogue of what each built-in role holds (role-catalogue.ts). Every
 * permission CHECK in the browser is answered by the server (GET
 * /auth/me/access); this catalogue only DESCRIBES the built-in roles to the
 * person editing roles — and must not describe them differently.
 */
const FRONTEND = join(__dirname, '../../../../frontend/src');
const catalogue = readFileSync(join(FRONTEND, 'lib/role-catalogue.ts'), 'utf8');

/** The quoted permission keys between two markers of the catalogue source. */
function keysIn(text: string): string[] {
  return (text.match(/'([a-z]+:[a-z]+)'/g) ?? []).map((k) => k.slice(1, -1));
}

describe('the roles screen describes the roles the API enforces', () => {
  it('names exactly the API\'s permission keys', () => {
    const baseline = catalogue.slice(catalogue.indexOf('BASELINE_PERMISSIONS'), catalogue.indexOf('PERMISSION_GROUPS'));
    const groups = catalogue.slice(catalogue.indexOf('PERMISSION_GROUPS'), catalogue.indexOf('GRANTABLE_KEYS'));
    const named = new Set([...keysIn(baseline), ...keysIn(groups)]);
    expect([...named].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('lists the same seven built-in roles', () => {
    const block = catalogue.slice(catalogue.indexOf('BUILT_IN_ROLE_KEYS'));
    const roles = block.slice(0, block.indexOf('};')).match(/^ {2}([A-Z_]+):/gm)?.map((r) => r.trim().slice(0, -1)) ?? [];
    expect(roles.sort()).toEqual(Object.keys(ROLE_PERMISSIONS).sort());
  });

  it('gives the delivery roles what the API gives them', () => {
    const delivery = catalogue.slice(catalogue.indexOf('const DELIVERY_KEYS'));
    const extra = keysIn(delivery.slice(0, delivery.indexOf(';')));
    const api = [...ROLE_PERMISSIONS.SOFTWARE_DEVELOPER].filter((k) => !ROLE_PERMISSIONS.MEMBER.includes(k));
    expect(extra.sort()).toEqual(api.sort());
  });
});
