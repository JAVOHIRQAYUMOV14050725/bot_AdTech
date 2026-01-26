# Production Bug Analysis: Campaign Moderation Atomicity & State Machine Violations

## A) ROOT CAUSE SUMMARY

**Critical Issue**: The moderation approval flow violates ACID guarantees and introduces fatal race conditions causing 409 Conflict errors ("Campaign is not active") even when campaign IS active, followed by "Escrow not found" errors in reconciliation.

**Root Causes**:

1. **Missing Campaign Activation Gating**

   - `submitTarget()` in [campaigns.service.ts](campaigns.service.ts) does NOT verify campaign.status is active
   - `holdEscrow()` in [payments.service.ts](payments.service.ts#L302) DOES check `target.campaign.status !== CampaignStatus.active` but AFTER already updating target status in moderation
   - This creates a race: if campaign drafted, target can be submitted, but then approval fails mid-escrow-creation with partial state commit

2. **Non-Atomic Moderation Approval**

   - [ModerationService.approve()](moderation.service.ts) is NOT a single Prisma transaction
   - It calls `holdEscrow()` from [PaymentsService.approve()](payments.service.ts) which is a SEPARATE transaction
   - If `holdEscrow()` fails (e.g., budget exceeded, campaign not active), the target has already been marked submitted, but approval fails
   - Lifecycle FSM logs transition `submitted→approved` BEFORE checking campaign.status, indicating state was mutated prematurely

3. **Missing Idempotency Keys & Uniqueness Constraints**

   - `Escrow` has no uniqueness constraint on `campaignTargetId` (schema shows no UNIQUE constraint)
   - `PostJob` has `campaignTargetId @unique`, but only by luck
   - `LedgerEntry` has `idempotencyKey @unique` but `escrow_hold:${campaignTargetId}` may not be generated consistently
   - Double-approve can theoretically create duplicate ledger entries

4. **Insecure Endpoint (Security Hole)**

   - [campaign-targets.controller.ts](campaign-targets.controller.ts) `POST /:id/submit` passes empty campaignId to `submitTarget('', targetId, userId)`
   - Future refactors that remove campaignId validation could allow advertiser to submit any target owned by any advertiser

5. **Campaign Status Never Transitioned to Active**
   - No endpoint exists to activate campaign (transition draft→active)
   - Advertisers create campaign in draft, add creatives, submit targets, but campaign stays draft forever
   - Admin approval then fails because `holdEscrow()` checks campaign.status !== CampaignStatus.active

---

## B) STATE MACHINES (Canonical)

### CampaignStatus FSM (from [lifecycle.ts](lifecycle.ts#L25))

```
draft ──────(advertiser/admin/system)──────→ active
  ↓                                             ↓
  └────────(admin)─→ cancelled          paused(admin)←─┐
                                                        │
                                    completed(admin/system)
                                                 ↑
                                     active ────┘
```

**Current Problem**: No endpoint to transition draft→active. Campaign can remain draft indefinitely.

**Where Enforced**: [assertCampaignTransition()](lifecycle.ts#L160) in lifecycle FSM

### CampaignTargetStatus FSM (from [lifecycle.ts](lifecycle.ts#L47))

```
pending ──(advertiser/admin/system)──→ submitted ──(admin/system)──→ approved ──(worker/system/admin)──→ posted
  ├─────────────(worker/system/admin)─────────────────────────→ failed ──(worker/system/admin)──→ refunded
  └──(worker/system/admin)──────────────────────────────────────→ refunded

submitted ──(admin/system)──→ rejected [terminal]
```

**Current Problem**: `submitTarget()` does NOT check campaign.status. Should fail if campaign is draft.

**Where Enforced**: [assertCampaignTargetTransition()](lifecycle.ts#L175) in lifecycle FSM

**Fatal Flaw**: Transition to approved is called BEFORE all financial preconditions verified. See [moderation.service.ts](moderation.service.ts#L98) - FSM assertion happens at line 98, but actual state update at line 113, and escrow creation at line 119 (outside the early transaction). If escrow fails, target is already approved.

### EscrowStatus FSM (from [lifecycle.ts](lifecycle.ts#L95))

```
held ──(worker/system/admin)──→ released  [terminal]
  └────(worker/system/admin)──→ refunded   [terminal]
```

**Current Problem**: Must be created when target transitions to approved, and must persist. Missing UNIQUE constraint on campaignTargetId.

**Where Enforced**: [escrow.service.ts](escrow.service.ts) and [payments.service.ts](payments.service.ts#L240)

### PostJobStatus FSM (from [lifecycle.ts](lifecycle.ts#L80))

```
queued ──(worker)──→ sending ──(worker/system)──→ success [terminal]
  └────(worker/system)──→ failed ──(admin)──→ queued (retry)
  │
  └────(system)──→ success
```

**Current Problem**: PostJob must be created atomically with target→approved transition. If approval fails mid-way, PostJob not created, but target marked approved. Later recovery cannot find PostJob.

**Where Enforced**: [scheduler workers](scheduler/) use this, but creation lacks atomicity with approval.

---

## C) PRODUCTION RISKS ELIMINATED

### Checklist of Fixes Applied

- [x] **Campaign Activation Gate**: New endpoint `POST /campaigns/:id/activate` (draft→active) with validations
- [x] **submitTarget Campaign Check**: Now verifies `campaign.status === CampaignStatus.active`
- [x] **Atomic Approval**: Entire `ModerationService.approve()` is single `prisma.$transaction` with proper order:
  - Fetch + validate campaign/target/channel/creatives
  - Check campaign.status === active
  - Check target.status === submitted
  - Check creatives exist
  - Check scheduledAt valid
  - Create escrow idempotently (catch P2002 unique violation, read existing)
  - Create PostJob idempotently (catch P2002, read existing)
  - Only then update target.status = approved
  - Commit all at once
- [x] **Idempotency**: All financial operations use `idempotencyKey` unique constraints
- [x] **Unique Constraints**:
  - `Escrow.campaignTargetId @unique`
  - `PostJob.campaignTargetId @unique`
  - `LedgerEntry.idempotencyKey @unique`
- [x] **Removed Insecure Endpoint**: `campaign-targets.controller.ts` deleted from module
- [x] **FSM Logging**: FSM transition logged ONLY after successful database commit, not before

---

## D) FILES CHANGED

### New/Modified Files

1. **[campaigns.service.ts](campaigns.service.ts)** - Add `activateCampaign()` method
2. **[campaigns.controller.ts](campaigns.controller.ts)** - Add `POST /:id/activate` endpoint
3. **[moderation.service.ts](moderation.service.ts)** - Refactor `approve()` to single transaction with atomicity
4. **[payments.service.ts](payments.service.ts)** - Refactor `holdEscrow()` to accept `tx` and remove early state mutations
5. **[schema.prisma](schema.prisma)** - Add unique constraints on `Escrow.campaignTargetId` and index
6. **[campaign-targets.controller.ts](campaign-targets.controller.ts)** - REMOVED from [campaigns.module.ts](campaigns.module.ts)

### Prisma Migrations

1. `20260125_add_escrow_unique_constraint` - Add UNIQUE(campaignTargetId) to escrows table

---
