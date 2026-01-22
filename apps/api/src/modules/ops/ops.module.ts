import { Module } from '@nestjs/common';
import { KillSwitchService } from './kill-switch.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { KillSwitchSeeder } from './kill-switch.seeder';

@Module({
    imports: [PrismaModule],
    providers: [KillSwitchService, KillSwitchSeeder],
    exports: [KillSwitchService],
})
export class OpsModule { }