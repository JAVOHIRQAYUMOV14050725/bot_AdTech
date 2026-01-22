import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
    imports: [PrismaModule, AuditModule, AuthModule],
    controllers: [CampaignsController],
    providers: [CampaignsService],
    exports: [CampaignsService],
})
export class CampaignsModule { }