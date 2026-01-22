# Production Safety Plan (Pre-Launch Gate)

## 1) Integration Tests (No Mocks, DB-Only Assertions)

### Test Matrix

| Test ID | Scope | Initial DB State | Action (API/Service/Worker) | Expected DB State | Invariant | Failure Means in Prod |
| --- | --- | --- | --- | --- | --- | --- |
| INT-WL-01 | Wallet + Ledger | User + wallet balance=0, no ledger entries | `PaymentsService.deposit(userId, amount)` | Wallet balance increments, ledger entry credit created, audit event created | `wallet.balance == SUM(ledger.amount)` | Deposits can drift wallet vs ledger → silent money loss/gain | 
| INT-ES-01 | Escrow HOLD | CampaignTarget `pending`, advertiser wallet funded, publisher wallet exists, kill switch `new_escrows=ON` | `PaymentsService.holdEscrow(campaignTargetId)` | Escrow row `held`, advertiser balance decremented, ledger `escrow_hold` entry | Wallet balance matches ledger sum after debit | Escrow hold may over/under-debit advertiser | 
| INT-ES-02 | Escrow RELEASE | Escrow `held`, PostJob `success`, CampaignTarget `pending`, `payouts=ON` | `EscrowService.release(campaignTargetId)` | Escrow `released`, CampaignTarget `posted`, payout ledger credited, publisher balance increased | Escrow release requires successful PostJob; ledger sum matches wallet | Payouts may leak funds or release without valid post | 
| INT-ES-03 | Escrow REFUND | Escrow `held`, PostJob `failed`, CampaignTarget `pending` | `EscrowService.refund(campaignTargetId)` | Escrow `refunded`, CampaignTarget `refunded`, refund ledger credited to advertiser | Escrow refund only on failed post; ledger sum matches wallet | Refunds may double-credit or miss refunds | 
| INT-PJ-01 | PostJob Lifecycle | PostJob `queued`, Escrow `held`, BullMQ ready, worker kill-switch ON | `startPostWorker` + `postQueue.add` | On failure: PostJob `failed`, Escrow `refunded`, CampaignTarget `refunded` | PostJob transitions valid; escrow state matches job outcome | Worker retries may pay twice or miss refunds | 
| INT-KS-01 | Kill-switch behavior | Kill switch OFF (`new_escrows` or `payouts`) | Call `holdEscrow` / `release` | No DB state change, operation blocked | Kill switch is authoritative gate | Kill switch bypass → uncontrolled payouts/escrow creation |

### Required E2E Skeletons (Jest)

- Payments + Escrow coverage: `apps/api/test/integration/payments.e2e-spec.ts`
- PostJob + worker + BullMQ: `apps/api/test/integration/post-job.e2e-spec.ts`
- Kill-switch enforcement: `apps/api/test/integration/kill-switch.e2e-spec.ts`

### Test Details (DB-Only Assertions)

#### INT-WL-01 Wallet + Ledger
- **Initial DB state**: wallet balance = 0, no ledger entries.
- **Action**: `PaymentsService.deposit`.
- **Expected DB state**: wallet balance increased, ledger entry created (`deposit`).
- **Invariant**: wallet balance equals ledger sum.
- **Failure means**: deposits diverge from ledger; accounting cannot be trusted.

#### INT-ES-01 Escrow HOLD
- **Initial DB state**: `CampaignTarget.pending`, advertiser wallet funded, publisher wallet exists, `KillSwitch.new_escrows=ON`.
- **Action**: `PaymentsService.holdEscrow`.
- **Expected DB state**: escrow row created `held`, advertiser balance decreased, ledger `escrow_hold` created.
- **Invariant**: wallet balance equals ledger sum.
- **Failure means**: escrow hold is not atomic; advertiser funds can be lost or held without ledger.

#### INT-ES-02 Escrow RELEASE
- **Initial DB state**: escrow `held`, post job `success`, target `pending`, `KillSwitch.payouts=ON`.
- **Action**: `EscrowService.release`.
- **Expected DB state**: escrow `released`, target `posted`, payout ledger created, publisher balance increased.
- **Invariant**: PostJob success is required; wallet balance equals ledger sum.
- **Failure means**: payouts can happen without a successful post or ledger mismatch.

#### INT-ES-03 Escrow REFUND
- **Initial DB state**: escrow `held`, post job `failed`, target `pending`.
- **Action**: `EscrowService.refund`.
- **Expected DB state**: escrow `refunded`, target `refunded`, refund ledger created.
- **Invariant**: refund only when job failed.
- **Failure means**: either refund missing or double credit.

