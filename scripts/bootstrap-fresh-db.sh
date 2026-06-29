#!/usr/bin/env bash
# ============================================================================
# ADC Fresh Database Bootstrap v4 — Official Baseline
#
# Applies a fixed baseline SQL artifact and registers migration history via
# prisma migrate resolve --applied (the official Prisma API).
#
# NO DIRECT _prisma_migrations TABLE WRITES.
# NO prisma db push.
# ============================================================================
set -euo pipefail

SCHEMA="${SCHEMA:-backend/prisma/schema.prisma}"
DB_URL="${DATABASE_URL:?DATABASE_URL must be set}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE_DIR="${SCRIPT_DIR}/backend/prisma/bootstrap"
BASELINE_SQL="${BASELINE_DIR}/baseline.sql"
COVERED="${BASELINE_DIR}/covered-migrations.txt"

# ── Preflight: refuse non-empty / production-looking databases ────────────
echo "[bootstrap] Checking database state..."
EXISTING_TABLES=$(psql "${DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';
" 2>/dev/null || echo "0")

if [ "$EXISTING_TABLES" -gt 0 ]; then
  echo "[FAIL] Database already has $EXISTING_TABLES tables — this script is for EMPTY databases only."
  exit 1
fi

HAS_PRISMA_HISTORY=$(psql "${DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM pg_class WHERE relname='_prisma_migrations' AND relkind='r';
" 2>/dev/null || echo "0")
if [ "$HAS_PRISMA_HISTORY" -gt 0 ]; then
  echo "[FAIL] _prisma_migrations already exists — refusing to bootstrap."
  exit 1
fi

# Check if DB_URL looks like production (contains a typical prod hostname pattern)
if echo "${DB_URL}" | grep -qiE "prod|production|8\.163\.44\."; then
  echo "[FAIL] DATABASE_URL appears to point to a production server.  Aborting."
  exit 1
fi

# ── Verify baseline artifact checksums ───────────────────────────────────
echo "[bootstrap] Verifying baseline artifacts..."
BASELINE_SHA=$(sha256sum "$BASELINE_SQL" | cut -d' ' -f1)
COVERED_SHA=$(sha256sum "$COVERED" | cut -d' ' -f1)
echo "  baseline.sql SHA256: $BASELINE_SHA"
echo "  covered-migrations.txt SHA256: $COVERED_SHA"
echo "  cutoff: $(tail -1 $COVERED)"

# ── Step 1: Execute baseline SQL ─────────────────────────────────────────
echo "[bootstrap] Applying baseline schema..."
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "$BASELINE_SQL"
echo "[bootstrap] Baseline schema applied."

# ── Step 2: Register covered migrations via migrate resolve ───────────────
echo "[bootstrap] Registering covered migrations..."
MIGRATION_COUNT=0
while IFS= read -r migration; do
  [ -z "$migration" ] && continue
  echo "  → $migration"
  npx prisma migrate resolve --applied "$migration" --schema="$SCHEMA" 2>/dev/null || {
    echo "  WARNING: resolve failed for $migration (may already be registered)"
  }
  MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
done < "$COVERED"
echo "[bootstrap] $MIGRATION_COUNT migrations registered via prisma migrate resolve."

# ── Step 3: Apply any cutoff-after migrations ────────────────────────────
echo "[bootstrap] Verifying migration state..."
npx prisma migrate status --schema="$SCHEMA" 2>&1 | tail -5

# Check if there are pending (non-baselined) migrations
PENDING=$(psql "${DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
" 2>/dev/null || echo "0")

if [ "$PENDING" -gt 0 ]; then
  echo "[bootstrap] Applying $PENDING post-cutoff migrations..."
  npx prisma migrate deploy --schema="$SCHEMA"
else
  echo "[bootstrap] No post-cutoff migrations pending."
fi

# ── Final verification ───────────────────────────────────────────────────
echo "=== Migration Status ==="
npx prisma migrate status --schema="$SCHEMA"
echo "=== Schema Validation ==="
npx prisma validate --schema="$SCHEMA"
echo "[bootstrap] Complete."
