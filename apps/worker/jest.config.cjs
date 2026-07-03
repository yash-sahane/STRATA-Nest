/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  moduleNameMapper: {
    '^@lt/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
    '^@lt/config$': '<rootDir>/../../../packages/config/src/index.ts',
  },
};
