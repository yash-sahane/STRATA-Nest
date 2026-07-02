/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  moduleNameMapper: {
    '^@lt/common$': '<rootDir>/../../../packages/common/src/index.ts',
    '^@lt/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^@lt/config$': '<rootDir>/../../../packages/config/src/index.ts',
    '^@lt/prisma$': '<rootDir>/../../../packages/prisma/src/index.ts',
  },
};
