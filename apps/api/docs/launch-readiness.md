# Launch-Grade Production Readiness

This document hardens the system for launch by defining integration test matrices, incident runbooks, production hardening config, and a strict launch checklist. It assumes real money risk and prioritizes data integrity, auditable recovery, and safe shutdown paths.

---

## 1) Money & Lifecycle Integration Test Matrix (No Mocks)

**Execution rule:** Every test below must run against a real Postgres + Redis + BullMQ + Telegram sandbox token. Use transactions where applicable and assert via DB queries only (no mocks). Each test must have crash-recovery variants (process killed mid-transaction) and retry variants (same API/worker message delivered twice).

### A. Wallet & Ledger

| ID | Initial State | Action | Expected DB State | Invariant | Failure Mode if Violated |
| --- | --- | --- | --- | --- | --- |
| W1 | Wallet balance = 0; Ledger empty | Credit wallet (top-up) | Wallet balance +X; Ledger entry CREDIT X; ledger sum == wallet balance | **Ledger sum == wallet balance** | Balance drift -> ledger/escrow mismatch; must halt payouts |
| W2 | Wallet balance = X | Debit wallet (reserve for escrow) | Wallet balance -X; Ledger entry DEBIT X | **No negative balance** | Negative balance allows overspend |
| W3 | Wallet balance = X | Double-execute debit (same idempotency key) | One DEBIT entry only; wallet balance -X once | **Idempotency on ledger** | Duplicate debit -> funds lost |
| W4 | Wallet balance = X | Crash mid-transaction between ledger insert and wallet update | On restart: **either** both persisted or both rolled back | **Atomicity across wallet+ledger** | Split-brain financial state |
| W5 | Wallet balance = X | Retry debit after transient DB error | Single DEBIT entry; wallet balance -X | **Retry-safe idempotency** | Duplicate debit |
| W6 | Wallet balance = X | Kill-switch ON -> attempt debit | No wallet change; no ledger entry | **Kill-switch prevents mutations** | Funds mutate during kill-switch |

**Required DB assertions (SQL examples):**
- `SELECT balance FROM "Wallet" WHERE id = $1;`
- `SELECT SUM(amount) FROM "LedgerEntry" WHERE walletId = $1;`
- `SELECT COUNT(*) FROM "LedgerEntry" WHERE idempotencyKey = $1;`

### B. Escrow

| ID | Initial State | Action | Expected DB State | Invariant | Failure Mode if Violated |
| --- | --- | --- | --- | --- | --- |
| E1 | Wallet balance = X; Escrow none | Create escrow for campaign target | Wallet debited X; Escrow status HELD; Ledger DEBIT X | **Escrow HELD implies funds reserved** | Escrow created without funds |
| E2 | Escrow HELD; job completed | Release escrow to publisher wallet | Escrow RELEASED; Ledger CREDIT to publisher; no re-debit | **Single release** | Double release -> funds minted |
| E3 | Escrow HELD; job failed | Cancel escrow -> funds returned to advertiser wallet | Escrow CANCELED; Ledger CREDIT to advertiser | **Escrow sum preserved** | Funds stranded in escrow |
| E4 | Escrow HELD | Double-execute release (same job) | One release only; escrow state remains RELEASED | **Idempotent release** | Double payout |
| E5 | Escrow HELD | Crash mid-release (after escrow state change, before ledger) | Recovery job reconciles; either roll back escrow state or complete ledger | **Escrow & ledger consistent** | Escrow released but funds not credited |
| E6 | Escrow HELD | Kill-switch ON -> attempt release | Escrow remains HELD; no ledger changes | **Kill-switch prevents payout** | Payouts during incident |

**Required DB assertions:**
- `SELECT status FROM "Escrow" WHERE id = $1;`
- `SELECT SUM(amount) FROM "LedgerEntry" WHERE escrowId = $1;`

### C. CampaignTarget Lifecycle

