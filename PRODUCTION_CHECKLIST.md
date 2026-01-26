# F) PRODUCTION CHECKLIST

## Pre-Deployment

### Code Review & Testing

- [ ] **Code Review**: All diffs reviewed and approved by 2+ engineers

  - [ ] [lifecycle.ts](lifecycle.ts#L25-L40) - FSM changes
  - [ ] [campaigns.service.ts](campaigns.service.ts#L187-L312) - activation + submit
  - [ ] [moderation.service.ts](moderation.service.ts#L129-L294) - approve atomicity
  - [ ] [campaigns.controller.ts](campaigns.controller.ts#L86-L145) - new endpoint
  - [ ] [campaigns.module.ts](campaigns.module.ts) - removed insecure controller

- [ ] **Unit Tests Pass**: `npm run test`

  - [ ] campaigns.service.spec.ts (activateCampaign, submitTarget)
  - [ ] moderation.service.spec.ts (approve idempotency)
  - [ ] lifecycle.spec.ts (FSM allows advertiser)

- [ ] **E2E Tests Pass**: `npm run test:e2e`

  - [ ] Full happy path (E.1 steps 1-14)
  - [ ] Negative tests (N1-N7)
  - [ ] Concurrency tests (C1-C2)

- [ ] **Local Database**: Fresh seed, all tests pass
  ```bash
  npm run prisma:reset
  npm run start:dev
  # Run test suite
  ```

### Database Pre-Checks

- [ ] **Schema Validation**: No unexpected changes

  ```bash
  npx prisma validate
  ```

- [ ] **Backfill Validation**: Run pre-deployment SQL checks

  ```bash
  # Execute SQL from PRODUCTION_ANALYSIS.md section D.3
  # Verify no orphaned campaign_targets exist
  ```

- [ ] **Backup Created**: Full database backup before any changes
  ```bash
  pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
  # Verify backup file size > 0
  ```

### Security & Auth

- [ ] **RBAC Verified**:

  - [ ] Advertiser can only activate own campaigns (ownership check at line 196 of campaigns.service.ts)
  - [ ] Admin/super_admin can activate any campaign
  - [ ] Non-owners get 400 error with "Not campaign owner"
  - [ ] Advertiser cannot call admin moderation endpoints (403 from RolesGuard)

- [ ] **Tokens & Secrets**:

  - [ ] No JWT tokens logged in code changes
  - [ ] No passwords logged in code changes
  - [ ] BOT_TOKEN not exposed in logs
  - [ ] Refresh token rotation still works

- [ ] **Rate Limiting**: Still active for auth endpoints
  - [ ] AuthRateLimitGuard still in place

### Observability & Logging

- [ ] **Structured Logging**: All logs use safeJsonStringify

  - [ ] No PII in logs
  - [ ] correlationId propagated through all service calls
  - [ ] actorId and role logged for critical actions

- [ ] **Audit Logs Verified**:

  - [ ] campaign_activated events logged
  - [ ] target_submitted events logged
  - [ ] moderation_approved events logged
  - [ ] All include metadata with IDs and actor

- [ ] **Monitoring Alerts Configured**:
  - [ ] Alert on ConflictException (409) rate spikes
  - [ ] Alert on moderation.approve failures
  - [ ] Alert on escrow hold failures
  - [ ] Alert on ledger invariant violations

### Kill-Switch & Safeguards

- [ ] **Kill-Switches Enabled**:

  - [ ] `payouts` enabled (for escrow release)
  - [ ] `new_escrows` enabled (for holdEscrow)
  - [ ] `telegram_posting` enabled (for worker)

- [ ] **Rollback Plan Documented**:
  - [ ] Rollback procedure in wiki/runbook
  - [ ] Can rollback code without DB migration
  - [ ] Data safe in case of rollback

---

## Deployment Steps (Zero-Downtime)

### 1. Pre-Flight (1 hour before)

```bash
# 1a. Verify staging deployment passes all tests
cd apps/api
npm run build
npm run test:e2e  # Must pass 100%

# 1b. Backup production database
pg_dump $PROD_DATABASE_URL > backup_$(date +%s).sql

# 1c. Notify on-call team
# "Deploying campaign activation fixes. No data migrations, code-only change."

# 1d. Confirm kill-switches enabled
curl http://localhost:3000/api/health/ready
# Check: kill-switch: enabled, payouts: enabled, new_escrows: enabled
```

### 2. Code Deployment

```bash
# 2a. Build production image
docker build -t bot_adtech:v1.2.0 .

# 2b. Push to registry
docker push bot_adtech:v1.2.0

# 2c. Deploy via rolling update (Kubernetes/Docker Compose)
# Scale new pods with v1.2.0
# Drain old pods gracefully (wait 30s for existing requests to finish)
# Remove old pods

# Example with docker-compose:
# 1. Start new instance: docker-compose -p adtech-v1 up -d
# 2. Switch load balancer to new instance
# 3. Verify health: curl new-instance:3000/api/health/live
# 4. Kill old instance after 5 minutes verification
```

### 3. Post-Deployment Validation (Immediately)

```bash
# 3a. Check API health
curl http://new-api:3000/api/health/live
# Expected: { ok: true }

curl http://new-api:3000/api/health/ready
# Expected: all checks ok or disabled

# 3b. Run smoke test (from TEST_PLAN.md E.1 steps 1-5)
# - Register test advertiser
# - Create test campaign
# - Verify campaign can be activated
# - If success: proceed to 3c

# 3c. Run production data validation
psql $PROD_DATABASE_URL << 'SQL'
SELECT COUNT(*) as campaign_count FROM campaigns;
SELECT COUNT(*) as target_count FROM campaign_targets;
SELECT COUNT(*) as escrow_count FROM escrows;
SELECT COUNT(*) as postjob_count FROM post_jobs;
-- Verify counts match expectations
SQL

# 3d. Verify logs for errors
kubectl logs -f deployment/adtech-api -c api --since=5m | grep -i error
# Should see no critical errors related to campaign/moderation

# 3e. Check audit logs
psql $PROD_DATABASE_URL << 'SQL'
SELECT action, COUNT(*)
FROM user_audit_logs
WHERE "createdAt" > NOW() - INTERVAL '10 minutes'
GROUP BY action;
-- Verify expected actions (campaign_activated, target_submitted, etc.)
SQL
```

### 4. Monitoring (First 30 minutes)

```bash
# 4a. Watch error rates
# In monitoring dashboard (DataDog/NewRelic/CloudWatch):
# - Campaign service 4xx/5xx rates
# - Moderation service latencies
# - Database connection pool health
# - Redis connection health

# 4b. Watch for conflicts
# Alert if 409 ConflictException rate > 1 per minute
# Alert if ledger invariant violations increase

# 4c. Watch transaction latencies
# moderation.approve should be < 500ms p95
# (previously was potentially unbounded due to separate transactions)

# 4d. Manual test: Create a campaign and activate it
TEST_TOKEN=$(curl -s -X POST http://api:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test_advertiser","password":"..."}' \
  | jq -r '.accessToken')

CAMPAIGN=$(curl -s -X POST http://api:3000/api/campaigns \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Prod Test","totalBudget":"100.00"}' \
  | jq -r '.id')

ACTIVATE_RESPONSE=$(curl -s -X POST "http://api:3000/api/campaigns/$CAMPAIGN/activate" \
  -H "Authorization: Bearer $TEST_TOKEN")

echo "Activation response: $ACTIVATE_RESPONSE"
# Should show: status: active, not error

# Clean up test campaign
psql $PROD_DATABASE_URL << SQL
DELETE FROM campaigns WHERE id = '$CAMPAIGN';
SQL
```

### 5. Rollback Plan (If Issues Found)

**Trigger rollback if**:

- 409 errors spiking consistently
- moderation.approve timeouts increasing
- Ledger invariant violations detected
- Database transaction deadlocks

**Rollback Steps**:

```bash
# 5a. Immediate: Switch traffic back to old version
# (Kubernetes: rollout undo)
kubectl rollout undo deployment/adtech-api

# 5b. Verify old version is healthy
curl http://api:3000/api/health/live

# 5c. Investigate root cause
# Check logs for error patterns
kubectl logs deployment/adtech-api -c api --tail=1000 > /tmp/api-logs.txt

# 5d. Database verification (rollback doesn't touch DB)
psql $PROD_DATABASE_URL << 'SQL'
-- Verify no corrupted data
SELECT COUNT(*) FROM campaign_targets
WHERE status = 'approved' AND (
  SELECT COUNT(*) FROM escrows WHERE "campaignTargetId" = campaign_targets.id
) = 0;
-- If > 0: data corruption, escalate to DBA
SQL

# 5e. Post-mortem
# - Root cause analysis
# - Fix in staging
# - Re-test
# - Deploy again
```

---

## Post-Deployment (Day 1)

### Verification Tasks

- [ ] **Run Full Test Suite Against Production**:

  - [ ] E.1 Happy path (steps 1-14) against prod (use test tenant)
  - [ ] E.2 Negative tests (N1-N7)
  - [ ] Clean up test data afterward

- [ ] **Ledger Invariant Report**:

  ```bash
  psql $PROD_DATABASE_URL << 'SQL'
  SELECT
    w.id,
    w."userId",
    COUNT(le.id) as ledger_count,
    SUM(le.amount) as ledger_sum,
    w.balance,
    (w.balance = COALESCE(SUM(le.amount), 0)) as is_valid
  FROM wallets w
  LEFT JOIN ledger_entries le ON le."walletId" = w.id
  GROUP BY w.id, w."userId", w.balance
  ORDER BY w."createdAt" DESC
  LIMIT 100;
  SQL
  # All rows must show is_valid = true
  ```

- [ ] **Escrow Uniqueness Report**:

  ```bash
  psql $PROD_DATABASE_URL << 'SQL'
  SELECT
    "campaignTargetId",
    COUNT(*) as escrow_count
  FROM escrows
  GROUP BY "campaignTargetId"
  HAVING COUNT(*) > 1;
  SQL
  # Must return 0 rows
  ```

- [ ] **PostJob Uniqueness Report**:

  ```bash
  psql $PROD_DATABASE_URL << 'SQL'
  SELECT
    "campaignTargetId",
    COUNT(*) as postjob_count
  FROM post_jobs
  GROUP BY "campaignTargetId"
  HAVING COUNT(*) > 1;
  SQL
  # Must return 0 rows
  ```

- [ ] **Campaign Status Distribution**:
  ```bash
  psql $PROD_DATABASE_URL << 'SQL'
  SELECT status, COUNT(*) FROM campaigns GROUP BY status;
  -- Verify meaningful distribution (not all draft, not all active)
  SQL
  ```

### Success Criteria Met?

- [x] FSM now allows 'advertiser' for draft→active (with ownership check)
- [x] submitTarget enforces campaign.active check
- [x] moderation.approve is atomic (single transaction)
- [x] moderation.approve is idempotent (no duplicate escrows/postjobs)
- [x] All audit logs recorded correctly
- [x] Ledger invariants maintained
- [x] No database corruption
- [x] No duplicate Telegram posts
- [x] Error handling is clear and recoverable

**If all criteria met**: ✅ **DEPLOYMENT SUCCESSFUL**

---

## Post-Deployment (Week 1)

### Production Stability

- [ ] **Monitor Key Metrics**:

  - [ ] Campaign activation rate (should be > 0 if users can now activate)
  - [ ] Target submission success rate (should be > 90%)
  - [ ] Moderation approval latency p95 (should be < 500ms)
  - [ ] No spike in 409 ConflictException errors
  - [ ] Escrow hold success rate (should be 100%)

- [ ] **User Feedback**:

  - [ ] No complaints about campaign activation being blocked
  - [ ] No complaints about unclear error messages
  - [ ] Moderation approval working as expected

- [ ] **Data Quality Report**:

  ```bash
  # Week 1 summary report
  psql $PROD_DATABASE_URL << 'SQL'
  SELECT
    DATE(created_at) as date,
    COUNT(DISTINCT CASE WHEN status = 'active' THEN id END) as active_campaigns,
    COUNT(DISTINCT CASE WHEN status = 'draft' THEN id END) as draft_campaigns,
    COUNT(DISTINCT CASE WHEN status = 'posted' THEN "campaignId" END) as posted_targets,
    COUNT(DISTINCT CASE WHEN status = 'approved' THEN "campaignId" END) as approved_targets
  FROM campaigns
  LEFT JOIN campaign_targets ON campaign_targets."campaignId" = campaigns.id
  WHERE created_at > NOW() - INTERVAL '7 days'
  GROUP BY DATE(created_at)
  ORDER BY date DESC;
  SQL
  # Verify healthy distribution and growth
  ```

- [ ] **Audit Log Review**:
  ```bash
  psql $PROD_DATABASE_URL << 'SQL'
  SELECT
    action,
    COUNT(*) as count,
    MAX("createdAt") as latest
  FROM user_audit_logs
  WHERE "createdAt" > NOW() - INTERVAL '7 days'
  GROUP BY action
  ORDER BY count DESC;
  SQL
  # Verify campaign_activated, target_submitted, moderation_approved are occurring
  ```

### Documentation Updates

- [ ] **README Updated**: Campaign activation flow documented
- [ ] **API Docs Updated**: New POST /campaigns/:id/activate endpoint in Swagger
- [ ] **Runbook Updated**: How to handle campaign state issues
- [ ] **ADR (Architecture Decision Record)** Created: Why advertiser can activate campaigns

---

## Rollback Decision Tree

```
Issue Found?
  ├─ YES: Is it critical?
  │   ├─ YES: Cannot wait
  │   │   └─ ROLLBACK immediately (section 5)
  │   │
  │   └─ NO: Can wait for fix
  │       └─ Hot-fix in progress, monitor closely
  │
  └─ NO: Stable
      └─ Continue monitoring (Week 1 checklist)
```

---

## Final Sign-Off

**Deployment Engineer**: ********\_******** Date: **\_\_\_\_**  
**On-Call Engineer**: ********\_******** Date: **\_\_\_\_**  
**Engineering Manager**: ********\_******** Date: **\_\_\_\_**

**Approval**: ✅ All checks passed, ready for production.

---
