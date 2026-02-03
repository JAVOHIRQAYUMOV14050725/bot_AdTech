import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { AuthModule } from '../auth/auth.module';
import { PaymentsCoreModule } from './payments-core.module';


@Module({
    imports: [PaymentsCoreModule, AuthModule],
    controllers: [PaymentsController],
    exports: [PaymentsCoreModule],
})
export class PaymentsModule { }