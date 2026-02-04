import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { Request } from 'express';
import * as bodyParser from 'body-parser';

import { startPostWorker } from '@/modules/scheduler/workers/post.worker';
import { PrismaService } from '@/prisma/prisma.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { TelegramService } from '@/modules/telegram/telegram.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { RedisService } from '@/modules/redis/redis.service';

import { JsonSanitizeInterceptor } from '@/common/interceptors/json-sanitize.interceptor';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { correlationIdMiddleware } from '@/common/middleware/correlation-id.middleware';
import {
    StructuredLogger,
    buildStructuredLogger,
} from '@/common/logging/structured-logger.service';
import { formatValidationErrors } from './common/validation/validation-errors';
import { setupSwagger } from './swagger';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { loadEnv } from '@/config/env';
import { ConfigService } from '@nestjs/config';
import { workerConfig } from '@/config/worker.config';

const registerProcessHandlers = () => {
    process.on('unhandledRejection', (reason) => {
        console.error('[process] unhandled rejection', reason);
        process.exitCode = 1;
    });

    process.on('uncaughtException', (error) => {
        console.error('[process] uncaught exception', error);
        process.exit(1);
    });
};

async function startWorker(app: any, logger: StructuredLogger) {
    const prisma = app.get(PrismaService);
    const escrowService = app.get(EscrowService);
    const telegramService = app.get(TelegramService);
    const killSwitchService = app.get(KillSwitchService);
    const redisService = app.get(RedisService);
    const configService = app.get(ConfigService);
    const workerSettings = configService.get(workerConfig.KEY, { infer: true });

    if (!workerSettings) {
        throw new Error('Worker config missing');
    }

    logger.log(
        {
            event: 'worker_started',
            entityType: 'worker',
            entityId: 'post_worker',
            data: {
                workerMode: true,
                pid: process.pid,
                nodeEnv: loadEnv().NODE_ENV ?? null,
            },
        },
        'Bootstrap',
    );

    startPostWorker(
        prisma,
        escrowService,
        telegramService,
        killSwitchService,
        redisService,
        logger,
        workerSettings,
    );
}

async function bootstrap() {
    registerProcessHandlers();

    // 🔥 PROOF: .env now loaded BEFORE loadEnv()
    // console.log('[debug] PORT=', process.env.PORT, 'DATABASE_URL=', !!process.env.DATABASE_URL);

    const env = loadEnv();
    const logger = buildStructuredLogger();
    const isProd = env.NODE_ENV === 'production';

    const workerMode = env.WORKER_MODE;

    if (workerMode) {
        const app = await NestFactory.createApplicationContext(AppModule, {
            abortOnError: false,            // ✅ IMPORTANT
            logger: isProd ? false : logger,
            bufferLogs: true,
        });

        app.useLogger(logger);
        const prisma = app.get(PrismaService);
        await prisma.enableShutdownHooks(app);


        await startWorker(app, logger);
        return;
    }

    const app = await NestFactory.create(AppModule, {
        abortOnError: false,             // ✅ IMPORTANT
        logger: isProd ? false : logger,
        bufferLogs: true,
    });

    app.useLogger(logger);
    const prisma = app.get(PrismaService);
    await prisma.enableShutdownHooks(app);

    app.use(helmet());
    app.use(compression());
    app.use(correlationIdMiddleware);
    app.use(
        bodyParser.json({
            verify: (req, _res, buf) => {
                (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
            },
        }),
    );

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            exceptionFactory: (errors) =>
                new BadRequestException({
                    event: 'validation_failed',
                    message: 'Validation failed',
                    details: formatValidationErrors(errors),
                }),
        }),
    );



    app.setGlobalPrefix('api');

    setupSwagger(app);

    const port = env.PORT;
    await app.listen(port);

    logger.log(
        {
            event: 'api_started',
            data: { port, swagger: true, prefix: 'api' },
        },
        'Bootstrap',
    );

    if (env.WORKER_AUTOSTART) {
        setImmediate(async () => {
            logger.warn(
                { event: 'worker_autostart_enabled', data: { WORKER_AUTOSTART: true } },
                'Bootstrap',
            );
            await startWorker(app, logger);
        });
    }
}

bootstrap().catch((error) => {
    console.error('[bootstrap] failed to start application', error);
    process.exit(1);
});