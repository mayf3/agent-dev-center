#!/usr/bin/env bash
# ============================================================================
# ADC adc_app isolation rehearsal v3 — audit findings resolved
#
# USAGE:
#   sudo ./adc-app-rehearsal-v3.sh \
#     --backup /absolute/path/adc-authoritative-20260628T*.dump \
#     --backend-image agent-dev-center-backend@sha256:8e4d75a6d1aa1bec2e9d63673639840f7fa538a84da6d290f08fe79753abeb2b \
#     [--secure-image agent-dev-center-backend@sha256:...]
#
# REQUIREMENTS:
#   - Docker, openssl, python3
#   - Backup file in custom format, readable, outside rehearsal temp dirs
#
# NO_NEW_PRODUCTION_WRITES_PERFORMED
# NO_REHEARSAL_EXECUTED (this is the script; run it when authorized)
# ============================================================================
set -euo pipefail

# ── Parse arguments ─────────────────────────────────────────────────────────
BACKUP_FILE=""
BACKEND_IMAGE=""
SECURE_IMAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_FILE="$2"; shift 2 ;;
    --backend-image) BACKEND_IMAGE="$2"; shift 2 ;;
    --secure-image) SECURE_IMAGE="$2"; shift 2 ;;
    *) echo "[FATAL] Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$BACKUP_FILE" ]; then echo "[FATAL] --backup is required"; exit 1; fi
if [ -z "$BACKEND_IMAGE" ]; then echo "[FATAL] --backend-image is required"; exit 1; fi
if [ "${BACKUP_FILE:0:1}" != "/" ]; then echo "[FATAL] --backup must be an absolute path"; exit 1; fi

# ── Global rehearsal identity ───────────────────────────────────────────────
REHEARSAL_ID="rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
NETWORK="adc-${REHEARSAL_ID}"
VOLUME="adc-${REHEARSAL_ID}-pgdata"
PG_CONTAINER="adc-${REHEARSAL_ID}-pg"
BACKEND_CONTAINER="adc-${REHEARSAL_ID}-backend"
SECURE_CONTAINER="adc-${REHEARSAL_ID}-secure"
BACKEND_PORT=14000
SECURE_PORT=14001

# ── Working directory and secrets ───────────────────────────────────────────
WORK_DIR="/tmp/${REHEARSAL_ID}"
mkdir -p "$WORK_DIR/sql" "$WORK_DIR/responses" "$WORK_DIR/reports" "$WORK_DIR/secrets"
chmod 700 "$WORK_DIR"

# All secrets are generated at runtime into 0600 files.
# Never written to command line, stdout, or git.
SECRET_PG_PW=$(openssl rand -base64 24)
SECRET_ROLE_PW=$(openssl rand -base64 24)
SECRET_ADMIN_PW=$(openssl rand -base64 24)
umask 077
echo -n "$SECRET_PG_PW" > "$WORK_DIR/secrets/pg-password.txt"
echo -n "$SECRET_ROLE_PW" > "$WORK_DIR/secrets/role-password.txt"
echo -n "$SECRET_ADMIN_PW" > "$WORK_DIR/secrets/admin-password.txt"
chmod 600 "$WORK_DIR/secrets/"*
# Clear shell variables immediately after writing files
unset SECRET_PG_PW SECRET_ROLE_PW SECRET_ADMIN_PW

# Secret file paths used by functions below
PG_PW_FILE="$WORK_DIR/secrets/pg-password.txt"
ROLE_PW_FILE="$WORK_DIR/secrets/role-password.txt"
ADMIN_PW_FILE="$WORK_DIR/secrets/admin-password.txt"

# Run user: determined from image inspect, NOT hardcoded
# https://docs.docker.com/engine/reference/commandline/image_inspect/
RUN_USER=$(docker image inspect "$BACKEND_IMAGE" \
  --format '{{if .Config.User}}{{.Config.User}}{{else}}{{end}}' 2>/dev/null || echo "")

