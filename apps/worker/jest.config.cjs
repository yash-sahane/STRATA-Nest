/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  moduleNameMapper: {
    '^@strata/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^@strata/config$': '<rootDir>/../../../packages/config/src/index.ts',
  },
};
