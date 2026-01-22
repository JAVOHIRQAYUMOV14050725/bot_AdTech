import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';
import { SystemModule } from '@/modules/system/system.module'; // ✅
import { OpsModule } from '@/modules/ops/ops.module';
import { RedisModule } from '@/modules/redis/redis.module';
import { CronStatusService } from './cron-status.service';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule,
        TelegramModule,
        SystemModule, // ✅ MUHIM
        OpsModule,
        RedisModule,
    ],
    providers: [SchedulerService, CronStatusService],
    exports: [SchedulerService, CronStatusService],
})
export class SchedulerModule { }
