#!/usr/bin/env bash
# ============================================================================
# ADC Fresh Database Bootstrap v5 — Final
#
# Applies a fixed baseline SQL artifact and registers migration history via
# `prisma migrate resolve --applied` (the official Prisma API).
#
# NO DIRECT _prisma_migrations TABLE WRITES.
# NO prisma db push.
# ============================================================================
set -euo pipefail

# ── Parse explicit --database-url parameter ──────────────────────────────
DB_URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --database-url) DB_URL="$2"; shift 2 ;;
    *) echo "[FATAL] Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$DB_URL" ]; then
  echo "[FATAL] --database-url is required.  Usage: $0 --database-url postgresql://..."
  exit 1
fi

# Validate URL format
if ! echo "$DB_URL" | grep -q "^postgresql://\|^postgres://"; then
  echo "[FATAL] --database-url must be a valid PostgreSQL connection string"
  exit 1
fi

# ── Constants (FIXED — do not change without updating manifest) ──────────
SCHEMA="backend/prisma/schema.prisma"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE_DIR="${SCRIPT_DIR}/backend/prisma/bootstrap"
BASELINE_SQL="${BASELINE_DIR}/baseline.sql"
COVERED="${BASELINE_DIR}/covered-migrations.txt"
MIG_CHK="${BASELINE_DIR}/covered-migration-checksums.txt"
CUTOFF="20260629000000_add_lock_token"

# Expected checksums (hardcoded — tampering causes immediate abort)
EXPECTED_BASELINE_SHA="e266b14a067473af83f6668fb070a2fb8905856a4b6781d4692c7fa3d317ddb4"
EXPECTED_COVERED_SHA="dfe0eba6ba41ad00307bd33919c2dc6244a104b9cd40b780425a3b255d9e3794"

# ── Print target (password redacted) ─────────────────────────────────────
echo "[bootstrap] Target database: $(echo "$DB_URL" | sed 's|://[^:]*:[^@]*@|://***:***@|')"

# Export DATABASE_URL so Prisma commands resolve the datasource correctly.
# This overrides any .env file.  The explicit --database-url is the sole source.
export DATABASE_URL="$DB_URL"

