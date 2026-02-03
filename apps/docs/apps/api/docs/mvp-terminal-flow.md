# MVP terminal flow (publisher → advertiser → post)

This document summarizes the API path for an end-to-end MVP run using the current NestJS API.

## Required high-level steps

1. Users must start the Telegram bot (`/start`) to create their accounts. This is the only supported user creation flow.
2. (Optional) Invite publisher accounts via `/api/auth/register` (admin-only) which creates a pending Telegram link.
3. Register a third account and promote to `super_admin` in SQL for admin actions.
3. Publisher creates a channel and requests verification (bot must be admin in the channel).
4. Admin approves the channel.
5. Advertiser creates a campaign, adds a creative, and adds a target.
6. Advertiser submits the target ( `/api/campaign-targets/:id/submit` ).
7. Admin approves the target ( `/api/admin/moderation/:targetId/approve` ) which creates a post job and holds escrow.
8. A worker picks up the post job and posts to Telegram.

## Notes

- `campaign_targets` are created in `pending` status. They must be submitted before they appear in moderation pending.
 
- Escrow holds require the advertiser wallet to have a positive balance.
- The post worker requires Redis and Telegram credentials.
