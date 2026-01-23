import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';
import { PaymentsService } from './payments.service';
import { OpsModule } from '@/modules/ops/ops.module';
import { PaymentsController } from './payments.controller';


@Module({
    imports: [OpsModule],
    controllers: [PaymentsController],
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
export class PaymentsModule { }
