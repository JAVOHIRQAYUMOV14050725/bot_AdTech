import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
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

console.log('Starting API...');
async function bootstrap() {
    const workerMode = process.env.WORKER_MODE === 'true';

    if (workerMode) {
        const app = await NestFactory.createApplicationContext(AppModule);
        const prisma = app.get(PrismaService);
        const escrowService = app.get(EscrowService);
        const telegramService = app.get(TelegramService);
        const killSwitchService = app.get(KillSwitchService);
        const redisService = app.get(RedisService);

        startPostWorker(
            prisma,
            escrowService,
            telegramService,
            killSwitchService,
            redisService,
        );

        console.log('🧵 Worker started (WORKER_MODE=true)');
        return;
    }

    const app = await NestFactory.create(AppModule);

    app.use(helmet());
    app.use(compression());
    app.use(correlationIdMiddleware);

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );
    app.useGlobalInterceptors(new JsonSanitizeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());

    app.setGlobalPrefix('api');

    const port = process.env.PORT || 3000;
    await app.listen(port);

    console.log(`🚀 API running on http://localhost:${port}`);

    if (process.env.WORKER_AUTOSTART === 'true') {
        setImmediate(() => {
            const prisma = app.get(PrismaService);
            const escrowService = app.get(EscrowService);
            const telegramService = app.get(TelegramService);
            const killSwitchService = app.get(KillSwitchService);
            const redisService = app.get(RedisService);

            startPostWorker(
                prisma,
                escrowService,
                telegramService,
                killSwitchService,
                redisService,
            );
            console.log('🧵 Worker autostarted (WORKER_AUTOSTART=true)');
        });
    }
}
bootstrap();