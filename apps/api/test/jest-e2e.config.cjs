/** @type {import('jest').Config} — Phase-1A auth e2e (needs live Postgres + Redis). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  moduleNameMapper: {
    '^@lt/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@lt/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^@lt/config$': '<rootDir>/../../../packages/config/src/index.ts',
    '^@lt/prisma$': '<rootDir>/../../../packages/prisma/src/index.ts',
    '^@lt/testing$': '<rootDir>/../../../packages/testing/src/index.ts',
  },
  testTimeout: 30000,
};
