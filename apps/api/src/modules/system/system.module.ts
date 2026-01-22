import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule,
    ],
    controllers: [SystemController],
    providers: [SystemService],
    exports: [SystemService], // ✅ MUHIM
})
export class SystemModule { }
