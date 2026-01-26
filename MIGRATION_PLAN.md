# E) MIGRATION PLAN

## Pre-Migration Checklist

1. **Backup Production Database**

   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%s).sql
   ```

2. **Verify Current State**
   ```bash
   # In Postgres, ensure no orphaned escrows/postjobs exist
   SELECT ct.id, e.id as escrow_id, pj.id as postjob_id
   FROM campaign_targets ct
   LEFT JOIN escrows e ON e."campaignTargetId" = ct.id
   LEFT JOIN post_jobs pj ON pj."campaignTargetId" = ct.id
   WHERE ct.status = 'approved'
   AND (e.id IS NULL OR pj.id IS NULL);
   # Should return EMPTY. If rows returned, manual recovery needed.
   ```

## Schema Migration (Already Compliant)

The schema already has correct unique constraints:

- `Escrow.campaignTargetId @unique`
- `PostJob.campaignTargetId @unique`
- `LedgerEntry.idempotencyKey @unique`

**No Prisma schema migration is needed.** The constraints were pre-emptively added to schema.

If you want to validate constraint existence:

```bash
cd apps/api
npm run prisma:validate
# Or use: npx prisma validate
```

## Dev Environment Migration

```bash
cd apps/api

# 1. Reset dev database (ONLY for development/testing)
npm run prisma:reset
# This runs:
# - Drop database schema
# - Create fresh schema
# - Run all migrations
# - Run seed script

# Alternative: Migrate without reset
npm run prisma:migrate:dev -- --name "add_missing_constraints"
# If Prisma detects drift/changes, it will prompt to create a migration
```

## Production Deployment Migration

```bash
# 1. Verify current migration state
npm run prisma:migrate:status

# Expected output:
# Database: 3 migration(s) found in prisma/migrations
# Local: 3 migration(s) found in prisma/migrations
# Status: In sync ✓

# 2. If status shows drift, investigate
# Example: If a migration file was edited or deleted
npm run prisma:migrate:resolve -- --rolled-back <migration_id>

# 3. Deploy migrations (safe, read-only validation first)
npm run prisma:migrate:deploy

# This will:
# - Validate all migration files haven't changed
# - Apply any unapplied migrations to production database
# - Update _prisma_migrations table

# 4. Verify successful deployment
# Check logs or dashboard to confirm:
# - No migration errors
# - All migration_lock.toml entries applied
```

## Rollback Plan (If Needed)

Prisma does not support automatic rollbacks. If deployment fails:

```bash
# 1. Stop the application immediately
# 2. Restore from backup
pg_restore -d $DATABASE_URL backup_*.sql

# 3. Investigate the issue
# 4. Fix code
# 5. Re-run migrations
npm run prisma:migrate:deploy
```

## Post-Migration Validation

```bash
# 1. Check that new code paths work
curl -X POST http://localhost:4002/api/campaigns/$CAMPAIGN_ID/activate \
  -H "Authorization: Bearer $ADVERTISER_TOKEN" \
  -H "Content-Type: application/json"

# 2. Verify state consistency
SELECT
  ct.id,
  ct.status,
  COUNT(e.id) as escrow_count,
  COUNT(pj.id) as postjob_count
FROM campaign_targets ct
LEFT JOIN escrows e ON e."campaignTargetId" = ct.id
LEFT JOIN post_jobs pj ON pj."campaignTargetId" = ct.id
WHERE ct.status IN ('approved', 'posted')
GROUP BY ct.id
HAVING COUNT(e.id) != 1 OR COUNT(pj.id) != 1;
# Should return EMPTY (all approved targets have exactly 1 escrow and 1 postjob)

# 3. Verify duplicates don't exist
SELECT "campaignTargetId", COUNT(*)
FROM escrows
GROUP BY "campaignTargetId"
HAVING COUNT(*) > 1;
# Should return EMPTY

SELECT "campaignTargetId", COUNT(*)
FROM post_jobs
GROUP BY "campaignTargetId"
HAVING COUNT(*) > 1;
# Should return EMPTY
```

---
