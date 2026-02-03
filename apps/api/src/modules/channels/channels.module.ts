import { Module, forwardRef } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { VerificationService } from './verification.service';
import { ChannelsAdminController } from './channels.admin.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { IdentityModule } from '@/modules/identity/identity.module';

@Module({
    imports: [PrismaModule, forwardRef(() => TelegramModule), AuditModule, AuthModule, IdentityModule],
    controllers: [ChannelsController, ChannelsAdminController],
    providers: [ChannelsService, VerificationService],
    exports: [ChannelsService],
})
export class ChannelsModule { }
