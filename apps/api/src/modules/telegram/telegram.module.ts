import { PaymentsModule } from '@/modules/payments/payments.module';
import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AdminHandler } from './handlers/admin.handler';
import { PrismaModule } from '@/prisma/prisma.module';
import { OpsModule } from '@/modules/ops/ops.module';

@Module({
    imports: [PrismaModule, PaymentsModule, OpsModule],
    providers: [TelegramService, AdminHandler],
})
export class TelegramModule { }