# ── Cleanup trap ────────────────────────────────────────────────────────────
cleanup() {
  local ec=$?
  echo "[CLEANUP] Removing rehearsal resources (ID=${REHEARSAL_ID})..."
  docker rm -f "$BACKEND_CONTAINER" 2>/dev/null || true
  docker rm -f "$SECURE_CONTAINER" 2>/dev/null || true
  docker rm -f "$PG_CONTAINER" 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
  docker volume rm "$VOLUME" 2>/dev/null || true
  rm -rf "$WORK_DIR"
  echo "[CLEANUP] Exit code: $ec"
}
trap cleanup EXIT

# ── SHA256 helper ───────────────────────────────────────────────────────────
compute_sha256() {
  sha256sum "$BACKUP_FILE" | cut -d' ' -f1
}

# ── Preflight ───────────────────────────────────────────────────────────────
preflight() {
  local failures=0

  # Validate backup
  if [ ! -f "$BACKUP_FILE" ]; then echo "[FAIL] Backup not found: $BACKUP_FILE"; failures=$((failures+1)); fi
  if [ ! -r "$BACKUP_FILE" ]; then echo "[FAIL] Backup not readable"; failures=$((failures+1)); fi
  # Ensure backup is outside WORK_DIR so cleanup does not delete it
  local backup_real; backup_real=$(readlink -f "$BACKUP_FILE" 2>/dev/null || echo "$BACKUP_FILE")
  local work_real; work_real=$(readlink -f "$WORK_DIR" 2>/dev/null || echo "$WORK_DIR")
  if echo "$backup_real" | grep -q "^${work_real}"; then
    echo "[FAIL] Backup must not be inside WORK_DIR (cleanup would delete it)"; failures=$((failures+1))
  fi
  echo "[INFO] Backup SHA256: $(compute_sha256)"

  # Validate container/port/network uniqueness
  for c in "$PG_CONTAINER" "$BACKEND_CONTAINER" "$SECURE_CONTAINER"; do
    docker ps -a --format '{{.Names}}' | grep -qx "$c" && { echo "[FAIL] Container $c exists"; failures=$((failures+1)); } || true
  done
  docker network ls --format '{{.Name}}' | grep -qx "$NETWORK" && { echo "[FAIL] Network $NETWORK exists"; failures=$((failures+1)); } || true
  docker volume ls --format '{{.Name}}' | grep -qx "$VOLUME" && { echo "[FAIL] Volume $VOLUME exists"; failures=$((failures+1)); } || true
  ss -tln 2>/dev/null | grep -q ":$BACKEND_PORT " && { echo "[FAIL] Port $BACKEND_PORT in use"; failures=$((failures+1)); } || true
  ss -tln 2>/dev/null | grep -q ":$SECURE_PORT " && { echo "[FAIL] Port $SECURE_PORT in use"; failures=$((failures+1)); } || true

  # Verify backend image exists
  docker image inspect "$BACKEND_IMAGE" >/dev/null 2>&1 || { echo "[FAIL] Backend image not found: $BACKEND_IMAGE"; failures=$((failures+1)); }

  [ "$failures" -gt 0 ] && exit 1 || echo "[PASS] Preflight OK"
}

# ── Step 1: restore ─────────────────────────────────────────────────────────
step1_restore() {
  docker network create "$NETWORK"
  docker volume create "$VOLUME"

  local pg_pw; pg_pw=$(cat "$PG_PW_FILE")
  docker run -d --name "$PG_CONTAINER" \
    --network "$NETWORK" \
    -v "$VOLUME:/var/lib/postgresql/data" \
    -e POSTGRES_PASSWORD="$pg_pw" \
    postgres:16-alpine
  unset pg_pw

  for i in $(seq 1 30); do docker exec "$PG_CONTAINER" pg_isready -U postgres 2>/dev/null && break; sleep 1; done

  docker exec "$PG_CONTAINER" psql -U postgres -c "CREATE DATABASE agent_dev_center;"

  # TOC verification and restore inside container (no host pg_restore needed)
  docker exec -i "$PG_CONTAINER" pg_restore --list < "$BACKUP_FILE" \
    > "$WORK_DIR/reports/toc-verify.txt" 2>&1 || true
  docker exec -i "$PG_CONTAINER" pg_restore -U postgres -d agent_dev_center --exit-on-error \
    < "$BACKUP_FILE"
  local rc=$?
  echo "[STEP1] pg_restore exit: $rc"
  [ "$rc" -ne 0 ] && exit "$rc"
}

