import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalTokenGuard } from '@/common/guards/internal-token.guard';
import { FundAdDealUseCase } from '@/modules/application/addeal/fund-addeal.usecase';
import { LockEscrowUseCase } from '@/modules/application/addeal/lock-escrow.usecase';
import { AcceptDealUseCase } from '@/modules/application/addeal/accept-deal.usecase';
import { AdvertiserConfirmUseCase } from '@/modules/application/addeal/advertiser-confirm.usecase';
import { PublisherDeclineUseCase } from '@/modules/application/addeal/publisher-decline.usecase';
import { SubmitProofUseCase } from '@/modules/application/addeal/submit-proof.usecase';
import { SettleAdDealUseCase } from '@/modules/application/addeal/settle-addeal.usecase';
import { CreateAdDealDto } from './dto/create-addeal.dto';
import { FundAdDealDto } from './dto/fund-addeal.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { TransitionActor } from '@/modules/domain/contracts';
import { DealsService } from '@/modules/marketplace/deals.service';

@ApiTags('Internal')
@UseGuards(InternalTokenGuard)
@Controller('internal/addeals')
export class InternalAdDealController {
    constructor(
        private readonly dealsService: DealsService,
        private readonly fundAdDeal: FundAdDealUseCase,
        private readonly lockEscrow: LockEscrowUseCase,
        private readonly acceptDeal: AcceptDealUseCase,
        private readonly advertiserConfirm: AdvertiserConfirmUseCase,
        private readonly publisherDecline: PublisherDeclineUseCase,
        private readonly submitProof: SubmitProofUseCase,
        private readonly settleAdDeal: SettleAdDealUseCase,
    ) { }

    @Post()
    create(@Body() dto: CreateAdDealDto) {
        return this.dealsService.createDeal({
            advertiserId: dto.advertiserId,
            publisherId: dto.publisherId,
            channelId: dto.channelId ?? null,
            amount: dto.amount,
            idempotencyKey: dto.idempotencyKey,
            correlationId: dto.correlationId,
        });
    }

    @Post(':id/fund')
    fund(@Param('id') id: string, @Body() dto: FundAdDealDto) {
        return this.fundAdDeal.execute({
            adDealId: id,
            provider: dto.provider,
            providerReference: dto.providerReference,
            amount: dto.amount,
            verified: true,
            actor: TransitionActor.system,
        });
    }

    @Post(':id/lock')
    lock(@Param('id') id: string) {
        return this.lockEscrow.execute({
            adDealId: id,
            actor: TransitionActor.system,
        });
    }

    @Post(':id/accept')
    accept(@Param('id') id: string) {
        return this.acceptDeal.execute({
            adDealId: id,
            actor: TransitionActor.publisher,
        });
    }

    @Post(':id/decline')
    decline(@Param('id') id: string) {
        return this.publisherDecline.execute({
            adDealId: id,
            actor: TransitionActor.publisher,
        });
    }

    @Post(':id/confirm')
    confirm(@Param('id') id: string) {
        return this.advertiserConfirm.execute({
            adDealId: id,
            actor: TransitionActor.advertiser,
        });
    }

    @Post(':id/proof')
    submit(@Param('id') id: string, @Body() dto: SubmitProofDto) {
        return this.submitProof.execute({
            adDealId: id,
            proofPayload: {
                text: dto.proofText,
            },
            actor: TransitionActor.publisher,
        });
    }

    @Post(':id/settle')
    settle(@Param('id') id: string) {
        return this.settleAdDeal.execute({
            adDealId: id,
            actor: TransitionActor.admin,
        });
    }
}