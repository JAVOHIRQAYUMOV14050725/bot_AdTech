import { Test } from '@nestjs/testing';
import { LoggerService } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import { KillSwitchService } from '@/modules/ops/kill-switch.service';
import { EscrowService } from '@/modules/payments/escrow.service';
import { ConfigService } from '@nestjs/config';

const mockLogger: LoggerService = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
};

export async function createPaymentsTestModule() {
    const moduleRef = await Test.createTestingModule({
        providers: [
            PrismaService,
            PaymentsService,
            KillSwitchService,
            EscrowService,
            ConfigService,
            { provide: 'LOGGER', useValue: mockLogger },
        ],
    }).compile();

    return {
        prisma: moduleRef.get(PrismaService),
        paymentsService: moduleRef.get(PaymentsService),
        escrowService: moduleRef.get(EscrowService),
        killSwitchService: moduleRef.get(KillSwitchService),
    };
}
