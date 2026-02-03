import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';
import { PaymentsService } from './payments.service';
import { OpsModule } from '@/modules/ops/ops.module';
import { InfrastructurePaymentsModule } from '@/modules/infrastructure/payments/payments.module';

@Module({
    imports: [OpsModule, InfrastructurePaymentsModule],
    providers: [
        EscrowService,
        LedgerService,
        WalletService,
        PaymentsService,
    ],
    exports: [
        EscrowService,
        LedgerService,
        WalletService,
        PaymentsService,
    ],
})
export class PaymentsCoreModule { }