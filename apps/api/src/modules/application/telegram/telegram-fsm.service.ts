import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { TelegramState } from './telegram-fsm.types';

interface FSMContext {
    state: TelegramState;
    payload: Record<string, any>;
}
@Injectable()
export class TelegramFSMService {
    private readonly logger = new Logger(TelegramFSMService.name);

    constructor(private readonly prisma: PrismaService) { }

    async get(userId: number): Promise<FSMContext> {
        const telegramId = BigInt(userId);
        const session = await this.prisma.telegramSession.findUnique({
            where: { telegramId },
        });

        if (!session) {
            return { state: TelegramState.IDLE, payload: {} };
        }

        const knownStates = new Set(Object.values(TelegramState));
        const state = knownStates.has(session.state as TelegramState)
            ? (session.state as TelegramState)
            : TelegramState.IDLE;

        if (state !== session.state) {
            this.logger.warn({
                event: 'telegram_fsm_state_invalid',
                telegramId: session.telegramId.toString(),
                storedState: session.state,
            });
        }

        const payload = session.payload && typeof session.payload === 'object'
            ? (session.payload as Record<string, any>)
            : {};

        return { state, payload };
    }

    async set(
        userId: number,
        state: TelegramState,
        payload: Record<string, any> = {},
    ) {
        const telegramId = BigInt(userId);
        await this.prisma.telegramSession.upsert({
            where: { telegramId },
            update: {
                state,
                payload,
            },
            create: {
                telegramId,
                state,
                payload,
            },
        });
    }

    async transition(
        userId: number,
        state: TelegramState,
        payload?: Record<string, any>,
    ) {
        const ctx = await this.get(userId);
        await this.set(
            userId,
            state,
            payload ?? ctx.payload,
        );
    }

    async reset(userId: number) {
        const telegramId = BigInt(userId);
        await this.prisma.telegramSession.deleteMany({
            where: { telegramId },
        });
    }
}
