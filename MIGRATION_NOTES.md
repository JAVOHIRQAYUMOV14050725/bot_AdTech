# Migration Notes

## 2026-02-06: AdDeal deterministic handshake

### Database changes
- Added AdDeal status values: `publisher_requested`, `publisher_declined`, `advertiser_confirmed`.
- Added `publisherRequestedAt`, `publisherDeclinedAt`, and `advertiserConfirmedAt` columns to `ad_deals`.
- Backfilled `publisherRequestedAt` and `advertiserConfirmedAt` for existing records using existing timestamps.

### Application changes
- Deal lifecycle now enforces: fund → lock/request → publisher accept/decline → advertiser confirm → proof → settle.
- Publisher decline now refunds escrow immediately and records `publisher_declined`.

### Operational guidance
- Run Prisma migrations before deploying application changes.
- Verify any pending AdDeals in `accepted`, `proof_submitted`, or `settled` states have correct backfilled timestamps.
