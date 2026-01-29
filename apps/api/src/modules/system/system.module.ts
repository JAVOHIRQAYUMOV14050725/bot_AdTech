import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { OpsModule } from '@/modules/ops/ops.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule,
        OpsModule,
        AuthModule,
    ],
    controllers: [SystemController],
    providers: [SystemService, RateLimitGuard],
    exports: [SystemService], // ✅ MUHIM
})
export class SystemModule { }
