import { Test } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { ConfigService } from '@nestjs/config';
import { TestLogger } from './test-logger';

export async function createPaymentsTestModule() {
    const moduleRef = await Test.createTestingModule({
        providers: [
            PrismaService,
            KillSwitchService,
            PaymentsService,
            EscrowService,
            ConfigService,
            { provide: 'LOGGER', useValue: TestLogger },
        ],
    }).compile();

    return {
        prisma: moduleRef.get(PrismaService),
        escrowService: moduleRef.get(EscrowService),
        paymentsService: moduleRef.get(PaymentsService),
        killSwitchService: moduleRef.get(KillSwitchService),
    };
}
