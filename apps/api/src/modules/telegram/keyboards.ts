// src/telegram/keyboards.ts
import { Markup } from 'telegraf';

export const roleKeyboard = Markup.inlineKeyboard([
    Markup.button.callback('🧑‍💼 Advertiser', 'ROLE_ADVERTISER'),
    Markup.button.callback('📣 Publisher', 'ROLE_PUBLISHER'),
]);

export const advertiserHome = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Balance', 'ADV_BALANCE')],
    [Markup.button.callback('📢 Browse channels', 'ADV_BROWSE_CHANNELS')],
    [Markup.button.callback('📝 Create deal', 'CREATE_ADDEAL')],
    [Markup.button.callback('📄 My deals', 'ADV_MY_DEALS')],
    [Markup.button.callback('⚖️ Disputes', 'ADV_DISPUTES')],
    [Markup.button.callback('➕ Create campaign', 'CREATE_CAMPAIGN')],
    [Markup.button.callback('📊 My campaigns', 'MY_CAMPAIGNS')],
    [Markup.button.callback('💰 Add balance', 'ADD_BALANCE')],
]);

export const backToAdvertiserMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back to menu', 'ROLE_ADVERTISER')],
]);

export const insufficientBalanceKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Add balance', 'ADD_BALANCE')],
    [Markup.button.callback('❌ Cancel', 'CANCEL_FLOW')],
    [Markup.button.callback('⬅️ Back to menu', 'ROLE_ADVERTISER')],
]);

export const confirmKeyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Confirm', 'CONFIRM'),
    Markup.button.callback('❌ Cancel', 'CANCEL'),
]);

export const cancelFlowKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ Cancel', 'CANCEL_FLOW')],
]);

export const publisherHome = Markup.inlineKeyboard([
    [Markup.button.callback('📣 My channels', 'PUB_MY_CHANNELS')],
    [Markup.button.callback('📩 Incoming deals', 'PUB_INCOMING_DEALS')],
    [Markup.button.callback('📤 Mark as posted', 'PUB_MARK_POSTED')],
    [Markup.button.callback('💸 Earnings summary', 'PUB_EARNINGS')],
    [Markup.button.callback('➕ Add channel', 'PUB_ADD_CHANNEL')],
]);

export const addChannelOptions = Markup.inlineKeyboard([
    [Markup.button.callback('🔓 Public channel (@username)', 'PUB_ADD_CHANNEL_PUBLIC')],
    [Markup.button.callback('🔒 My channel has no username', 'PUB_ADD_CHANNEL_PRIVATE')],
    [Markup.button.callback('❌ Cancel', 'CANCEL_FLOW')],
]);

export const verifyPrivateChannelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Verify Channel', 'PUB_VERIFY_PRIVATE_CHANNEL')],
    [Markup.button.callback('⬅️ Back', 'PUB_ADD_CHANNEL')],
    [Markup.button.callback('❌ Cancel', 'CANCEL_FLOW')],
]);
