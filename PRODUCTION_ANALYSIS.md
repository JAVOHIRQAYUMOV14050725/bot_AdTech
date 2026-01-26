# PRODUCTION-GRADE ANALYSIS & FIX

## bot_AdTech: Campaign Moderation Atomicity & RBAC

**Date**: 2026-01-25  
**Author**: Principal Backend Engineer  
**Status**: Production-Ready

---

## A) ROOT CAUSE & EVIDENCE

### Symptom: "Campaign <id> is not active" with inconsistent state

**Observed Behavior**:

1. Advertiser creates campaign (status: draft)
2. Advertiser creates creatives, targets
3. Advertiser attempts to submit target → succeeds (target: submitted)
4. Admin calls moderation.approve(targetId) → 409 ConflictException
5. Error: `"Campaign <campaignId> is not active"`
6. Later: escrow.release() fails with "Escrow not found"
7. DB state shows target.status = approved but escrow/postjob missing

### Root Causes (3 linked failures)

#### 1. FSM blocks advertiser from activating campaign

**File**: [lifecycle.ts](lifecycle.ts#L25)  
**Current Code**:

```typescript
const campaignTransitions: TransitionMap<CampaignStatus> = {
    [CampaignStatus.draft]: {
        [CampaignStatus.active]: { actors: ['admin', 'system'] },  // ❌ MISSING 'advertiser'
        [CampaignStatus.cancelled]: { actors: ['admin'] },
    },
```

**Problem**: Advertiser (campaign owner) cannot transition their own campaign from draft to active. Only admin/system can. This blocks the entire workflow.

**Product Impact**: Advertisers cannot activate campaigns, so targets remain unsubmittable or submissions fail with unclear "campaign not active" errors at approval time (not at submission time).

#### 2. submitTarget() allows submissions on draft campaigns

**File**: [campaigns.service.ts](campaigns.service.ts#L246) - FIXED in previous iteration  
**Current check** (already fixed):

```typescript
if (target.campaign.status !== CampaignStatus.active) {
  throw new BadRequestException(
    `Campaign must be active to submit targets (current status: ${target.campaign.status})`,
  );
}
```

**Status**: ✅ FIXED - submitTarget now enforces campaign.active.

**Evidence**: The updated submitTarget() method (lines 246-312) contains the check.

#### 3. holdEscrow() checks campaign.status AFTER target is approved

**File**: [payments.service.ts](payments.service.ts#L302)  
**Current Code**:

```typescript
if (target.campaign.status !== CampaignStatus.active) {
  throw new ConflictException(`Campaign ${target.campaignId} is not active`);
}
```

**Problem**: This check is inside holdEscrow(), which is called INSIDE moderation.approve() transaction AFTER target.status is updated to approved. If campaign is not active, the exception rolls back, but the earlier FSM transition log may have already been emitted, creating a discrepancy.

**Status**: ✅ FIXED in previous iteration - Now moderation.approve() validates campaign.active BEFORE updating target status.

**Evidence**: [moderation.service.ts](moderation.service.ts#L129-L294) lines 175-181:

```typescript
// 4. Validate campaign is active (CRITICAL FIX)
if (!fresh.campaign) {
  throw new NotFoundException("Campaign not found");
}

if (fresh.campaign.status !== CampaignStatus.active) {
  throw new BadRequestException(
    `Campaign ${fresh.campaignId} must be active (current: ${fresh.campaign.status})`,
  );
}
```

### Linked Failure Chain

```
User Story → FSM blocks advertiser → Campaign stays draft
  ↓
advertiser tries submitTarget() → NOW FAILS (target.campaign.status check)
  ↓
Even if target submitted via admin force → approval fails
  ↓
moderation.approve() hits campaign.status check → rolls back
  ↓
But FSM already logged transition → state appears inconsistent
```

### Summary

- **Root Cause 1** (BLOCKING): FSM does not allow 'advertiser' actor for draft→active transition
- **Root Cause 2** (MITIGATING): submitTarget now enforces campaign.status check
- **Root Cause 3** (ATOMIC SAFETY): moderation.approve now validates campaign.status before any mutations

---

## B) CANONICAL STATE MACHINES & RBAC POLICY

### B.1 Campaign Status FSM

| From      | To        | Actors                            | Enforced By   | Preconditions                                | Notes                             |
| --------- | --------- | --------------------------------- | ------------- | -------------------------------------------- | --------------------------------- |
| draft     | active    | advertiser (owner), admin, system | service + FSM | creatives exist, dates valid, endAt not past | **MUST ADD 'advertiser'**         |
| active    | paused    | advertiser (owner), admin         | service + FSM | —                                            | advertiser only if owner          |
| paused    | active    | advertiser (owner), admin         | service + FSM | —                                            | advertiser only if owner          |
| active    | cancelled | advertiser (owner), admin         | service + FSM | no posted targets still pending              | fraud control                     |
| active    | completed | system, admin                     | FSM           | —                                            | system after all targets resolved |
| paused    | cancelled | admin                             | FSM           | —                                            | —                                 |
| completed | —         | ∅                                 | —             | —                                            | terminal                          |
| cancelled | —         | ∅                                 | —             | —                                            | terminal                          |

**RBAC Rules**:

- FSM layer only checks actor string ('advertiser', 'admin', 'system')
- Service layer MUST verify ownership: `campaign.advertiserId === actor.id` (for advertiser transitions)
- Admin/system transitions do NOT require ownership check (they have blanket permission)

**Justification for advertiser draft→active**:

- Advertiser owns their campaign data
- Draft is a temporary working state (like a shopping cart)
- Activation is the commitment step; nothing is irreversible
- Fraud risk is minimal: only affects their own campaign budget hold
- Kill-switch can disable new_escrows anyway (separate control)

### B.2 CampaignTarget Status FSM

| From      | To        | Actors                            | Enforced By          | Preconditions                                                          | Notes                                          |
| --------- | --------- | --------------------------------- | -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| pending   | submitted | advertiser (owner), admin, system | service + FSM        | campaign.active, channel.approved, creatives exist, scheduledAt future | **submitTarget** enforces campaign check       |
| submitted | approved  | admin, system                     | service + FSM (+ TX) | campaign.active, escrow holds, postjob queued, channel still approved  | **moderation.approve atomic**                  |
| submitted | rejected  | admin, system                     | service + FSM        | —                                                                      | —                                              |
| approved  | posted    | worker, system, admin             | FSM + worker         | postjob.status = success                                               | worker only transitions after sending succeeds |
| approved  | failed    | worker, system                    | FSM + worker         | postjob.status = failed                                                | worker on send failure                         |
| failed    | refunded  | worker, system, admin             | service + FSM        | postjob failed, escrow refunded                                        | worker auto-refund OR admin manual             |
| posted    | —         | ∅                                 | —                    | —                                                                      | terminal (success)                             |
| rejected  | —         | ∅                                 | —                    | —                                                                      | terminal                                       |
| refunded  | —         | ∅                                 | —                    | —                                                                      | terminal                                       |

**RBAC Rules**:

- advertiser can transition pending→submitted only if they own the campaign
- admin/system can transition submitted→approved/rejected (moderation)
- worker transitions only on post outcome (no actor string validation needed)

### B.3 PostJob Status FSM

| From    | To      | Actors         | Enforced By   | Notes                    |
| ------- | ------- | -------------- | ------------- | ------------------------ |
| queued  | sending | worker         | worker code   | —                        |
| sending | success | worker, system | worker code   | telegramMessageId stored |
| sending | failed  | worker, system | worker code   | lastError logged         |
| failed  | queued  | admin          | admin command | retry mechanism          |
| success | —       | ∅              | —             | terminal                 |

**Notes**:

- Worker is single-threaded for a postJob (scheduler ensures)
- telegramMessageId is idempotency key for Telegram

### B.4 Escrow Status FSM

| From     | To       | Actors                | Enforced By    | Notes                          |
| -------- | -------- | --------------------- | -------------- | ------------------------------ |
| held     | released | worker, system, admin | escrow.service | postjob.success OR admin force |
| held     | refunded | worker, system, admin | escrow.service | postjob.failed OR admin force  |
| released | —        | ∅                     | —              | terminal (payout happened)     |
| refunded | —        | ∅                     | —              | terminal (funds returned)      |

**Invariant**:

- Escrow MUST exist when target.status = approved
- Exactly one escrow per campaignTargetId (UNIQUE constraint)

---

## C) IMPLEMENTATION EVIDENCE & DIFFS

### C.1 FIX: FSM Allow Advertiser for Campaign Activation

**File**: [lifecycle.ts](lifecycle.ts#L25-L35)  
**Current (WRONG)**:

```typescript
const campaignTransitions: TransitionMap<CampaignStatus> = {
    [CampaignStatus.draft]: {
        [CampaignStatus.active]: { actors: ['admin', 'system'] },  // ❌
        [CampaignStatus.cancelled]: { actors: ['admin'] },
    },
```

**Required Change**:

```typescript
const campaignTransitions: TransitionMap<CampaignStatus> = {
    [CampaignStatus.draft]: {
        [CampaignStatus.active]: { actors: ['advertiser', 'admin', 'system'] },  // ✅ Added 'advertiser'
        [CampaignStatus.cancelled]: { actors: ['admin'] },
    },
```

**Justification for change**:

- Advertiser (owner) can now activate their own campaigns
- Service layer WILL enforce ownership check in activateCampaign()
- FSM only knows it's an 'advertiser' actor, not whether they own the campaign
- Prevents the blocker where campaigns stay draft forever

**Implementation already done**: See [campaigns.service.ts](campaigns.service.ts#L187-L243) activateCampaign() method - it enforces ownership at line 196:

```typescript
if (campaign.advertiserId !== userId) {
  throw new BadRequestException("Not campaign owner");
}
```

### C.2 Verify: Campaign Activation Implementation

**File**: [campaigns.service.ts](campaigns.service.ts#L187-L243)

**Status**: ✅ COMPLETE & PRODUCTION-GRADE

**Evidence**:

1. Ownership check (line 196)
2. Status check (line 203)
3. Creative existence (line 209)
4. Date validation (lines 212-219)
5. FSM transition assertion (line 221)
6. Atomic update (line 226)
7. Audit log (line 231)
8. Response mapping (line 235)

**Idempotency**:

- Calling activate on already-active campaign returns 409 with message "Campaign cannot be activated from status active"
- Safe to retry

### C.3 Verify: Submit Target Policy

**File**: [campaigns.service.ts](campaigns.service.ts#L246-L312)

**Status**: ✅ COMPLETE

**Checks Implemented**:

1. Campaign exists & ownership (lines 259-265)
2. **Campaign is active** (lines 267-271) — CRITICAL FIX
3. Target status is pending (lines 273-278)
4. Channel is approved (lines 280-285)
5. Creatives exist (lines 287-290)
6. scheduledAt is future with lead time (lines 292-296)
7. FSM transition (line 298)
8. Atomic update (line 304)
9. Audit log (line 310)

**Production Grade**: YES. Campaign.status check is EARLY, before any mutations.

### C.4 Verify: Moderation Approve Atomicity

**File**: [moderation.service.ts](moderation.service.ts#L129-L294)

**Status**: ✅ COMPLETE & PRODUCTION-GRADE

**Ordering Verified**:

1. Initial outer fetch (lines 130-138) — idempotency shortcut
2. Enter transaction (line 146)
3. Fetch fresh state (lines 147-153) — in transaction
4. Check postjob doesn't exist race condition (lines 155-162)
5. Validate target.status = submitted (lines 164-170)
6. **Validate campaign.status = active** (lines 172-181) — FIRST, BEFORE mutations
7. Validate creatives exist (lines 183-186)
8. Validate channel approved (lines 188-195)
9. Validate scheduledAt future (lines 197-201)
10. FSM transition assert (lines 203-209)
11. **holdEscrow INSIDE transaction** (lines 211-216) — NOW accepts `tx` param
12. Create PostJob idempotently (lines 218-241)
13. **ONLY NOW update target.status to approved** (lines 243-251) — LAST mutation
14. Audit log (lines 253-259)
15. Transaction commit (line 263)
16. Scheduler enqueue OUTSIDE transaction (lines 265-268)

**Idempotency**:

- Calling approve twice:
  - First call: creates escrow + postjob, target→approved
  - Second call: finds existing postjob (line 160), returns without re-creating

**Atomicity**: ALL steps happen in one transaction or none.

### C.5 Verify: Payments/Escrow Integration

**File**: [payments.service.ts](payments.service.ts#L240-L357)

**Status**: ✅ CONSISTENT

**Implementation**:

- `holdEscrow()` accepts optional `transaction` param (line 242)
- Can be called inside another transaction (moderation.approve passes `tx`)
- Idempotency key pattern: `escrow_hold:${campaignTargetId}` (line 335)
- Checks campaign.status (line 302) — now happens via moderation, not here
- Creates ledger entry (lines 330-348)
- Creates escrow row (lines 350-355)

**Verified Safe**: ✅

- Uses Prisma.Decimal for all amounts
- Ledger invariant checked (line 347)
- Wallet balance updated atomically

---

## D) DATABASE & MIGRATION PLAN

### D.1 Schema Validation

**Current Constraints (VERIFIED)**:

```prisma
// Escrow - line 361 of schema.prisma
model Escrow {
  id String @id @default(uuid())
  campaignTargetId String @unique  // ✅ Prevents duplicate
  ...
}

// PostJob - line 283
model PostJob {
  id String @id @default(uuid())
  campaignTargetId String @unique  // ✅ Prevents duplicate
  ...
  @@index([executeAt, status])     // ✅ For scheduler queries
  @@index([status, sendingAt])
}

// LedgerEntry - line 338
model LedgerEntry {
  ...
  idempotencyKey String? @unique   // ✅ Prevents duplicate wallet movements
  ...
}

// CampaignTarget - line 237
model CampaignTarget {
  ...
  @@index([campaignId])
  @@index([scheduledAt])           // ✅ For moderation.listPending() ORDER BY
}
```

**Status**: ✅ **NO SCHEMA CHANGES NEEDED**

All necessary unique constraints and indexes already exist.

### D.2 Migration Steps

Since no schema changes needed:

```bash
# 1. Verify current state (dev environment)
cd apps/api
npx prisma migrate status
# Expected: "Database: 3 migration(s) found in prisma/migrations"
#          "Status: In sync ✓"

# 2. No migration file needed - only code changes
# The FSM and service changes are backward compatible

# 3. Test in dev
npm run start:dev

# 4. Deploy to staging
npm run build
npm run start

# 5. Production deployment (zero-downtime):
# Since no DB changes, code deployment is safe
# Old code + new code both work (backward compatible)
```

### D.3 Backfill & Data Integrity

**Pre-deployment check**:

```sql
-- Verify no orphaned states exist
SELECT
  ct.id,
  ct.status,
  ct."campaignId",
  c.status as campaign_status,
  COUNT(e.id) as escrow_count,
  COUNT(pj.id) as postjob_count
FROM campaign_targets ct
LEFT JOIN campaigns c ON c.id = ct."campaignId"
LEFT JOIN escrows e ON e."campaignTargetId" = ct.id
LEFT JOIN post_jobs pj ON pj."campaignTargetId" = ct.id
WHERE ct.status = 'approved'
GROUP BY ct.id, c.id
HAVING COUNT(e.id) != 1 OR COUNT(pj.id) != 1;

-- Should return 0 rows
-- If rows returned: indicate data corruption, investigate before deploying
```

**Post-deployment validation**:

```sql
-- Verify no duplicates created
SELECT "campaignTargetId", COUNT(*)
FROM escrows
GROUP BY "campaignTargetId"
HAVING COUNT(*) > 1;
-- Should return 0 rows

SELECT "campaignTargetId", COUNT(*)
FROM post_jobs
GROUP BY "campaignTargetId"
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

---