| ID | Initial State | Action | Expected DB State | Invariant | Failure Mode if Violated |
| --- | --- | --- | --- | --- | --- |
| CT1 | CampaignTarget CREATED | Approve moderation | CampaignTarget APPROVED; escrow HELD | **Approval creates escrow** | Approved without funds |
| CT2 | CampaignTarget APPROVED | Start job creation | PostJob CREATED; CampaignTarget ACTIVE | **Lifecycle monotonicity** | Skip states -> inconsistent job counts |
| CT3 | CampaignTarget ACTIVE | Complete job -> target COMPLETED | CampaignTarget COMPLETED; escrow RELEASED | **Completion releases escrow once** | Duplicate payout or stuck escrow |
| CT4 | CampaignTarget ACTIVE | Fail job -> target FAILED | CampaignTarget FAILED; escrow CANCELED | **Failure refunds** | Funds stuck |
| CT5 | CampaignTarget ANY | Double transition (replay worker) | State unchanged after first transition | **FSM idempotency** | Duplicate side effects |
| CT6 | CampaignTarget APPROVED | Kill-switch ON -> attempt transition | No state change | **Kill-switch blocks lifecycle mutation** | Unexpected state mutation |

### D. PostJob Lifecycle

| ID | Initial State | Action | Expected DB State | Invariant | Failure Mode if Violated |
| --- | --- | --- | --- | --- | --- |
| PJ1 | PostJob CREATED | Queue worker claims job | PostJob IN_PROGRESS | **Exclusive claim** | Two workers process same job |
| PJ2 | PostJob IN_PROGRESS | Telegram post success | PostJob POSTED; CampaignTarget ACTIVE | **Single success** | Double posting or double payout |
| PJ3 | PostJob IN_PROGRESS | Telegram API failure (5xx) -> retry | PostJob RETRYING; attempt count incremented | **Retry backoff** | Hot loop -> spam API |
| PJ4 | PostJob RETRYING | Retry succeeds | PostJob POSTED; no duplicate ledger | **No double side effects** | Double payouts |
| PJ5 | PostJob IN_PROGRESS | Crash worker mid-update | On restart: job either re-queued or marked FAILED after max retries | **At-least-once with idempotency** | Stuck in IN_PROGRESS forever |
| PJ6 | PostJob CREATED | Kill-switch ON -> worker should not claim | PostJob stays CREATED | **Kill-switch halts workers** | Work proceeds during incident |

### Integration Test Skeleton (Jest + Prisma + Real Services)

> **Note:** This is a skeleton for integration tests only; it assumes a real DB/Redis/Telegram sandbox. No mocks.

```ts
// apps/api/test/integration/ledger-escrow.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaClient } from '@prisma/client';

describe('Ledger/Escrow Integration', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('E1: creates escrow and debits wallet atomically', async () => {
    // Arrange: create wallet with balance X via direct DB seed or system API
    // Act: call real system API to create escrow
    // Assert: escrow HELD, wallet debited, ledger has single DEBIT
    // Query DB for invariants
  });

  it('E4: idempotent escrow release', async () => {
    // Arrange: existing escrow HELD
    // Act: run release twice (same idempotency key)
    // Assert: single credit ledger entry
  });
});
```

**Test execution policy:**
- Run tests serially for financial safety to avoid race conditions.
- Each test must clean up its own data (hard deletes or dedicated test schema).
- Tests must include a kill-switch ON scenario to verify mutation blocks.

---

## 2) Failure & Incident Playbook (SRE-Grade)

### Incident: Ledger Invariant Violation

- **Detection signal**
  - Scheduled reconcile job flags `SUM(ledger) != wallet.balance`.
  - Alert: `ledger_invariant_violation_total > 0`.
- **Immediate action**
  - Flip kill-switch ON (stop all money mutations).
  - Freeze payouts & new escrow creations.
- **Safe shutdown steps**
  - Pause workers handling PostJob and payout queues.
  - Disable scheduler.
- **Recovery steps**
  - Identify drift source by comparing ledger entries since last stable checkpoint.
  - Rebuild wallet balances from ledger as source of truth.
  - Apply corrective ledger entries only if auditable.
