import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  rootDir: '.',

  testRegex: 'integration/.*\\.e2e-spec\\.ts$',

  moduleFileExtensions: ['ts', 'js', 'json'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../src/$1',
  },

  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },

  testTimeout: 120000,
};

export default config;
