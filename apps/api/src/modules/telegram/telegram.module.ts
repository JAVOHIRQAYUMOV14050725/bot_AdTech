import { PaymentsModule } from '@/modules/payments/payments.module';
import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AdminHandler } from './handlers/admin.handler';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
    imports: [PrismaModule, PaymentsModule],
    providers: [TelegramService, AdminHandler],
})
export class TelegramModule { }
