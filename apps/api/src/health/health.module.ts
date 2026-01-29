import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { RedisModule } from '@/modules/redis/redis.module';
import { SchedulerModule } from '@/modules/scheduler/scheduler.module';
import { SchedulerQueuesModule } from '@/modules/scheduler/queues.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
    imports: [
        PrismaModule,
        RedisModule,
        SchedulerModule,
        SchedulerQueuesModule,
        TelegramModule,
        AuthModule,
    ],
    controllers: [HealthController],
    providers: [HealthService],
})
export class HealthModule { }
