import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';
import { SystemModule } from '@/modules/system/system.module'; // ✅
import { OpsModule } from '@/modules/ops/ops.module';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule,
        TelegramModule,
        SystemModule, // ✅ MUHIM
        OpsModule,
    ],
    providers: [SchedulerService],
    exports: [SchedulerService],
})
export class SchedulerModule { }
