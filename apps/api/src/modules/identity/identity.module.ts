import { Module, forwardRef } from '@nestjs/common';
import { IdentityResolverService } from './identity-resolver.service';
import { TelegramModule } from '@/modules/telegram/telegram.module';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
    imports: [PrismaModule, forwardRef(() => TelegramModule)],
    providers: [IdentityResolverService],
    exports: [IdentityResolverService],
})
export class IdentityModule { }
