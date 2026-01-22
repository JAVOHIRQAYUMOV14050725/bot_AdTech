import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { OpsModule } from '@/modules/ops/ops.module';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule,
        OpsModule,
    ],
    controllers: [SystemController],
    providers: [SystemService],
    exports: [SystemService], // ✅ MUHIM
})
export class SystemModule { }
