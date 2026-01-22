import type { Config } from 'jest';

const config: Config = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testRegex: 'test/integration/.*\\.e2e-spec\\.ts$',
    transform: {
        '^.+\\.(t|j)s$': [
            'ts-jest',
            {
                tsconfig: 'tsconfig.json',
            },
        ],
    },
    testEnvironment: 'node',
    testTimeout: 120000,
};

export default config;