- **Verification queries**
  - `SELECT walletId, SUM(amount) FROM "LedgerEntry" GROUP BY walletId;`
  - `SELECT id, balance FROM "Wallet";`
- **Kill-switch usage**
  - **Use** kill-switch immediately.
  - **Do NOT** auto-fix if drift source is unknown.

### Incident: Escrow Stuck in HELD

- **Detection signal**
  - Escrow in HELD beyond SLA (e.g., 24h after job completion).
  - Alert: `escrow_held_overdue_total`.
- **Immediate action**
  - Pause payout worker only (not full kill-switch unless ledger inconsistency). 
- **Safe shutdown steps**
  - Drain queue to avoid new releases.
- **Recovery steps**
  - Verify PostJob/CampaignTarget states.
  - If completion recorded, run manual escrow release job for specific ID.
- **Verification queries**
  - `SELECT id, status FROM "Escrow" WHERE status = 'HELD';`
  - `SELECT id, state FROM "PostJob" WHERE escrowId = $1;`
- **Kill-switch usage**
  - **Use** kill-switch only if double-release risk is detected.
  - **Do NOT** auto-release if job completion is ambiguous.

### Incident: Wallet Balance Mismatch

- **Detection signal**
  - `wallet_balance_mismatch_total > 0` from reconcile job.
- **Immediate action**
  - Kill-switch ON.
- **Safe shutdown steps**
  - Stop payout and escrow workers.
- **Recovery steps**
  - Recompute wallet balances from ledger.
  - Investigate duplicate ledger entries or missing entries.
- **Verification queries**
  - `SELECT walletId, COUNT(*) FROM "LedgerEntry" GROUP BY walletId;`
- **Kill-switch usage**
  - **Use** kill-switch immediately.
  - **Do NOT** auto-fix if reconcile drift > threshold or missing ledger rows.

### Incident: Telegram API Outage

- **Detection signal**
  - Increased `telegram_api_5xx_total` or timeouts.
  - Worker retry storm.
- **Immediate action**
  - Enable backoff & pause PostJob workers.
- **Safe shutdown steps**
  - Pause queue consumption; do not cancel escrows.
- **Recovery steps**
  - Resume workers gradually.
  - Re-run failed PostJobs with idempotency.
- **Verification queries**
  - `SELECT id, state, retryCount FROM "PostJob" WHERE state IN ('RETRYING','FAILED');`
- **Kill-switch usage**
  - **Do NOT** use kill-switch (no money movement).

### Incident: Redis Outage

- **Detection signal**
  - BullMQ connection failures; queue stalled.
- **Immediate action**
  - Kill-switch ON if payouts or escrows might be retried improperly after recovery.
- **Safe shutdown steps**
  - Stop queue workers to prevent partial processing.
- **Recovery steps**
  - Restore Redis; verify queue integrity.
  - Resume workers with idempotency checks.
- **Verification queries**
  - `SELECT id, state FROM "PostJob" WHERE state = 'IN_PROGRESS';`
- **Kill-switch usage**
  - **Use** kill-switch if ledger side effects could double-apply after Redis recovery.

### Incident: Worker Crash Loop

- **Detection signal**
  - CrashLoopBackOff or high restart rate.
- **Immediate action**
  - Stop queue consumption (pause specific queues).
- **Safe shutdown steps**
  - Reduce worker concurrency to 0.
- **Recovery steps**
  - Inspect last job payload, identify poison message.
  - Quarantine the job; fix data or code; resume.
- **Verification queries**
  - `SELECT id, state, lastError FROM "PostJob" WHERE state = 'FAILED';`
- **Kill-switch usage**
  - **Use** kill-switch if payout/escrow workers are crashing mid-transaction.

### Incident: Partial Payout Executed

- **Detection signal**
  - Escrow RELEASED but ledger credit missing.
  - Alert: `escrow_release_without_ledger_total`.
