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

        this.$on('error', (event) => {
            const message = event.message ?? '';
            const correlationId = RequestContext.getCorrelationId();
            if (/too many clients/i.test(message)) {
                this.logger.error(
                    {
                        event: 'too_many_clients',
                        alert: true,
                        correlationId: correlationId ?? undefined,
                        data: { message },
                    },
                    undefined,
                    'PrismaService',
                );
                return;
            }

            if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
                this.logger.error(
                    {
                        event: 'pg_timeout',
                        alert: true,
                        correlationId: correlationId ?? undefined,
                        data: { message },
                    },
                    undefined,
                    'PrismaService',
                );
            }
        });
    }

    async onModuleInit() {
        try {
            await this.$connect();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const correlationId = RequestContext.getCorrelationId();
            if (/too many clients/i.test(message)) {
                this.logger.error(
                    {
                        event: 'too_many_clients',
                        alert: true,
                        correlationId: correlationId ?? undefined,
                        data: { message },
                    },
                    err instanceof Error ? err.stack : undefined,
                    'PrismaService',
                );
            } else if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
                this.logger.error(
                    {
                        event: 'pg_timeout',
                        alert: true,
                        correlationId: correlationId ?? undefined,
                        data: { message },
                    },
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
        this.$on('beforeExit', async () => {
            await app.close();
        });
    }
}
