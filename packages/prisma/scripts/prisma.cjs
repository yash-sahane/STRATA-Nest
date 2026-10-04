#!/usr/bin/env node
/**
 * Run the Prisma CLI the way this repo needs it run.
 *
 * Two things every Prisma command here depends on, and that each one used to have to
 * remember for itself:
 *
 *   the schema path   The schema is a FOLDER (`schema/`, one file per domain), not the
 *                     `schema.prisma` Prisma looks for by default. A command run without
 *                     `--schema=schema` stops at "Could not find Prisma Schema" — which
 *                     is what the README's own migrate command did.
 *
 *   the environment   `DATABASE_URL` lives in the repo-root `.env`. Prisma only reads a
 *                     `.env` beside the schema or in the working directory, and pnpm runs
 *                     a package script from the package folder, so `validate` and
 *                     `db pull` failed with P1012 "Environment variable not found" even
 *                     though the variable was set exactly where the docs say to set it.
 *
 * Variables already in the real environment win over the file, so in a container —
 * where compose injects `DATABASE_URL` and there is no `.env` at all — this is a no-op
 * and the injected value is used untouched.
 *
 *     node scripts/prisma.cjs migrate deploy
 *     node scripts/prisma.cjs validate
 */
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const packageDir = join(__dirname, '..');
const rootEnv = join(packageDir, '..', '..', '.env');

if (existsSync(rootEnv)) {
  // `override: false` is dotenv's default: a value the shell or compose already set is
  // left alone, which is what lets one script serve a laptop and a container.
  require('dotenv').config({ path: rootEnv });
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/prisma.cjs <prisma command...>');
  process.exit(2);
}

// The CLI's own entry file, run with this Node. Going through `npx` or a shell shim
// would add a second process and a PATH lookup that behaves differently on Windows.
const cli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [cli, ...args, '--schema=schema'], {
  cwd: packageDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
