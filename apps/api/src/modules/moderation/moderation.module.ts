import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { OutboxModule } from '@/modules/outbox/outbox.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
    imports: [PrismaModule, PaymentsModule, OutboxModule, AuditModule, AuthModule],
    controllers: [ModerationController],
    providers: [ModerationService],
})
export class ModerationModule { }