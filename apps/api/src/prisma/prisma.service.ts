import { INestApplication, INestApplicationContext, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy {

    constructor() {
        const databaseUrl = process.env.DATABASE_URL ?? '';
        const url = new URL(databaseUrl);
        if (!url.searchParams.has('connection_limit')) {
            url.searchParams.set('connection_limit', '5');
        }
        if (!url.searchParams.has('pool_timeout')) {
            url.searchParams.set('pool_timeout', '10');
        }
        super({
            log: ['error', 'warn'],
            datasources: {
                db: {
                    url: url.toString(),
                },
            },
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    async enableShutdownHooks(app: INestApplication | INestApplicationContext) {
        this.$on('beforeExit', async () => {
            await app.close();
        });
    }
}