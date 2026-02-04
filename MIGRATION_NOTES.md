# Migration Notes

## Telegram identity protocol rewrite

**Breaking changes**
- Invite tokens are now derived deterministically and stored only as hashes. Existing unused invite tokens issued before this change will no longer validate. Reissue publisher invites after deploy.  
- `/api/auth/telegram/start` now requires bot-signed headers (`X-Telegram-Internal-Token`, `X-Telegram-Timestamp`, `X-Telegram-Signature`). Swagger/manual calls will be rejected (401).  

**Operational reminders**
- Ensure `TELEGRAM_INTERNAL_TOKEN` and `TELEGRAM_BOT_TOKEN` are distinct.  
- Ensure `TELEGRAM_BOT_USERNAME` is set to the real bot username (not `CHANGE_ME_BOT`).  
