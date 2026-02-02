// src/telegram/keyboards.ts
import { Markup } from 'telegraf';

export const roleKeyboard = Markup.inlineKeyboard([
    Markup.button.callback('🧑‍💼 Advertiser', 'ROLE_ADVERTISER'),
    Markup.button.callback('📣 Publisher', 'ROLE_PUBLISHER'),
]);

export const advertiserHome = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Create campaign', 'CREATE_CAMPAIGN')],
    [Markup.button.callback('💰 Add balance', 'ADD_BALANCE')],
    [Markup.button.callback('📊 My campaigns', 'MY_CAMPAIGNS')],
]);

export const confirmKeyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Confirm', 'CONFIRM'),
    Markup.button.callback('❌ Cancel', 'CANCEL'),
]);

export const publisherHome = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add channel', 'PUB_ADD_CHANNEL')],
    [Markup.button.callback('📊 My channels', 'PUB_MY_CHANNELS')],
]);