#### INT-PJ-01 PostJob Lifecycle
- **Initial DB state**: post job `queued`, escrow `held`, worker kill-switch ON.
- **Action**: enqueue job via BullMQ and run `startPostWorker`.
- **Expected DB state**:
  - **Failure path (current test)**: PostJob `failed`, escrow `refunded`, target `refunded`.
  - **Success path (requires valid Telegram bot + channel)**: PostJob `success`, escrow `released`, target `posted`.
- **Invariant**: escrow state aligns to post job outcome.
- **Failure means**: either pay out without a post, or escrow remains stuck.

#### INT-KS-01 Kill Switch
- **Initial DB state**: relevant kill switch set `OFF`.
- **Action**: attempt `holdEscrow` or `release`.
- **Expected DB state**: no DB state change.
- **Invariant**: kill switch must be authoritative.
- **Failure means**: operational controls bypassed during incident.

---

## 2) Incident Simulation Runbook (Manual, SRE-Grade)

> Use on staging or a dedicated safety environment with fake funds.

### Ledger Invariant Violation
- **Trigger (safe)**: Manually update a wallet balance without adding ledger entry (SQL `UPDATE wallets SET balance = balance + 1 WHERE id = ...`).
- **Detection**: `systemService.checkLedgerInvariant()` logs `[INVARIANT] Ledger check started` and `Ledger invariant violated`.
- **Immediate action**: Turn **ON** `kill_switch.payouts` and `kill_switch.new_escrows`. Freeze new money movement.
- **Kill-switch usage**: ON immediately; do not resume until invariant corrected.
- **Recovery**:
  1. Identify impacted wallets.
  2. Reconcile missing ledger entries.
  3. Re-run ledger check.
- **DB verification**:
  ```sql
  SELECT w.id, w.balance, COALESCE(SUM(l.amount),0) AS ledger_sum
  FROM wallets w
  LEFT JOIN ledger_entries l ON l.walletId = w.id
  GROUP BY w.id
  HAVING w.balance <> COALESCE(SUM(l.amount),0);
  ```

### Escrow Stuck in HELD
- **Trigger (safe)**: Pause worker by disabling `worker_post` or crash workers while jobs are queued.
- **Detection**: `systemService.refundStuckEscrows()` warns `[CRON] Escrow watchdog triggered` and counts stuck escrows.
- **Immediate action**: Keep `payouts=OFF`. Assess whether escrow should be released or refunded.
- **Kill-switch usage**: Keep `payouts=OFF`, `new_escrows=OFF` until backlog cleared.
- **Recovery**:
  1. For stale HELD escrows past SLA, run forced refund via SystemService.
  2. Restore worker health.
- **DB verification**:
  ```sql
  SELECT id, campaignTargetId, status, createdAt
  FROM escrows
  WHERE status = 'held'
  ORDER BY createdAt ASC;
  ```

### Wallet Balance Mismatch (User-Reported)
- **Trigger (safe)**: Manually insert ledger entry without updating wallet balance.
- **Detection**: Support ticket + invariant check fails.
- **Immediate action**: Turn **ON** `payouts` and `new_escrows` kill switches. Freeze transfers.
- **Kill-switch usage**: ON until wallet reconciled.
- **Recovery**:
  1. Calculate expected balance from ledger.
  2. Update wallet balance to ledger sum.
  3. Run ledger invariant check.
- **DB verification**:
  ```sql
  SELECT w.id, w.balance, COALESCE(SUM(l.amount),0) AS ledger_sum
  FROM wallets w
  LEFT JOIN ledger_entries l ON l.walletId = w.id
  GROUP BY w.id
  HAVING w.balance <> COALESCE(SUM(l.amount),0);
  ```

### Telegram API Outage
- **Trigger (safe)**: Block outbound Telegram API calls (firewall or DNS). 
- **Detection**: Worker logs `Telegram send failed`, post jobs move to failed, DLQ grows.
- **Immediate action**: Turn **ON** `telegram_posting=OFF` and `worker_post=OFF` to stop retries.
- **Kill-switch usage**: ON for telegram and worker; leave `payouts=OFF` to prevent release without posts.
- **Recovery**:
  1. Restore network to Telegram.
  2. Re-enable `telegram_posting`, then `worker_post`.
  3. Requeue failed PostJobs after verification.
