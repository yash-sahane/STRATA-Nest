/** @type {import('jest').Config} — Phase-1A auth e2e (needs live Postgres + Redis). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  moduleNameMapper: {
    '^@strata/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@strata/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^@strata/config$': '<rootDir>/../../../packages/config/src/index.ts',
    '^@strata/prisma$': '<rootDir>/../../../packages/prisma/src/index.ts',
  },
  testTimeout: 30000,
};
