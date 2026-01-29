import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { OpsModule } from '@/modules/ops/ops.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { SchedulerQueuesModule } from '@/modules/scheduler/queues.module';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule,
        OpsModule,
        AuthModule,
        SchedulerQueuesModule,
    ],
    controllers: [SystemController],
    providers: [SystemService],
    exports: [SystemService], // ✅ MUHIM
})
export class SystemModule { }
