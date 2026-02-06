import { startTelegramProgress } from '@/modules/telegram/telegram-safe-text.util';

describe('startTelegramProgress', () => {
    it('sends progress immediately and edits to final text', async () => {
        const ctx = {
            sendChatAction: jest.fn().mockResolvedValue(undefined),
            reply: jest.fn().mockResolvedValue({ chat: { id: 123 }, message_id: 7 }),
            telegram: {
                editMessageText: jest.fn().mockResolvedValue(true),
            },
            from: { language_code: 'en' },
            chat: { id: 123 },
        };

        const progress = await startTelegramProgress(ctx as any, '⏳ Yuborilyapti...');
        await progress.finish('✅ Done');

        expect(ctx.sendChatAction).toHaveBeenCalledWith('typing');
        expect(ctx.reply).toHaveBeenCalledWith('⏳ Yuborilyapti...', undefined);
        expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(123, 7, undefined, '✅ Done', undefined);
    });
});