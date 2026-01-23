# Fresh DB bootstrap (Windows)

## Prerequisites
- Node.js 22+
- PostgreSQL 15+ running locally
- Redis running locally

## One-time setup
```powershell
cd apps\api
copy .env.example .env
```

Update `.env` with your local credentials:
- `DATABASE_URL`
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`
- `JWT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `SUPER_ADMIN_TELEGRAM_ID` / `SUPER_ADMIN_PASSWORD` / `SUPER_ADMIN_USERNAME`

## Create DB + migrate + seed
```powershell
cd apps\api
npm install
npx prisma migrate dev
npx prisma db seed
```

## Run API
```powershell
npm run start:dev
```

## Worker mode (optional)
```powershell
$env:WORKER_MODE="true"
npm run start
```