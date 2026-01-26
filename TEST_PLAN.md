# E) COMPLETE TEST PLAN

**Test Environment**:

- API: `http://localhost:3000/api`
- Database: PostgreSQL (local or Docker)
- Auth: JWT Bearer tokens

**Prerequisites**:

- Fresh database seed (kill-switch enabled, super-admin bootstrapped)
- API running with all modules loaded

---

## E.1 HAPPY PATH: Complete Campaign Workflow

### Step 1: Bootstrap Super-Admin

```bash
curl -X POST http://localhost:3000/api/auth/bootstrap-super-admin \
  -H "Content-Type: application/json" \
  -d '{
    "telegramId": "123456789",
    "username": "admin_test",
    "password": "TestP@ssw0rd1",
    "bootstrapSecret": "your-bootstrap-secret-from-.env"
  }'
```

**Expected Response** (201):

```json
{
  "ok": true,
  "user": {
    "id": "uuid-admin-id",
    "role": "super_admin",
    "telegramId": "123456789"
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

**Save**: `ADMIN_TOKEN` = accessToken

---

### Step 2: Register Advertiser

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "telegramId": "987654321",
    "username": "advertiser_test",
    "password": "TestP@ssw0rd2"
  }'
```

**Expected Response** (201):

```json
{
  "ok": true,
  "user": {
    "id": "uuid-advertiser-id",
    "role": "advertiser",
    "telegramId": "987654321"
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

**Save**: `ADVERTISER_TOKEN`, `ADVERTISER_ID`

---

### Step 3: Register Publisher (Channel Owner)

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "telegramId": "555666777",
    "username": "publisher_test",
    "password": "TestP@ssw0rd3"
  }'
```

**Expected Response** (201): Publisher created  
**Save**: `PUBLISHER_ID`

---

### Step 4: Publisher Creates Channel

```bash
curl -X POST http://localhost:3000/api/channels \
  -H "Authorization: Bearer $PUBLISHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telegramChannelId": "-1001234567890",
    "title": "Test Ad Channel",
    "username": "@test_ads_channel",
    "category": "news",
    "subscriberCount": 50000,
    "avgViews": 5000,
    "cpm": "2.50"
  }'
```

**Expected Response** (201):

```json
{
  "id": "uuid-channel-id",
  "status": "pending",
  "...": "..."
}
```

**Save**: `CHANNEL_ID`

---

### Step 5: Admin Approves Channel

```bash
curl -X POST "http://localhost:3000/api/admin/channels/$CHANNEL_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response** (200):

```json
{
  "id": "uuid-channel-id",
  "status": "approved",
  "...": "..."
}
```

**Verify DB**:

```sql
SELECT id, status FROM channels WHERE id = 'uuid-channel-id';
-- Should show: approved
```

---

### Step 6: Advertiser Creates Campaign (Draft)

```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Ad Campaign 2026",
    "totalBudget": "1000.00",
    "startAt": "2026-01-26T00:00:00Z",
    "endAt": "2026-02-28T23:59:59Z"
  }'
```

**Expected Response** (201):

```json
{
  "id": "uuid-campaign-id",
  "name": "My Ad Campaign 2026",
  "status": "draft",
  "totalBudget": "1000.00",
  "spentBudget": "0.00",
  "...": "..."
}
```

**Save**: `CAMPAIGN_ID`

**Verify DB**:

```sql
SELECT id, status, "advertiserId" FROM campaigns WHERE id = 'uuid-campaign-id';
-- Should show: draft, advertiser-id
```

---

### Step 7: Advertiser Adds Creative to Campaign

```bash
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/creatives" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contentType": "text",
    "contentPayload": {
      "text": "Check out this amazing offer! 🎁",
      "link": "https://example.com/promo"
    }
  }'
```

**Expected Response** (200):

```json
{
  "id": "uuid-creative-id",
  "campaignId": "uuid-campaign-id",
  "contentType": "text",
  "contentPayload": { "text": "...", "link": "..." },
  "approvedBy": null,
  "approvedAt": null
}
```

**Save**: `CREATIVE_ID`

---

### Step 8: Advertiser Activates Campaign ✅ CRITICAL TEST

```bash
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/activate" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response** (200):

