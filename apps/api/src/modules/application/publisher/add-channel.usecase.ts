export type AddChannelResult =
    | { ok: true; channelId: string }
    | { ok: false; reason: 'BOT_NOT_ADMIN' | 'ALREADY_EXISTS' };
