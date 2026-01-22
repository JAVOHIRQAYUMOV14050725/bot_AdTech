import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';


@Module({
    providers: [
        EscrowService,
        LedgerService,
        WalletService,
    ],
    exports: [
        EscrowService,
        LedgerService,
        WalletService,
    ],
})
export class PaymentsModule { }
