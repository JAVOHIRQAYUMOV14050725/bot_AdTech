# Marketplace Identity Policy

## Canonical Identity Boundary
- **`users` is the canonical identity table.** Each row represents a single identity; `telegramId` is unique when present and stored as a string in API DTOs but persisted as `BigInt`.  
- **Primary role vs. capability grants:** `users.role` is the primary role for legacy compatibility, while **capabilities** (advertiser/publisher/super_admin) are enforced via `user_role_grants`.  
- **Multi-profile policy:** A single identity can hold **multiple capabilities** (e.g., advertiser + publisher) through `user_role_grants`. All authorization checks must consult the grants set, not only `users.role`.

## Enforced Rules
- **Role drift prevention:** All “ensure” and authorization flows verify `user_role_grants` (plus `users.role`) to determine capability access.  
- **Telegram identity binding:** `telegramId` may only be linked from Telegram updates (`ctx.from.id`), never from user input.  
- **Account-bound invites:** Publisher invites are bound to a Telegram account discovered in `telegram_sessions` and must be redeemed by the same `telegramId`.

## Operational Guarantees
- **Bootstrap:** exactly one `super_admin` is created via `bootstrap_state` and linked to Telegram with the `BOOTSTRAP` payload.  
- **Auditability:** security-relevant events (invites, bindings, role grants) are written to append-only audit logs.