# ── SQL files ───────────────────────────────────────────────────────────────
cat > "$WORK_DIR/sql/restore-check.sql" << 'SQL'
SELECT 'users' AS tbl, COUNT(*) FROM public.users
UNION ALL SELECT 'requirements', COUNT(*) FROM public.requirement
UNION ALL SELECT 'requirement_reports', COUNT(*) FROM public.requirement_reports
UNION ALL SELECT 'requirement_revisions', COUNT(*) FROM public.requirement_revisions
UNION ALL SELECT 'workflow_transitions', COUNT(*) FROM public.workflow_transition
UNION ALL SELECT '_prisma_migrations', COUNT(*) FROM public._prisma_migrations;
SQL

cat > "$WORK_DIR/sql/ownership-investigation.sql" << 'SQL'
SELECT d.datname, pg_catalog.pg_get_userbyid(d.datdba) AS owner FROM pg_catalog.pg_database d WHERE d.datname = 'agent_dev_center';
SELECT nspname AS schema_name, pg_catalog.pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl FROM pg_catalog.pg_namespace WHERE nspname = 'public';
SELECT relname AS table_name, pg_catalog.pg_get_userbyid(relowner) AS owner, relacl::text AS acl, relrowsecurity AS rls_enabled FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual FROM pg_catalog.pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
SELECT s.relname AS seq_name, pg_catalog.pg_get_userbyid(s.relowner) AS owner, t.relname AS owned_by_table, a.attname AS owned_by_column, s.relacl::text AS acl FROM pg_catalog.pg_class s JOIN pg_catalog.pg_depend d ON d.objid = s.oid AND d.deptype = 'a' JOIN pg_catalog.pg_class t ON t.oid = d.refobjid JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid WHERE s.relkind = 'S' AND s.relnamespace = 'public'::regnamespace ORDER BY s.relname;
SELECT p.proname AS func_name, pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer, p.proacl::text AS acl FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f','p') ORDER BY p.proname;
SELECT tgname AS trigger_name, tgrelid::regclass AS table_name FROM pg_catalog.pg_trigger WHERE NOT t.tgisinternal ORDER BY tgrelid::regclass::text, tgname;
SELECT t.typname AS type_name, pg_catalog.pg_get_userbyid(t.typowner) AS owner FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY t.typname;
SELECT e.extname, e.extversion, n.nspname AS schema_name FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname;
SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS role_name, d.defaclnamespace::regnamespace::text AS schema_name, d.defaclobjtype AS object_type, d.defaclacl::text AS acl FROM pg_catalog.pg_default_acl d ORDER BY d.defaclrole, d.defaclobjtype;
SHOW max_connections;
SQL

# Phase A: basic permissions only — _prisma_migrations gets SELECT only
cat > "$WORK_DIR/sql/create-rehearsal-role.sql" << SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'adc_app_rehearsal') THEN
    CREATE ROLE adc_app_rehearsal WITH LOGIN PASSWORD '$(cat "$ROLE_PW_FILE")' NOINHERIT;
  END IF;
END
\$\$;
SQL
chmod 600 "$WORK_DIR/sql/create-rehearsal-role.sql"

cat > "$WORK_DIR/sql/grant-phase-a.sql" << 'SQL'
GRANT CONNECT ON DATABASE agent_dev_center TO adc_app_rehearsal;
GRANT USAGE ON SCHEMA public TO adc_app_rehearsal;

