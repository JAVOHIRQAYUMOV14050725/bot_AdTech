import { ensurePrismaEngineCompatibility, prismaLogOptions } from './../../prisma/prisma-client';
import { PrismaClient } from '@prisma/client';


import { Injectable, OnModuleInit } from '@nestjs/common';


@Injectable()

export class PrismaService extends PrismaClient implements OnModuleInit {

    constructor() {
        ensurePrismaEngineCompatibility();
        super({
            log: prismaLogOptions,
        });
    }

    async onModuleInit() {

        await this.$connect();

    }
}