import { randomBytes } from 'node:crypto';

/** Short unique hex suffix for building non-colliding test data. */
export function uniqueSuffix(): string {
  return randomBytes(4).toString('hex');
}

/** A unique, obviously-fake email (`.test` TLD is reserved and never routable). */
export function randomEmail(prefix = 'user'): string {
  return `${prefix}.${uniqueSuffix()}@example.test`;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
