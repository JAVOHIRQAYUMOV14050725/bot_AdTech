import { Module } from '@nestjs/common';
import { KillSwitchService } from './kill-switch.service';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [KillSwitchService],
    exports: [KillSwitchService],
})
export class OpsModule { }