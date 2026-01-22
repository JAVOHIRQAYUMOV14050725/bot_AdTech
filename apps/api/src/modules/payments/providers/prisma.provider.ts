import { PrismaClient } from '@prisma/client';

import {
    ensurePrismaEngineCompatibility,
    prismaLogOptions,
} from '@/prisma/prisma-client';


ensurePrismaEngineCompatibility();

export const prisma = new PrismaClient({

    log: prismaLogOptions,
});