```json
{
  "id": "uuid-campaign-id",
  "status": "active",
  "totalBudget": "1000.00",
  "spentBudget": "0.00",
  "createdAt": "2026-01-25T...",
  "...": "..."
}
```

**Verify DB**:

```sql
SELECT id, status FROM campaigns WHERE id = 'uuid-campaign-id';
-- Should show: active
```

**Verify Audit Log**:

```sql
SELECT action, metadata FROM user_audit_logs
WHERE "userId" = 'uuid-advertiser-id'
  AND action = 'campaign_activated'
ORDER BY "createdAt" DESC LIMIT 1;
-- Should show: campaign_activated, { campaignId: 'uuid-campaign-id' }
```

---

### Step 9: Advertiser Adds Target to Campaign

```bash
# Calculate scheduledAt (minimum 30 seconds in future)
SCHEDULED_AT=$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)

curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/targets" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"channelId\": \"$CHANNEL_ID\",
    \"price\": \"50.00\",
    \"scheduledAt\": \"$SCHEDULED_AT\"
  }"
```

**Expected Response** (200):

```json
{
  "id": "uuid-target-id",
  "campaignId": "uuid-campaign-id",
  "channelId": "uuid-channel-id",
  "price": "50.00",
  "status": "pending",
  "scheduledAt": "2026-01-25T...",
  "moderatedBy": null,
  "moderatedAt": null,
  "...": "..."
}
```

**Save**: `TARGET_ID`

**Verify DB**:

```sql
SELECT id, status, "campaignId", "channelId" FROM campaign_targets WHERE id = 'uuid-target-id';
-- Should show: pending, campaign-id, channel-id
```

---

### Step 10: Advertiser Submits Target ✅ CRITICAL TEST

```bash
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/targets/$TARGET_ID/submit" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response** (200):

```json
{
  "id": "uuid-target-id",
  "status": "submitted",
  "moderatedBy": null,
  "moderatedAt": null,
  "...": "..."
}
```

**Verify DB**:

```sql
SELECT id, status FROM campaign_targets WHERE id = 'uuid-target-id';
-- Should show: submitted
```

**Verify Audit Log**:

```sql
SELECT action, metadata FROM user_audit_logs
WHERE action = 'campaign_target_submitted'
  AND metadata->>'targetId' = 'uuid-target-id'
ORDER BY "createdAt" DESC LIMIT 1;
-- Should exist and be recent
```

---

### Step 11: Admin Lists Pending Moderation

```bash
curl -X GET http://localhost:3000/api/admin/moderation/pending \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected Response** (200):

```json
[
  {
    "id": "uuid-target-id",
    "campaignId": "uuid-campaign-id",
    "status": "submitted",
    "price": "50.00",
    "scheduledAt": "2026-01-25T...",
    "campaign": {
      "id": "uuid-campaign-id",
      "status": "active",
      "creatives": [ { "id": "uuid-creative-id", "..." } ]
    },
    "channel": {
      "id": "uuid-channel-id",
      "status": "approved",
      "..."
    },
    "...": "..."
  }
]
```

**Assertion**: Target is in submitted status, campaign is active, channel is approved.

---

### Step 12: Admin Approves Target ✅ CRITICAL TEST (ATOMICITY)

```bash
curl -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response** (200):

```json
{
  "ok": true,
  "targetId": "uuid-target-id",
  "postJobId": "uuid-postjob-id"
}
```

**Save**: `POST_JOB_ID`

**Verify DB - CRITICAL CHECKS**:

```sql
-- A) Target must be approved
SELECT id, status FROM campaign_targets WHERE id = 'uuid-target-id';
-- Must show: approved

-- B) Escrow must exist (exactly one)
SELECT id, status, amount FROM escrows WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: 1 row, status=held, amount=50.00

-- C) PostJob must exist (exactly one)
SELECT id, status FROM post_jobs WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: 1 row, status=queued

-- D) Advertiser wallet must be debited
SELECT balance FROM wallets WHERE "userId" = 'uuid-advertiser-id';
-- Must show: balance reduced by 50.00 (or less if multiple targets)

-- E) Ledger entry must exist for escrow hold
SELECT reason, type, amount FROM ledger_entries
WHERE "idempotencyKey" = 'escrow_hold:uuid-target-id';
-- Must show: 1 row, reason=escrow_hold, type=debit, amount=-50.00

