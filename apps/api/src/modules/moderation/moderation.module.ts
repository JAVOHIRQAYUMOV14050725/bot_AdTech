import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { SchedulerModule } from '@/modules/scheduler/scheduler.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
    imports: [PrismaModule, PaymentsModule, SchedulerModule, AuditModule, AuthModule],
    controllers: [ModerationController],
    providers: [ModerationService],
})
export class ModerationModule { }