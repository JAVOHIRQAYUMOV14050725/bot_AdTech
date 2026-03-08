## Click invoice local runbook

1. Copy one of environment presets from `apps/api/env/` to `apps/api/.env`.
2. For Click-enabled local testing, start a public tunnel and set `PUBLIC_BASE_URL` to HTTPS tunnel URL.
3. Start API:
   ```bash
   npm run start:dev
   ```
4. Create smoke invoice request:
   ```bash
   npm run click:smoke -- 10.00 998901112233
   ```
5. Expect response body with `invoice_id` and `payment_url`; if `error_code=-406` appears, verify `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_USER_ID`, `CLICK_SECRET_KEY` and merchant contract/IP binding.