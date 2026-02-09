import { Module } from '@nestjs/common';
import { DealsService } from './deals.service';
import { AdDealModule } from '@/modules/application/addeal/addeal.module';

@Module({
    imports: [AdDealModule],
    providers: [DealsService],
    exports: [DealsService],
})
export class MarketplaceModule { }