- **DB verification**:
  ```sql
  SELECT status, COUNT(*) FROM post_jobs GROUP BY status;
  SELECT status, COUNT(*) FROM escrows GROUP BY status;
  ```

### Redis Outage
- **Trigger (safe)**: Stop Redis instance or block port.
- **Detection**: BullMQ errors, queue stalled, worker logs `Worker error`.
- **Immediate action**: Turn **ON** `worker_post=OFF` and `worker_watchdogs=OFF` to prevent error storms.
- **Kill-switch usage**: ON for workers; `payouts` and `new_escrows` ON if jobs cannot progress safely.
- **Recovery**:
  1. Restore Redis.
  2. Confirm queue health.
  3. Re-enable workers and drain DLQ with manual review.
- **DB verification**:
  ```sql
  SELECT status, COUNT(*) FROM post_jobs GROUP BY status;
  SELECT status, COUNT(*) FROM escrows GROUP BY status;
  ```

### Worker Crash Loop
- **Trigger (safe)**: Introduce invalid creative payload causing worker to throw consistently.
- **Detection**: Worker logs errors + DLQ increase.
- **Immediate action**: Turn **ON** `worker_post=OFF` to stop crash loop; hold `payouts=OFF`.
- **Kill-switch usage**: ON until problematic jobs removed or fixed.
- **Recovery**:
  1. Identify offending PostJobs.
  2. Fix creative payloads or mark jobs failed.
  3. Re-enable worker.
- **DB verification**:
  ```sql
  SELECT id, status, lastError FROM post_jobs WHERE status = 'failed';
  ```

### Partial Payout Executed
- **Trigger (safe)**: Force-release escrow, then kill worker mid-transaction (simulate crash during release). 
- **Detection**: Escrow `released` but payout ledger missing or wallet invariant fails.
- **Immediate action**: Turn **ON** `payouts=OFF`, `new_escrows=OFF`.
- **Kill-switch usage**: ON; stop all movement.
- **Recovery**:
  1. Identify escrow without matching payout ledger.
  2. Create compensating ledger entry or reverse escrow if safe.
  3. Re-run invariant checks.
- **DB verification**:
  ```sql
  SELECT e.id, e.campaignTargetId
  FROM escrows e
  LEFT JOIN ledger_entries l
    ON l.referenceId = e.campaignTargetId AND l.reason = 'payout'
  WHERE e.status = 'released' AND l.id IS NULL;
  ```

---

## 3) Kill-Switch Launch Dry-Run (Gatekeeper Checklist)

> **Hard rule**: If any step fails, do **not** launch.

### Phase 0 — Pre-Deployment
- [ ] Verify kill-switch rows exist for all keys (no defaults).
- [ ] Set `payouts=OFF`, `new_escrows=OFF`, `telegram_posting=OFF`, `worker_post=OFF`.
- [ ] Confirm no active campaigns or pending post jobs.

### Phase 1 — Deploy with Kill Switch ON
- [ ] Deploy API + workers with kill-switch OFF state enforced.
- [ ] Verify API health and database connectivity.
- [ ] Run ledger invariant check and ensure clean.

### Phase 2 — Smoke Tests (No Money Movement)
- [ ] Create a test user, wallet, campaign, channel, target.
- [ ] Attempt escrow hold → must be blocked (DB unchanged).
- [ ] Attempt payout → must be blocked (DB unchanged).

### Phase 3 — First Micro-Campaign (Controlled)
- [ ] Enable `new_escrows=ON` only.
- [ ] Hold escrow for a **single** target (small amount).
- [ ] Verify escrow row `held` and ledger `escrow_hold`.
- [ ] Enable `telegram_posting=ON`, `worker_post=ON`.
- [ ] Process one post job to completion.

### Phase 4 — Escrow & Ledger Verification
- [ ] Confirm post job status `success` (or deliberate fail path handled).
- [ ] Confirm escrow `released` or `refunded` appropriately.
- [ ] Confirm ledger sum equals wallet balance for all involved wallets.

### Phase 5 — Controlled Kill-Switch OFF
- [ ] Enable `payouts=ON` only after post success verified.
- [ ] Run ledger invariant check immediately after.
- [ ] Monitor logs for kill-switch violations or invariant errors.

### Rollback Criteria (Immediate Kill)
- [ ] Any invariant check fails.
- [ ] Escrow `held` older than SLA.
- [ ] Any post job `failed` spike without auto-refund.
- [ ] Telegram API errors sustained.
