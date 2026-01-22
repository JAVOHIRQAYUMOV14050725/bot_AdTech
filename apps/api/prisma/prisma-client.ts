import { Prisma } from '@prisma/client';


const DEFAULT_ENGINE_TYPE = 'binary';


export const ensurePrismaEngineCompatibility = (): void => {

    if (
        process.env.PRISMA_CLIENT_ENGINE_TYPE === 'client' &&
        !process.env.PRISMA_ACCELERATE_URL
    ) {
        process.env.PRISMA_CLIENT_ENGINE_TYPE = DEFAULT_ENGINE_TYPE;
    }
};

export const prismaLogOptions: Prisma.PrismaClientOptions['log'] = [

    'error',
    'warn',
];