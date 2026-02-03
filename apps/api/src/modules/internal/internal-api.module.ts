import { Module } from '@nestjs/common';
import { InternalAdDealController } from './internal-addeal.controller';
import { InternalPaymentsController } from './internal-payments.controller';
import { AdDealModule } from '@/modules/application/addeal/addeal.module';
import { PaymentsModule } from '@/modules/payments/payments.module';

@Module({
    imports: [AdDealModule, PaymentsModule],
    controllers: [InternalAdDealController, InternalPaymentsController],
})
export class InternalApiModule { }