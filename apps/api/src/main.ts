import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
    BadRequestException,
    ValidationPipe,
} from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';

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
import { HttpLoggingInterceptor } from '@/common/interceptors/http-logging.interceptor';

async function startWorker(app: any, logger: StructuredLogger) {
    const prisma = app.get(PrismaService);
    const escrowService = app.get(EscrowService);
    const telegramService = app.get(TelegramService);
    const killSwitchService = app.get(KillSwitchService);
    const redisService = app.get(RedisService);

    // ✅ Worker started event (structured)
    logger.log(
        {
            event: 'worker_started',
            entityType: 'worker',
            entityId: 'post_worker',
            data: {
                workerMode: true,
                pid: process.pid,
                nodeEnv: process.env.NODE_ENV,
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
    );
}

async function bootstrap() {
    const logger = buildStructuredLogger();
    const isProd = process.env.NODE_ENV === 'production';

    const workerMode = process.env.WORKER_MODE === 'true';

    if (workerMode) {
        // ✅ bufferLogs: true => Nest init logs are captured
        const app = await NestFactory.createApplicationContext(AppModule, {
            logger: isProd ? false : logger,
            bufferLogs: true,
        });

        // ✅ App-level logger as well (deterministic)
        app.useLogger(logger);

        await startWorker(app, logger);
        return;
    }

    // ✅ bufferLogs: true for API mode too
    const app = await NestFactory.create(AppModule, {
        logger: isProd ? false : logger,
        bufferLogs: true,
    });

    // ✅ deterministic logger
    app.useLogger(logger);

    app.use(helmet());
    app.use(compression());

    // ✅ correlationId for every request
    app.use(correlationIdMiddleware);

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

    app.useGlobalInterceptors(
        new HttpLoggingInterceptor(logger),
        new JsonSanitizeInterceptor(),
    );
    app.useGlobalFilters(new AllExceptionsFilter(logger));

    app.setGlobalPrefix('api');

    setupSwagger(app);

    const port = Number(process.env.PORT ?? 4002);
    await app.listen(port);

    // ✅ API started event (structured)
    logger.log(
        {
            event: 'api_started',
            data: {
                port,
                swagger: true,
                prefix: 'api',
            },
        },
        'Bootstrap',
    );

    // Optional: worker autostart inside API process (OK for dev, risky for prod)
    if (process.env.WORKER_AUTOSTART === 'true') {
        setImmediate(async () => {
            logger.warn(
                {
                    event: 'worker_autostart_enabled',
                    data: { WORKER_AUTOSTART: true },
                },
                'Bootstrap',
            );

            await startWorker(app, logger);
        });
    }
}

bootstrap();