- **Immediate action**
  - Kill-switch ON.
- **Safe shutdown steps**
  - Stop payout workers.
- **Recovery steps**
  - For each escrow: verify ledger entries; if missing, apply audited corrective credit.
- **Verification queries**
  - `SELECT e.id FROM "Escrow" e LEFT JOIN "LedgerEntry" l ON l.escrowId = e.id WHERE e.status = 'RELEASED' AND l.id IS NULL;`
- **Kill-switch usage**
  - **Use** kill-switch immediately.
  - **Do NOT** auto-fix if more than one escrow shows mismatch.

---

## 3) Production Config & Deployment Hardening (Concrete)

### Docker Compose / K8s-Ready Setup

- **API**
  - CPU: 500m baseline, 1-2 cores burst
  - Memory: 512Mi baseline, 1Gi limit
  - Replicas: 2 (active-active) with sticky queue ownership by worker group
- **Worker**
  - Separate deployment: 2-4 replicas
  - Concurrency: 1 for payout/escrow queues; 5 for posting queues
- **Postgres**
  - Managed service (RDS/CloudSQL) with PITR enabled
  - Connection limit: 100; reserve 20 for admin
- **Redis**
  - Managed Redis with persistence (AOF enabled)
  - Disable eviction for BullMQ keys

### Health Checks (Liveness/Readiness)

- **Liveness** `/api/system/healthz`
  - Returns 200 if process is alive.
- **Readiness** `/api/system/readyz`
  - Checks DB + Redis connectivity + kill-switch state.

### Prisma Connection Pooling

- Use PgBouncer in transaction mode.
- `DATABASE_URL=postgresql://...` routed through PgBouncer.
- Pool size: 20 connections per app instance.

### Redis Configuration (BullMQ)

- `maxRetriesPerRequest = 3`
- `enableReadyCheck = true`
- `retryStrategy = exponential backoff starting 250ms`
- `lockDuration` set to **2x max job time** to prevent double-claim.

### Cron Safety

- Cron jobs **must be single-leader** (advisory DB lock). 
- Schedule reconciliation every 15 minutes; payout sweeps hourly.

### Env Var Validation Strategy

- Use runtime validation on boot; fail fast if missing.
- Example: `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `KILL_SWITCH_DEFAULT`.

### Secrets Handling

- **No .env in prod**.
- Use KMS/Secrets Manager and inject at runtime.

### Logging Levels

- Default `INFO`; elevate to `WARN` during incidents.
- Include correlation IDs, escrow IDs, and ledger IDs in logs.

### Alert Thresholds (Concrete)

- `ledger_invariant_violation_total > 0` (CRITICAL)
- `escrow_release_without_ledger_total > 0` (CRITICAL)
- `postjob_retry_rate > 5%` (WARN)
- `telegram_api_5xx_rate > 2%` (WARN)
- `worker_crash_rate > 3/min` (CRITICAL)

---

## 4) Launch Checklist (Gatekeeper)

> If any item fails: **DO NOT LAUNCH**.

### Preconditions

- Postgres PITR enabled and confirmed restore test performed.
- Redis persistence enabled and verified.
- Telegram bot token verified in sandbox.
- Kill-switch endpoints verified authenticated and working.

### One-Time Migrations

- Run all Prisma migrations in maintenance window.
- Snapshot DB after migrations.

### Kill-Switch Default States

- Kill-switch **ON** for first deployment.
- Switch **OFF** only after smoke tests pass.

### Safe First Campaign Execution

- Create 1 campaign target with minimal budget.
- Validate escrow created and ledger debited.
- Run a single PostJob; verify success state and escrow release.

### First Payout Dry-Run

- Execute payout flow with **dry-run mode** (no external transfer) or sandbox wallet.
- Validate ledger entries and wallet balances.

### Rollback Criteria

- Any ledger invariant violation.
- Escrow status inconsistent with ledger.
- Queue processing > 15 minutes behind SLA.
- Telegram failure rate > 5% sustained for 15 minutes.

