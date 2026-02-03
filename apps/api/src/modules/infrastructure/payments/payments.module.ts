import { Module } from '@nestjs/common';
import { ClickPaymentService } from './click-payment.service';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [ConfigModule],
    providers: [ClickPaymentService],
    exports: [ClickPaymentService],
})
export class InfrastructurePaymentsModule { }