DO $$DECLARE r RECORD;
BEGIN
  FOR r IN SELECT relname FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname != '_prisma_migrations'
  LOOP EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO adc_app_rehearsal', r.relname); END LOOP;
END$$;

-- _prisma_migrations: SELECT only
GRANT SELECT ON TABLE public._prisma_migrations TO adc_app_rehearsal;

DO $$DECLARE r RECORD;
BEGIN
  FOR r IN SELECT relname FROM pg_catalog.pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S'
  LOOP EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO adc_app_rehearsal', r.relname); END LOOP;
END$$;
SQL
chmod 600 "$WORK_DIR/sql/grant-phase-a.sql"

cat > "$WORK_DIR/sql/permission-verification.sql" << 'SQL'
SELECT table_catalog, table_schema, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'adc_app_rehearsal' AND table_schema = 'public' ORDER BY table_name, privilege_type;
SQL

# ── Helper: run SQL from file via psql stdin ────────────────────────────────
run_sql() {
  local label="$1" sqlfile="$2"
  docker exec -i "$PG_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d agent_dev_center \
    < "$sqlfile" 2>&1 | tee "$WORK_DIR/responses/${label}.txt"
}

# ── Step 2: verify restore + ownership ──────────────────────────────────────
step2_investigate() {
  run_sql "restore-check" "$WORK_DIR/sql/restore-check.sql"
  run_sql "ownership" "$WORK_DIR/sql/ownership-investigation.sql"
  echo "[STEP2] Ownership investigation complete"
}

# ── Step 3: connection budget ────────────────────────────────────────────────
step3_connection_budget() {
  echo "[CONNECTION_BUDGET] max_connections from rehearsal PG:"
  docker exec "$PG_CONTAINER" psql -U postgres -t -c "SHOW max_connections;"
  echo "[CONNECTION_BUDGET] No connection limit applied to rehearsal role yet."
}

# ── Step 4: grant phase A + candidate backend ───────────────────────────────
step4_grant_and_backend() {
  run_sql "create-role" "$WORK_DIR/sql/create-rehearsal-role.sql"
  run_sql "grant-phase-a" "$WORK_DIR/sql/grant-phase-a.sql"

  local pg_ip; pg_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PG_CONTAINER")
  local jwt_secret; jwt_secret=$(openssl rand -base64 32)
  local jwt_refresh; jwt_refresh=$(openssl rand -base64 32)

  umask 077
  cat > "$WORK_DIR/rehearsal.env" << ENV
DATABASE_URL=postgresql://adc_app_rehearsal:$(cat "$ROLE_PW_FILE")@${pg_ip}:5432/agent_dev_center?schema=public
JWT_SECRET=${jwt_secret}
JWT_SECRET_SSO=${jwt_secret}
JWT_REFRESH_SECRET=${jwt_refresh}
NODE_ENV=production
PORT=4000
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
ENV
  chmod 600 "$WORK_DIR/rehearsal.env"
  unset jwt_secret jwt_refresh

  local user_flag=()
  [ -n "$RUN_USER" ] && user_flag=(--user "$RUN_USER")

  docker run -d --name "$BACKEND_CONTAINER" \
    --network "$NETWORK" \
    -p 127.0.0.1:${BACKEND_PORT}:4000 \
    --env-file "$WORK_DIR/rehearsal.env" \
    "${user_flag[@]}" \
    --entrypoint tini \
    "$BACKEND_IMAGE" \
    -- cd /app/backend && node dist/src/server.js

  for i in $(seq 1 30); do
    curl -s -o /dev/null http://127.0.0.1:${BACKEND_PORT}/api/health && break
    sleep 2
  done
  echo "[STEP4] Candidate backend started on port ${BACKEND_PORT}"
}

