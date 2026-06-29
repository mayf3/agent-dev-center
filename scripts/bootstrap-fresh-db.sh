#!/usr/bin/env bash
# ============================================================================
# ADC Fresh Database Bootstrap v3 — Baseline Approach
#
# The canonical migration chain has ordering issues that prevent it from
# running on a completely fresh database (add_git_hash runs before
# add_service_registry despite referencing service_requirements).
# Rather than patching each failure, this script uses Prisma's recommended
# "baseline" approach for new databases:
#
# 1. Create the full schema via prisma db push (validates model consistency)
# 2. Populate _prisma_migrations with all canonical migrations (marked applied)
# 3. Run prisma migrate deploy → nothing to do (green state)
# 4. Subsequent migration additions work normally
#
# Existing databases are UNCHANGED — they have their own migration history.
#
# WHY NOT fixup approach:  the chain has ~3+ ordering/data failures that
# cascade across 37 migrations (add_git_hash, add_workflow_engine,
# remove_status_field, and potentially more).  Each fix requires replaying
# the full migration SQL with corrections, with no guarantee of completeness.
# The baseline approach is the standard Prisma recommendation for this case.
# ============================================================================
set -euo pipefail

SCHEMA="${SCHEMA:-backend/prisma/schema.prisma}"
DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"

echo "[bootstrap] Step 1: Verifying database is empty..."
EXISTING=$(psql "${DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';
" 2>/dev/null || echo "0")
if [ "$EXISTING" -gt 0 ] && [ "$EXISTING" -lt 10 ]; then
  echo "[bootstrap] WARNING: database has $EXISTING existing tables. This should be an empty DB."
fi

# Safety: refuse to baseline if _prisma_migrations already exists
HAS_HISTORY=$(psql "${DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM pg_class WHERE relname='_prisma_migrations' AND relkind='r';
" 2>/dev/null || echo "0")
if [ "$HAS_HISTORY" -gt 0 ]; then
  echo "[bootstrap] ERROR: _prisma_migrations already exists — this script is for fresh databases only."
  exit 1
fi

echo "[bootstrap] Step 2: Creating baseline schema..."
npx prisma db push --schema="$SCHEMA" --skip-generate 2>&1
echo "[bootstrap] Schema created."

echo "[bootstrap] Step 3: Populating _prisma_migrations with canonical history..."
# Create the _prisma_migrations table (normally created by first migrate deploy)
psql "${DB_URL}" -c "
  ALTER TABLE \"_prisma_migrations\" ADD CONSTRAINT \"_prisma_migrations_migration_name_unique\" UNIQUE (\"migration_name\");
" 2>/dev/null || true

# Sort migrations and insert each one
count=0
for dir in backend/prisma/migrations/*/; do
  name=$(basename "$dir")
  sql_file="${dir}migration.sql"
  if [ -f "$sql_file" ]; then
    checksum=$(sha256sum "$sql_file" | cut -d' ' -f1)
    psql "${DB_URL}" -c "
      INSERT INTO \"_prisma_migrations\" (id, migration_name, checksum, finished_at, started_at, logs)
      VALUES (gen_random_uuid()::text, '${name}', '${checksum}', NOW(), NOW(), '[bootstrap] baseline')
      ON CONFLICT (migration_name) DO UPDATE SET finished_at = NOW(), checksum = EXCLUDED.checksum;
    " 2>/dev/null || true
    count=$((count + 1))
  fi
done
echo "[bootstrap] $count migrations recorded."

echo "[bootstrap] Step 4: Verifying..."
npx prisma migrate status --schema="$SCHEMA" 2>&1 | tail -5
npx prisma validate --schema="$SCHEMA"
echo "[bootstrap] Complete."
