import 'dotenv/config';
import { loadEnv } from '../src/config/env';
import { createHash } from 'crypto';

const env = loadEnv();

const required = ['CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_USER_ID', 'CLICK_SECRET_KEY'] as const;
for (const key of required) {
    if (!(env as Record<string, unknown>)[key]) {
        throw new Error(`Missing required env key: ${key}`);
    }
}

async function main() {
    const amount = process.argv[2] ?? '10.00';
    const phone = process.argv[3];
    if (!phone) {
        throw new Error('Usage: npm run click:smoke -- <amount> <phone>');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const merchantTransId = `smoke-${Date.now()}`;
    const signString = `${env.CLICK_SERVICE_ID}${env.CLICK_MERCHANT_ID}${env.CLICK_USER_ID}${merchantTransId}${amount}${timestamp}${env.CLICK_SECRET_KEY}`;
    const sign = createHash('md5').update(signString).digest('hex');
    const returnUrl = `${(env.PUBLIC_BASE_URL ?? 'http://localhost:4002').replace(/\/+$/, '')}/api/payments/click/return`;

    const response = await fetch(`${(env.CLICK_API_BASE_URL ?? 'https://api.click.uz').replace(/\/+$/, '')}${env.CLICK_CREATE_INVOICE_PATH ?? '/v2/merchant/invoice/create'}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-click-sign': sign,
            'x-click-timestamp': timestamp,
        },
        body: JSON.stringify({
            service_id: env.CLICK_SERVICE_ID,
            merchant_id: env.CLICK_MERCHANT_ID,
            user_id: env.CLICK_USER_ID,
            amount,
            merchant_trans_id: merchantTransId,
            description: `click smoke ${merchantTransId}`,
            phone,
            return_url: returnUrl,
            currency: 'USD',
            timestamp,
            sign,
        }),
    });

    const text = await response.text();
    console.log(`[click-smoke] status=${response.status} body=${text}`);
}

main().catch((err) => {
    console.error('[click-smoke] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});