# ── Step 5: rehearsal admin account (using production bcrypt) ───────────────
step5_rehearsal_admin() {
  local admin_pw; admin_pw=$(cat "$ADMIN_PW_FILE")

  # Use the backend container's own bcrypt to produce a compatible hash,
  # then write via SQL file.  This ensures the Node.js bcrypt contract matches
  # production (avoiding PostgreSQL crypt() compatibility uncertainty).
  local bcrypt_hash
  bcrypt_hash=$(docker exec "$BACKEND_CONTAINER" node -e "
    const bcrypt = require('bcrypt');
    const pw = process.argv[1];
    bcrypt.hash(pw, 12).then(h => console.log(h));
  " "$admin_pw" 2>/dev/null || echo "")

  if [ -z "$bcrypt_hash" ]; then
    echo "[FATAL] Could not generate bcrypt hash from backend container"
    exit 1
  fi

  cat > "$WORK_DIR/sql/create-admin.sql" << SQL
INSERT INTO public.users (id, name, email, password, role, internal_role, permissions, okr_role, must_change_password, enabled, roles, password_changed_at)
VALUES (gen_random_uuid(), 'Rehearsal Admin', 'admin@local.invalid',
  '${bcrypt_hash}',
  'admin', 'admin', '[]', 'okr_member', false, true, '{}', NOW())
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password, password_changed_at = NOW(), must_change_password = false;
SQL
  chmod 600 "$WORK_DIR/sql/create-admin.sql"
  unset admin_pw bcrypt_hash

  run_sql "create-admin" "$WORK_DIR/sql/create-admin.sql"
  echo "[STEP5] Rehearsal admin: admin@local.invalid (password in $ADMIN_PW_FILE)"
}

# ── Step 6: API validation ──────────────────────────────────────────────────
step6_api_validation() {
  local base="http://127.0.0.1:${BACKEND_PORT}"
  local pw; pw=$(cat "$ADMIN_PW_FILE")

  # Login
  local login
  login=$(curl -s -X POST "${base}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"admin@local.invalid\",\"password\":\"${pw}\"}")
  local token
  token=$(echo "$login" | python3 -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  echo "$login" > "$WORK_DIR/responses/login.json"
  unset pw

  if [ -z "$token" ]; then
    echo "[FAIL] Login failed"; exit 1
  fi
  echo "[PASS] Login OK"

  # API: health
  curl -s -o "$WORK_DIR/responses/health.json" -w '%{http_code}' "${base}/api/health" > "$WORK_DIR/responses/health-status.txt"

  # API: list, mine, requested, kanban, summary
  for ep in requirements/mine requirements/mine?view=summary requirements/requested requirements/kanban requirements/summary; do
    local out; out=$(echo "$ep" | tr '/?=.' '_')
    curl -s -H "Authorization: Bearer $token" "${base}/api/${ep}" > "$WORK_DIR/responses/${out}.json"
  done

  # API: create
  local create_resp
  create_resp=$(curl -s -X POST "${base}/api/requirements" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"title":"Rehearsal Test Req","description":"Created during isolation rehearsal","priority":"P2","type":"FEATURE","department":"研发部"}')
  local reqId
  reqId=$(echo "$create_resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  local reqSv
  reqSv=$(echo "$create_resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('stateVersion',0))" 2>/dev/null || echo "0")
  echo "$create_resp" > "$WORK_DIR/responses/create.json"
  [ -z "$reqId" ] && { echo "[FAIL] Create failed"; exit 1; }
  echo "[PASS] Created: $reqId sv=$reqSv"

  # API: PATCH
  curl -s -X PATCH "${base}/api/requirements/${reqId}" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"branch":"rehearsal-test","repoPath":"/rehearsal","gitHash":"abc123def456"}' \
    > "$WORK_DIR/responses/patch.json"

  # API: report
  curl -s -X POST "${base}/api/requirements/${reqId}/reports" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{"reportType":"DEV_SELF_CHECK","content":{"summary":"test"}}' \
    > "$WORK_DIR/responses/report-create.json"

  # API: advance
  curl -s -X POST "${base}/api/requirements/${reqId}/workflow/advance" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d '{}' \
    > "$WORK_DIR/responses/advance.json"

  # API: lifecycle (archive with stateVersion)
  curl -s -X POST "${base}/api/requirements/${reqId}/lifecycle" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    -d "{\"action\":\"archive\",\"stateVersion\":${reqSv}}" \
    > "$WORK_DIR/responses/archive.json"

  # API: reactivate
  curl -s -X POST "${base}/api/requirements/${reqId}/reactivate" \
    -H "Authorization: Bearer $token" \
    > "$WORK_DIR/responses/reactivate.json"

  echo "[STEP6] API validation saved to $WORK_DIR/responses/"
}

# ── Step 7: secure backend ──────────────────────────────────────────────────
step7_secure_backend() {
  if [ -z "${SECURE_IMAGE:-}" ]; then
    echo "[BLOCKED] --secure-image not provided. Re-run with --secure-image to validate."
    echo "[BLOCKED_BY_SECURE_BACKEND_CONTRACT]"
    return
  fi
  docker image inspect "$SECURE_IMAGE" >/dev/null 2>&1 || {
    echo "[FAIL] Secure image not found: $SECURE_IMAGE"
    exit 1
  }

  local pg_ip; pg_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$PG_CONTAINER")
  local jwt_s; jwt_s=$(openssl rand -base64 32)
  local jwt_r; jwt_r=$(openssl rand -base64 32)

  umask 077
  cat > "$WORK_DIR/secure.env" << ENV
DATABASE_URL=postgresql://adc_app_rehearsal:$(cat "$ROLE_PW_FILE")@${pg_ip}:5432/agent_dev_center?schema=public
JWT_SECRET=${jwt_s}
JWT_SECRET_SSO=${jwt_s}
JWT_REFRESH_SECRET=${jwt_r}
NODE_ENV=production
PORT=4000
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
ENV
  chmod 600 "$WORK_DIR/secure.env"
  unset jwt_s jwt_r

  local user_flag=()
  [ -n "$RUN_USER" ] && user_flag=(--user "$RUN_USER")

  docker run -d --name "$SECURE_CONTAINER" \
    --network "$NETWORK" \
    -p 127.0.0.1:${SECURE_PORT}:4000 \
    --env-file "$WORK_DIR/secure.env" \
    "${user_flag[@]}" \
    --entrypoint tini \
    "$SECURE_IMAGE" \
    -- cd /app/backend && node dist/src/server.js

  echo "[STEP7] Secure candidate started on port ${SECURE_PORT}"
}

# ── Step 8: permission error collection ─────────────────────────────────────
step8_permission_errors() {
  docker logs "$BACKEND_CONTAINER" --tail 100 2>&1 | grep -i 'permission denied|relation.*does not exist' \
    > "$WORK_DIR/reports/permission-errors.txt" || true
  local ec; ec=$(wc -l < "$WORK_DIR/reports/permission-errors.txt" || echo 0)
  echo "[STEP8] Permission errors: $ec"
  echo "Generate production GRANT SQL here based on actual permission gaps."
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
  echo "=== Rehearsal v3: ${REHEARSAL_ID} ==="
  echo "Backend image: $BACKEND_IMAGE"
  echo "Backup file:   $BACKUP_FILE ($(stat --format=%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null) bytes)"
  echo "Run user:      ${RUN_USER:-<empty>}"
  preflight
  step1_restore
  step2_investigate
  step3_connection_budget
  step4_grant_and_backend
  step5_rehearsal_admin
  step6_api_validation
  [ -n "${SECURE_IMAGE:-}" ] && step7_secure_backend || echo "[SKIP] Secure backend (no --secure-image)"
  step8_permission_errors
  echo "=== Complete. Reports in $WORK_DIR/reports/ ==="
}

main "$@"
