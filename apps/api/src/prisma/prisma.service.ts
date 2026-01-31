import {
    INestApplication,
    INestApplicationContext,
    Injectable,
    LoggerService,
    OnModuleDestroy,
    OnModuleInit,
    Inject,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContext } from '@/common/context/request-context';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy {
    constructor(@Inject('LOGGER') private readonly logger: LoggerService) {
        const databaseUrl = process.env.DATABASE_URL ?? '';
        const url = new URL(databaseUrl);

        // ✅ Connection budgeting defaults (per-process)
        if (!url.searchParams.has('connection_limit')) {
            url.searchParams.set('connection_limit', '5');
        }
        if (!url.searchParams.has('pool_timeout')) {
            url.searchParams.set('pool_timeout', '10');
        }

        super({
            // ✅ Keep Prisma logs minimal; do not rely on Prisma `$on('error')`
            // because in many Prisma versions/types, `$on` only exposes `beforeExit`.
            log: ['warn', 'error'],
            datasources: {
                db: { url: url.toString() },
            },
        });
    }

    async onModuleInit() {
        try {
            await this.$connect();
        } catch (err) {
            // ✅ Production-grade: classify startup DB connection failures
            const message = err instanceof Error ? err.message : String(err);
            const correlationId = RequestContext.getCorrelationId() ?? undefined;

            if (/too many clients/i.test(message)) {
                this.logger.error(
                    {
                        event: 'too_many_clients',
                        alert: true,
                        correlationId,
                        data: { message },
                    } as any,
                    err instanceof Error ? err.stack : undefined,
                    'PrismaService',
                );
            } else if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
                this.logger.error(
                    {
                        event: 'pg_timeout',
                        alert: true,
                        correlationId,
                        data: { message },
                    } as any,
                    err instanceof Error ? err.stack : undefined,
                    'PrismaService',
                );
            } else {
                this.logger.error(
                    {
                        event: 'prisma_connect_failed',
                        alert: true,
                        correlationId,
                        data: { message },
                    } as any,
                    err instanceof Error ? err.stack : undefined,
                    'PrismaService',
                );
            }

            throw err;
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    async enableShutdownHooks(app: INestApplication | INestApplicationContext) {
        // ✅ Supported + type-safe
        this.$on('beforeExit', async () => {
            await app.close();
        });
    }
}
