// Loads the repo-root .env — same relative-path convention as apps/api/src/main.ts
// and apps/worker/src/main.ts, so this resolves correctly whether run via
// `pnpm --filter @strata/prisma run seed` or `prisma db seed` from any cwd.
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
loadEnv({ path: join(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { pbkdf2Sync, randomInt } from 'node:crypto';

// Mirrors the exact ID format from @strata/common (generateId) and the exact
// password hash format from apps/api PasswordService. Duplicated here rather
// than imported so this package doesn't take on an app-facing dependency —
// see the format docstrings in those originals if either one ever changes.
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateId(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return out;
}

function hashPassword(password: string): string {
  const iterations = 600_000;
  const salt = generateId(16);
  const dk = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  return `pbkdf2_sha256$${iterations}$${salt}$${dk}`;
}

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@strata.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
const ADMIN_WORKSPACE_INVITE_CODE = 'ADMIN-DEFAULT';

/**
 * One ordinary account per workspace role, for the end-to-end suite.
 *
 * Every script under e2e/ signs in as one of these, and until now nothing in the
 * repository created them: they existed in one developer's database because
 * somebody had registered them by hand. Resetting that database deleted them and
 * took all fifty-odd scripts with it at the login step, with nothing to say why —
 * and registering them again by hand runs into the three-per-hour signup limit
 * after the third.
 *
 * They are deliberately plain accounts with NO workspace and the global role
 * MEMBER. The role in each name is the one the suite grants per test, by inviting
 * the account into a workspace it has just created; seeding a membership here
 * would make those tests pass against state they did not set up.
 *
 * The NAME is load-bearing, not decoration: several checks find a person on the
 * roster by looking for the text "Role TESTER", so it has to be exactly this.
 */
const TEST_ROLES = [
  'MANAGER',
  'ASSISTANT_MANAGER',
  'SOFTWARE_DEVELOPER',
  'TESTER',
  'DEVELOPER_INTERN',
  'CONTENT_ENGINEER',
  'MEMBER',
] as const;
const TEST_PASSWORD = process.env.SEED_TEST_PASSWORD ?? 'RolePass123!';

/**
 * Whether to create them. On by default everywhere except production, and refused
 * outright there: these are accounts with a password printed in this file.
 */
function shouldSeedTestAccounts(): boolean {
  const production = process.env.NODE_ENV === 'production';
  const asked = process.env.SEED_TEST_ACCOUNTS;
  if (production) {
    if (asked === 'true') {
      throw new Error(
        'SEED_TEST_ACCOUNTS=true with NODE_ENV=production: refusing to create accounts ' +
          'whose password is published in the repository.',
      );
    }
    return false;
  }
  return asked !== 'false';
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { isSuperuser: true, isAdminFlag: true, isStaff: true, status: 'ACTIVE' },
    create: {
      id: generateId(),
      email: ADMIN_EMAIL,
      password: hashPassword(ADMIN_PASSWORD),
      name: 'Admin',
      role: 'MANAGER',
      isSuperuser: true,
      isAdminFlag: true,
      isStaff: true,
      status: 'ACTIVE',
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { inviteCode: ADMIN_WORKSPACE_INVITE_CODE },
    update: { ownerId: admin.id },
    create: {
      id: generateId(),
      name: 'Admin Workspace',
      ownerId: admin.id,
      inviteCode: ADMIN_WORKSPACE_INVITE_CODE,
    },
  });

  if (admin.workspaceId !== workspace.id) {
    await prisma.user.update({ where: { id: admin.id }, data: { workspaceId: workspace.id } });
  }

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
    update: { role: 'MANAGER', status: 'ACTIVE' },
    create: {
      id: generateId(),
      workspaceId: workspace.id,
      userId: admin.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    },
  });

  console.log(`Seeded superuser "${ADMIN_EMAIL}" (workspace: ${workspace.name}, id: ${workspace.id})`);

  if (shouldSeedTestAccounts()) {
    // Hashed once and reused: PBKDF2 at 600k iterations is deliberately slow, and
    // seven separate derivations of the same password is seven times the wait for
    // nothing. The salt is inside the hash, so sharing it across rows is no weaker
    // than each row carrying its own for accounts that all have one known password.
    const password = hashPassword(TEST_PASSWORD);
    for (const role of TEST_ROLES) {
      const email = `role.${role.toLowerCase()}@strata.local`;
      await prisma.user.upsert({
        where: { email },
        // Put an account that already exists back into a usable state rather than
        // leaving whatever a previous run did to it: a suite that deactivates a
        // user and is then interrupted must not poison the next one.
        update: { status: 'ACTIVE', isActive: true, hasTempPassword: false, password },
        create: {
          id: generateId(),
          email,
          password,
          name: `Role ${role}`,
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      });
    }
    console.log(`Seeded ${TEST_ROLES.length} test accounts (role.<name>@strata.local)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
