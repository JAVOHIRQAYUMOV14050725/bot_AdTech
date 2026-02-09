import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateAdDealUseCase } from '@/modules/application/addeal/create-addeal.usecase';
import { FundAdDealUseCase } from '@/modules/application/addeal/fund-addeal.usecase';
import { LockEscrowUseCase } from '@/modules/application/addeal/lock-escrow.usecase';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { PublisherDeclineUseCase } from '@/modules/application/addeal/publisher-decline.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { SettleAdDealUseCase } from '@/modules/application/addeal/settle-addeal.usecase';
import { OpenDisputeUseCase } from '@/modules/application/addeal/open-dispute.usecase';
import { ResolveDisputeUseCase } from '@/modules/application/addeal/resolve-dispute.usecase';
import { TransitionActor } from '@/modules/domain/contracts';

@Injectable()
export class DealsService {
    private readonly logger = new Logger(DealsService.name);

    constructor(
        private readonly createAdDeal: CreateAdDealUseCase,
        private readonly fundAdDeal: FundAdDealUseCase,
        private readonly lockEscrow: LockEscrowUseCase,
        private readonly acceptDealUseCase: AcceptDealUseCase,
        private readonly declineDealUseCase: PublisherDeclineUseCase,
        private readonly submitProofUseCase: SubmitProofUseCase,
        private readonly settleDealUseCase: SettleAdDealUseCase,
        private readonly openDisputeUseCase: OpenDisputeUseCase,
        private readonly resolveDisputeUseCase: ResolveDisputeUseCase,
    ) { }

    async createDeal(params: {
        advertiserId: string;
        publisherId: string;
        channelId?: string | null;
        amount: Prisma.Decimal | string;
        idempotencyKey: string;
        correlationId: string;
    }) {
        this.logger.log(
            {
                event: 'marketplace_deal_create_requested',
                advertiserId: params.advertiserId,
                publisherId: params.publisherId,
                channelId: params.channelId ?? null,
                amount: new Prisma.Decimal(params.amount).toFixed(2),
                correlationId: params.correlationId,
            },
            'DealsService',
        );

        const adDeal = await this.createAdDeal.execute({
            advertiserId: params.advertiserId,
            publisherId: params.publisherId,
            channelId: params.channelId ?? null,
            amount: params.amount,
            idempotencyKey: params.idempotencyKey,
            correlationId: params.correlationId,
        });

        await this.fundAdDeal.execute({
            adDealId: adDeal.id,
            provider: 'wallet_balance',
            providerReference: `marketplace:${adDeal.id}`,
            amount: params.amount,
            verified: true,
            actor: TransitionActor.advertiser,
        });

        await this.lockEscrow.execute({
            adDealId: adDeal.id,
            actor: TransitionActor.system,
        });

        this.logger.log(
            {
                event: 'marketplace_deal_created',
                adDealId: adDeal.id,
                correlationId: params.correlationId,
            },
            'DealsService',
        );

        return adDeal;
    }

    acceptDeal(params: { dealId: string; publisherId: string }) {
        return this.acceptDealUseCase.execute({
            adDealId: params.dealId,
            actor: TransitionActor.publisher,
        });
    }

    rejectDeal(params: { dealId: string; publisherId: string; reason?: string }) {
        return this.declineDealUseCase.execute({
            adDealId: params.dealId,
            actor: TransitionActor.publisher,
            reason: params.reason,
        });
    }

    markPosted(params: { dealId: string; publisherId: string; proof?: string }) {
        return this.submitProofUseCase.execute({
            adDealId: params.dealId,
            proofPayload: { text: params.proof ?? null },
            actor: TransitionActor.publisher,
        });
    }

    completeDeal(params: { dealId: string; advertiserId: string }) {
        return this.settleDealUseCase.execute({
            adDealId: params.dealId,
            actor: TransitionActor.advertiser,
        });
    }

    openDispute(params: { dealId: string; actor: TransitionActor; reason: string }) {
        return this.openDisputeUseCase.execute({
            adDealId: params.dealId,
            reason: params.reason,
            actor: params.actor,
        });
    }

    adminResolveDispute(params: {
        dealId: string;
        decision: 'refund' | 'release';
        adminId: string;
        reason?: string;
    }) {
        return this.resolveDisputeUseCase.execute({
            adDealId: params.dealId,
            decision: params.decision,
            adminId: params.adminId,
            reason: params.reason,
        });
    }
}