import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  rootDir: '..',

  testMatch: [
    '<rootDir>/test/**/*.e2e-spec.ts',
    '<rootDir>/test/**/*.spec.ts',
  ],

  moduleFileExtensions: ['ts', 'js', 'json'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
};

export default config;
