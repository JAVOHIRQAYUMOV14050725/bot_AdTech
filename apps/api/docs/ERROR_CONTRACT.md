# Error Contract (Backend ↔ Telegram Bot)

## Backend Error Shape

All HTTP errors **must** use the same envelope:

```json
{
  "event": "error",
  "code": "SOME_CODE",
  "message": "Human readable",
  "correlationId": "uuid-v4",
  "details": {
    "optional": "safe metadata"
  }
}
```

**Notes**
- `code` is a stable, machine-readable string.
- `message` is safe for end users (no secrets).
- `correlationId` is required for support/traceability.
- `details` is optional and must not contain secrets.

## Standard Codes

Common codes returned by the backend:

- `VALIDATION_FAILED`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `RATE_LIMITED`
- `UNIQUE_CONSTRAINT`
- `RECORD_NOT_FOUND`
- `DATABASE_ERROR`
- `INTERNAL_SERVER_ERROR`
- `REQUEST_FAILED`

Telegram-specific codes:

- `INVITE_NOT_FOR_YOU`
- `USER_MUST_START_BOT_FIRST`
- `PUBLISHER_NOT_REGISTERED`
- `CHANNEL_NOT_APPROVED`
- `CHANNEL_NOT_OWNED_BY_PUBLISHER`
- `INVALID_TELEGRAM_INTERNAL_TOKEN`

## Telegram Bot Mapping Policy

The bot maps backend `code` values to Uzbek user messages:

- `INVITE_NOT_FOR_YOU` → “❌ Bu taklif sizga tegishli emas.”
- `USER_MUST_START_BOT_FIRST` → “❌ Avval botga /start bosing, so‘ng taklif yuboriladi.”
- `PUBLISHER_NOT_REGISTERED` → “❌ Publisher ro‘yxatdan o‘tmagan. Invite link orqali kiring.”
- `CHANNEL_NOT_APPROVED` → “⏳ Kanal hali marketplace’da tasdiqlanmagan. Admin ko‘rib chiqmoqda.”
- `CHANNEL_NOT_OWNED_BY_PUBLISHER` → “❌ Kanal egasi publisher akkaunt emas.”
- `INVALID_TELEGRAM_INTERNAL_TOKEN` / `UNAUTHORIZED` → “❌ Xavfsizlik tekshiruvi o‘tmadi.”
- `VALIDATION_FAILED` → “❌ Kiritilgan ma’lumot noto‘g‘ri.”
- `RATE_LIMITED` → “⏳ Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.”
- Default (unknown/unmapped) → “❌ Xatolik yuz berdi. (ID: <correlationId>)”

**Fail-closed behavior:** unknown/unmapped errors are always shown as the generic message with `correlationId`.