-- F) Financial audit event must exist
SELECT type, reason, actor FROM financial_audit_events
WHERE "campaignTargetId" = 'uuid-target-id'
  AND reason = 'escrow_hold';
-- Must show: 1 row, type=debit, actor=admin
```

**Verify Audit Log**:

```sql
SELECT action, metadata FROM user_audit_logs
WHERE "userId" = 'uuid-admin-id'
  AND action = 'moderation_approved'
  AND metadata->>'targetId' = 'uuid-target-id'
ORDER BY "createdAt" DESC LIMIT 1;
-- Must show: moderation_approved, { targetId: '...', postJobId: '...' }
```

---

### Step 13: Simulate Worker Processing Post Job

**Worker would normally do this via scheduler, but we'll simulate:**

```bash
# 1. Worker picks up job (UPDATE status to sending)
#    In real system: worker via scheduler picks queued jobs

# 2. Simulate successful post
curl -X POST "http://localhost:3000/api/internal/post-jobs/$POST_JOB_ID/success" \
  -H "Authorization: Bearer $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telegramMessageId": 123456789,
    "responsePayload": { "ok": true }
  }'
# Response: 200 OK
```

**Verify DB**:

```sql
SELECT status, "telegramMessageId" FROM post_jobs WHERE id = 'uuid-postjob-id';
-- Must show: success, 123456789

SELECT status FROM campaign_targets WHERE id = 'uuid-target-id';
-- Must show: posted
```

---

### Step 14: Verify Escrow Release & Payout

```sql
-- A) Escrow must be released
SELECT status, "releasedAt" FROM escrows WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: released, timestamp (not null)

-- B) Ledger entries for payout
SELECT reason, type, amount FROM ledger_entries
WHERE "campaignTargetId" = 'uuid-target-id'
  AND reason IN ('payout', 'commission');
-- Must show:
--   payout: credit to publisher wallet
--   commission: credit/debit to platform wallet

-- C) Publisher wallet increased
SELECT balance FROM wallets WHERE "userId" = 'uuid-publisher-id';
-- Must show: increased by payout amount

-- D) Ledger invariant (sum of all entries = final balance)
SELECT SUM(amount) as total_balance FROM ledger_entries WHERE "walletId" = (
  SELECT id FROM wallets WHERE "userId" = 'uuid-advertiser-id'
);
SELECT balance FROM wallets WHERE "userId" = 'uuid-advertiser-id';
-- Must match
```

---

## E.2 NEGATIVE TESTS (Error Cases)

### Test N1: Activate Campaign by Non-Owner

```bash
# Admin tries to activate advertiser's campaign using advertiser actor
# (To test: needs different advertiser to attempt this)
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/activate" \
  -H "Authorization: Bearer $OTHER_ADVERTISER_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response** (400):

```json
{
  "statusCode": 400,
  "message": "Not campaign owner",
  "error": "Bad Request"
}
```

**DB State**: Campaign remains draft, no audit log for different advertiser.

---

### Test N2: Activate Campaign Twice

```bash
# After successful activation in E.8
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/activate" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response** (400):

```json
{
  "statusCode": 400,
  "message": "Campaign cannot be activated from status active",
  "error": "Bad Request"
}
```

**DB State**: Campaign still active, no duplicate audit logs.

---

### Test N3: Submit Target Without Creative

```bash
# Create campaign without adding creative
curl -X POST http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "No Creative Campaign",
    "totalBudget": "500.00"
  }'
# Response: 201, CAMPAIGN_NO_CREATIVE_ID

# Activate it
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_NO_CREATIVE_ID/activate" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN"
# Response: 400 (no creative)
```

**Expected Response** (400):

```json
{
  "statusCode": 400,
  "message": "Campaign must have at least one creative",
  "error": "Bad Request"
}
```

---

### Test N4: Submit Target While Campaign Draft

```bash
# Create campaign (draft) with creative
curl -X POST http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Draft Cam", "totalBudget": "500.00" }'
# Response: 201, CAMPAIGN_DRAFT_ID

# Add creative
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_DRAFT_ID/creatives" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "contentType": "text", "contentPayload": { "text": "test" } }'
# Response: 200, CREATIVE_ID

