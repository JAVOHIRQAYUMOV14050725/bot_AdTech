# Local Run Checklist

1. Install dependencies:
   - `npm install` inside `apps/api`
2. Configure environment variables (see `REQUIRED_ENV_VARS.md`).
3. Run Prisma migrations:
   - `npx prisma migrate deploy`
4. Start the API:
   - `npm run start:dev`
5. (Optional) Start Telegram bot:
   - Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` are set.
6. Run the integration script:
   - `bash apps/api/scripts/marketplace-integration.sh`
