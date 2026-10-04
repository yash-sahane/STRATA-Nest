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
 *   the output folder Where `generate` writes the client depends on HOW Prisma was
 *                     started. Its rule (getDefaultOutdir, @prisma/client's generator):
 *
 *                       1. path ends "node_modules/@prisma/client"  -> beside it
 *                       2. started from a `postinstall` script      -> <INIT_CWD>/node_modules
 *                       3. otherwise                                -> beside it
 *
 *                     Rule 1 compares with forward slashes, so on Windows it never
 *                     matches. This package generates from its own `postinstall`, so
 *                     on Windows rule 2 applied and the client went to the REPO ROOT's
 *                     node_modules — which nothing reads: under pnpm, @prisma/client
 *                     lives in the virtual store and finds the empty placeholder beside
 *                     itself first. Install reported "Generated Prisma Client", and then
 *                     the build failed with `PrismaClient` typed as `any`. Linux was
 *                     unaffected (rule 1 matches there), so the Docker images and CI
 *                     built while a fresh Windows clone could not.
 *
 *                     Rule 2 needs INIT_CWD, so it is withheld from the CLI. That
 *                     leaves rule 3 on every platform, however this script is started.
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

// See "the output folder" above.
const env = { ...process.env };
delete env.INIT_CWD;

const result = spawnSync(process.execPath, [cli, ...args, '--schema=schema'], {
  cwd: packageDir,
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