# Add target
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_DRAFT_ID/targets" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{ \"channelId\": \"$CHANNEL_ID\", \"price\": \"25.00\", \"scheduledAt\": \"$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)\" }"
# Response: 200, TARGET_DRAFT_ID

# Try to submit WITHOUT activating campaign first
curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_DRAFT_ID/targets/$TARGET_DRAFT_ID/submit" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN"
```

**Expected Response** (400):

```json
{
  "statusCode": 400,
  "message": "Campaign must be active to submit targets (current status: draft)",
  "error": "Bad Request"
}
```

**DB State**:

```sql
SELECT status FROM campaigns WHERE id = 'campaign-draft-id';
-- draft

SELECT status FROM campaign_targets WHERE id = 'target-draft-id';
-- pending (unchanged)
```

---

### Test N5: Approve Target When Campaign Not Active

```bash
# Create: Campaign (draft) -> Creative -> Target (pending)
# Activate campaign temporarily
# Submit target (target → submitted)
# THEN pause campaign

curl -X POST "http://localhost:3000/api/campaigns/$CAMPAIGN_ID/targets/$TARGET_ID/activate" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN"
# (This is not a real endpoint, just for example)
# In reality: manually update DB or use admin endpoint

# Update campaign to paused (if endpoint exists)
# Or manually: UPDATE campaigns SET status = 'paused' WHERE id = '...';

# Now try to approve target
curl -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected Response** (400):

```json
{
  "statusCode": 400,
  "message": "Campaign uuid-campaign-id must be active (current: paused)",
  "error": "Bad Request"
}
```

**DB State**:

```sql
SELECT status FROM campaign_targets WHERE id = 'uuid-target-id';
-- submitted (unchanged - transaction rolled back)

SELECT status FROM escrows WHERE "campaignTargetId" = 'uuid-target-id';
-- (no row - not created)

SELECT status FROM post_jobs WHERE "campaignTargetId" = 'uuid-target-id';
-- (no row - not created)

SELECT balance FROM wallets WHERE "userId" = 'uuid-advertiser-id';
-- unchanged from before approve attempt
```

**Verify Audit Log**:

```sql
SELECT COUNT(*) FROM user_audit_logs
WHERE action = 'moderation_approved'
  AND metadata->>'targetId' = 'uuid-target-id';
-- Must show: 0 (no log for failed attempt)
```

---

### Test N6: Approve Target Twice (Idempotency)

```bash
# After successful approval in E.12
curl -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected Response** (200):

```json
{
  "ok": true,
  "targetId": "uuid-target-id",
  "postJobId": "uuid-postjob-id",
  "alreadyApproved": true // ← Indicates idempotent response
}
```

**DB State**:

```sql
-- Verify NO new ledger entries created
SELECT COUNT(*) FROM ledger_entries
WHERE "idempotencyKey" = 'escrow_hold:uuid-target-id';
-- Must show: 1 (not 2)

SELECT COUNT(*) FROM escrows
WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: 1 (not 2)

SELECT COUNT(*) FROM post_jobs
WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: 1 (not 2)

SELECT SUM(amount) FROM ledger_entries WHERE "campaignTargetId" = 'uuid-target-id';
-- Should be -50.00 (not -100.00 from double debit)
```

---

### Test N7: Advertiser Cannot Approve (403 Forbidden)

```bash
curl -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
  -H "Authorization: Bearer $ADVERTISER_TOKEN"
```

**Expected Response** (403):

```json
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}
```

---

## E.3 CONCURRENCY TESTS (Race Conditions)

### Test C1: Parallel Approve Calls

**Setup**: Target in submitted status

```bash
# Simulate two admins approving same target simultaneously
# (In bash: run both in background, background process)

# Admin 1
curl -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" &
ADMIN1_PID=$!

# Admin 2 (slight delay to increase race chance)
sleep 0.1
curl -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" &
ADMIN2_PID=$!

# Wait for both
wait $ADMIN1_PID $ADMIN2_PID

# Collect responses (in real test: capture HTTP responses)
```

**Expected Behavior**:

- First approve: 200 OK, postJobId = X
- Second approve: 200 OK, postJobId = X (same), alreadyApproved = true
- Both return same result (idempotent)

**DB State**:

```sql
-- No duplicate escrows
SELECT COUNT(*) FROM escrows WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: 1

