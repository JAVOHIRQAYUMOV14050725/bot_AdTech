import { Module } from '@nestjs/common';

import { PrismaModule } from '@/prisma/prisma.module';
import { PaymentsModule } from '@/modules/payments/payments.module';

import { CreateAdDealUseCase } from './create-addeal.usecase';
import { FundAdDealUseCase } from './fund-addeal.usecase';
import { LockEscrowUseCase } from './lock-escrow.usecase';
import { AcceptDealUseCase } from './accept-deal.usecase';
import { SubmitProofUseCase } from './submit-proof.usecase';
import { SettleAdDealUseCase } from './settle-addeal.usecase';
import { RefundAdDealUseCase } from './refund-addeal.usecase';
import { OpenDisputeUseCase } from './open-dispute.usecase';
import { ResolveDisputeUseCase } from './resolve-dispute.usecase';

@Module({
    imports: [PrismaModule, PaymentsModule],
    providers: [
        CreateAdDealUseCase,
        FundAdDealUseCase,
        LockEscrowUseCase,
        AcceptDealUseCase,
        SubmitProofUseCase,
        SettleAdDealUseCase,
        RefundAdDealUseCase,
        OpenDisputeUseCase,
        ResolveDisputeUseCase,
    ],
    exports: [
        CreateAdDealUseCase,
        FundAdDealUseCase,
        LockEscrowUseCase,
        AcceptDealUseCase,
        SubmitProofUseCase,
        SettleAdDealUseCase,
        RefundAdDealUseCase,
        OpenDisputeUseCase,
        ResolveDisputeUseCase,
    ],
})
export class AdDealModule {}