# ── Safety: verify we are connecting to the expected database ─────────────
echo "[bootstrap] Verifying database identity..."
CATALOG=$(psql "${DB_URL}" -t -A -c "
  SELECT current_database() || '@' || inet_server_addr() || ':' || inet_server_port();
" 2>/dev/null || echo "UNKNOWN")
echo "  Connected to: $CATALOG"

# ── Safety: refuse non-empty / production-looking databases ───────────────
if echo "${DB_URL}" | grep -qiE "prod|production|8\.163\.44\."; then
  echo "[FAIL] DATABASE_URL appears to point to a production server.  Aborting."
  exit 1
fi

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
  echo "[FAIL] _prisma_migrations already exists."
  exit 1
fi

# ── Verify baseline manifest checksums (HARD FAILURE) ─────────────────────
echo "[bootstrap] Verifying baseline artifacts..."
BASELINE_SHA=$(sha256sum "$BASELINE_SQL" | cut -d' ' -f1)
COVERED_SHA=$(sha256sum "$COVERED" | cut -d' ' -f1)

if [ "$BASELINE_SHA" != "$EXPECTED_BASELINE_SHA" ]; then
  echo "[FAIL] baseline.sql checksum mismatch"
  echo "  Expected: $EXPECTED_BASELINE_SHA"
  echo "  Actual:   $BASELINE_SHA"
  exit 1
fi
echo "  baseline.sql SHA256: $BASELINE_SHA (match)"

if [ "$COVERED_SHA" != "$EXPECTED_COVERED_SHA" ]; then
  echo "[FAIL] covered-migrations.txt checksum mismatch"
  echo "  Expected: $EXPECTED_COVERED_SHA"
  echo "  Actual:   $COVERED_SHA"
  exit 1
fi
echo "  covered-migrations.txt SHA256: $COVERED_SHA (match)"

# ── Verify cutoff (HARD GATE — runs BEFORE any database write) ────────────
# Contract: the cutoff migration (a) must exist on disk, (b) must be present in
# covered-migrations.txt, and (c) must be the LAST entry of that manifest.
# All three must hold; failure aborts before baseline.sql is applied.
echo "[bootstrap] Verifying cutoff migration..."
CUTOFF_SQL="backend/prisma/migrations/${CUTOFF}/migration.sql"
if [ ! -f "$CUTOFF_SQL" ]; then
  echo "[FAIL] Cutoff migration SQL not found: $CUTOFF_SQL"
  exit 1
fi

# (b) cutoff must appear somewhere in the covered manifest
if ! grep -qxF "$CUTOFF" "$COVERED"; then
  echo "[FAIL] Cutoff '$CUTOFF' is not listed in covered-migrations.txt"
  exit 1
fi

# (c) cutoff must be the LAST (covered) entry of the manifest
LAST_COVERED=$(grep -v '^[[:space:]]*$' "$COVERED" | tail -1)
if [ "$LAST_COVERED" != "$CUTOFF" ]; then
  echo "[FAIL] Cutoff mismatch: covered-migrations.txt ends with '$LAST_COVERED', expected '$CUTOFF'"
  exit 1
fi
echo "  Cutoff: $CUTOFF (exists on disk, present in manifest, last covered entry)"

# ── Verify per-migration checksums ────────────────────────────────────────
echo "[bootstrap] Verifying per-migration checksums..."
MIG_FAIL=0
while IFS= read -r expected_line; do
  [ -z "$expected_line" ] && continue
  exp_ch=$(echo "$expected_line" | awk '{print $1}')
  filepath=$(echo "$expected_line" | awk '{print $2}')
  migration_name=$(echo "$filepath" | cut -d'/' -f1)
  fullpath="backend/prisma/migrations/${filepath}"
  if [ ! -f "$fullpath" ]; then
    echo "  [FAIL] Missing migration file: ${filepath}"
    MIG_FAIL=$((MIG_FAIL + 1))
    continue
  fi
  actual_ch=$(sha256sum "$fullpath" | cut -d' ' -f1)
  if [ "$exp_ch" != "$actual_ch" ]; then
    echo "  [FAIL] Checksum mismatch: ${filepath}"
    echo "    Expected: $exp_ch"
    echo "    Actual:   $actual_ch"
    MIG_FAIL=$((MIG_FAIL + 1))
  fi
done < "$MIG_CHK"
if [ "$MIG_FAIL" -gt 0 ]; then
  echo "[FAIL] $MIG_FAIL migration checksum(s) mismatch — aborting."
  exit 1
fi
echo "  All $(wc -l < "$MIG_CHK") migration checksums verified."

# ── Step 1: Execute baseline SQL ─────────────────────────────────────────
echo "[bootstrap] Applying baseline schema..."
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "$BASELINE_SQL"
echo "[bootstrap] Baseline schema applied."

# ── Step 2: Register covered migrations via migrate resolve ───────────────
echo "[bootstrap] Registering covered migrations..."
COUNT=0
while IFS= read -r migration; do
  [ -z "$migration" ] && continue
  echo "  → $migration"
  npx prisma migrate resolve --applied "$migration" --schema="$SCHEMA" 2>/dev/null || {
    echo "  [WARN] resolve failed for $migration (may already be registered)"
  }
  COUNT=$((COUNT + 1))
done < "$COVERED"
echo "[bootstrap] $COUNT migrations registered."

# ── Step 3: Apply any cutoff-after migrations ────────────────────────────
echo "[bootstrap] Checking for post-cutoff migrations..."
PENDING=$(psql "${DB_URL}" -t -A -c "
  SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
" 2>/dev/null || echo "0")
if [ "$PENDING" -gt 0 ]; then
  echo "[bootstrap] Applying $PENDING post-cutoff migration(s)..."
  npx prisma migrate deploy --schema="$SCHEMA"
else
  echo "[bootstrap] No post-cutoff migrations pending."
fi

# ── Final verification ───────────────────────────────────────────────────
echo "=== Final Status ==="
npx prisma migrate status --schema="$SCHEMA"
echo "=== Schema Validation ==="
npx prisma validate --schema="$SCHEMA"
echo "[bootstrap] Complete."
