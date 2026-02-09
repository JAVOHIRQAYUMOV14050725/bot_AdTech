# Marketplace Flow

## Core Deal Lifecycle
1. **Advertiser selects a channel** from the approved marketplace list.
2. **Deal is created** with an idempotency key and correlation ID.
3. **Funds are locked in escrow** immediately after creation (wallet balance debit + escrow record).
4. **Publisher receives a Telegram notification** and can accept/reject.
5. **Publisher posts the ad** and submits proof.
6. **Advertiser confirms** (if applicable) and the platform settles the deal.
7. **Settlement splits funds** into publisher payout + platform commission.
8. **Disputes can be opened** by either party and resolved by admin (refund/release).

## Ledger & Escrow Invariants
- Every money movement is provider-verified, idempotent, and recorded in the ledger.
- Escrow remains locked until settlement or refund.

## Click Deposit UX (Telegram)
- If a payment URL is present, the bot displays it.
- If missing, the bot displays:
  > Payment temporarily unavailable. Error ID: \<correlationId> — please retry later.

## SQL Checks
```sql
SELECT wallet_id, SUM(amount) FROM ledger_entries GROUP BY wallet_id;
SELECT * FROM ad_deal_escrows WHERE ad_deal_id = ?;
```
