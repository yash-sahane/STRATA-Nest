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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
