import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';

@Module({
    imports: [
        PrismaModule,      
        PaymentsModule,   
        TelegramModule,    
    ],
    providers: [SchedulerService],
    exports: [SchedulerService],
})
export class SchedulerModule { }
