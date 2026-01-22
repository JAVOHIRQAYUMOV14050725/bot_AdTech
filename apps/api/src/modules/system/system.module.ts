import { Module } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';

@Module({
    imports: [
        PrismaModule,
        PaymentsModule, // EscrowService shu yerdan keladi
    ],
    controllers: [SystemController],
    providers: [SystemService],
})
export class SystemModule { }