-- No duplicate postjobs
SELECT COUNT(*) FROM post_jobs WHERE "campaignTargetId" = 'uuid-target-id';
-- Must show: 1

-- No double-debits
SELECT COUNT(*) FROM ledger_entries
WHERE "idempotencyKey" = 'escrow_hold:uuid-target-id';
-- Must show: 1

-- Wallet balance correct (single debit only)
SELECT balance FROM wallets WHERE "userId" = 'uuid-advertiser-id';
-- Must be: initialBalance - 50.00 (not -100.00)
```

---

### Test C2: Activate Campaign While Target Submit In Progress

**Hard to test without code instrumentation. Verify via:**

```sql
-- After campaign activated and multiple targets added/submitted:
SELECT
  COUNT(*) as total_submitted,
  COUNT(CASE WHEN status = 'submitted' THEN 1 END) as actually_submitted
FROM campaign_targets
WHERE "campaignId" = 'uuid-campaign-id';
-- Both should match (no corrupted state)

SELECT SUM(amount) FROM ledger_entries WHERE "campaignId" = 'uuid-campaign-id';
-- Should reflect all submitted targets correctly
```

---

## E.4 INTEGRATION: Complete Ledger Invariant Check

After all tests, verify total system invariant:

```sql
-- For each wallet, ledger must sum to balance
SELECT
  w.id,
  w."userId",
  w.balance,
  SUM(le.amount) as ledger_sum,
  (w.balance = SUM(le.amount)) as is_valid
FROM wallets w
LEFT JOIN ledger_entries le ON le."walletId" = w.id
GROUP BY w.id, w."userId", w.balance
HAVING (w.balance != SUM(le.amount));

-- Should return 0 rows (all wallets valid)
-- If rows returned: data corruption, alert immediately
```

---

## E.5 LOAD TEST (Optional, High Confidence)

```bash
# Generate 10 campaigns and 50 targets (all submitted)
# Approve sequentially (not in parallel to avoid rate limits)

for i in {1..10}; do
  # Create campaign
  CAM=$(curl -s -X POST http://localhost:3000/api/campaigns \
    -H "Authorization: Bearer $ADVERTISER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{ \"name\": \"Campaign $i\", \"totalBudget\": \"1000.00\" }" \
    | jq -r '.id')

  # Activate
  curl -s -X POST "http://localhost:3000/api/campaigns/$CAM/activate" \
    -H "Authorization: Bearer $ADVERTISER_TOKEN" > /dev/null

  # Create 5 targets
  for j in {1..5}; do
    TAR=$(curl -s -X POST "http://localhost:3000/api/campaigns/$CAM/targets" \
      -H "Authorization: Bearer $ADVERTISER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{ \"channelId\": \"$CHANNEL_ID\", \"price\": \"20.00\", \"scheduledAt\": \"$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)\" }" \
      | jq -r '.id')

    # Submit
    curl -s -X POST "http://localhost:3000/api/campaigns/$CAM/targets/$TAR/submit" \
      -H "Authorization: Bearer $ADVERTISER_TOKEN" > /dev/null

    echo "Campaign $i, Target $j submitted"
  done
done

# Now approve all 50 targets
echo "Approving 50 targets..."
curl -s http://localhost:3000/api/admin/moderation/pending \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq -r '.[].id' \
  | while read TARGET_ID; do
    curl -s -X POST "http://localhost:3000/api/admin/moderation/$TARGET_ID/approve" \
      -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
    echo "Approved: $TARGET_ID"
  done

echo "Load test complete. Verify:"
echo "  - 50 targets in 'approved' status"
echo "  - 50 escrows created"
echo "  - 50 postjobs created"
echo "  - No duplicates"
echo "  - Ledger invariant holds"
```

**Verify After Load Test**:

```sql
SELECT status, COUNT(*) FROM campaign_targets GROUP BY status;
-- Should show: 50 approved, X submitted (from other tests), etc.

SELECT COUNT(*) FROM escrows;
-- Should show >= 50

SELECT COUNT(*) FROM post_jobs;
-- Should show >= 50

SELECT COUNT(*) FROM (
  SELECT "campaignTargetId", COUNT(*) as cnt
  FROM escrows
  GROUP BY "campaignTargetId"
  HAVING cnt > 1
) dupes;
-- Should show: 0 rows (no duplicates)
```

---
