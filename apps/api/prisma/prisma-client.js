"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prismaLogOptions = exports.ensurePrismaEngineCompatibility = void 0;
const DEFAULT_ENGINE_TYPE = 'binary';
const ensurePrismaEngineCompatibility = () => {
    if (process.env.PRISMA_CLIENT_ENGINE_TYPE === 'client' &&
        !process.env.PRISMA_ACCELERATE_URL) {
        process.env.PRISMA_CLIENT_ENGINE_TYPE = DEFAULT_ENGINE_TYPE;
    }
};
exports.ensurePrismaEngineCompatibility = ensurePrismaEngineCompatibility;
exports.prismaLogOptions = [
    'error',
    'warn',
];
