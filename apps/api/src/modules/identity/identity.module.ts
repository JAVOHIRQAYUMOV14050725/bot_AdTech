import { Module } from '@nestjs/common';
import { IdentityResolverService } from './identity-resolver.service';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [IdentityResolverService],
    exports: [IdentityResolverService],
})
export class IdentityModule { }
