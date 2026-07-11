#!/usr/bin/env bash
set -Eeuo pipefail

SERVER_HOST="${SERVER_HOST:-your-server-ip}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PORT="${SERVER_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/agent-dev-center}"
SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"
REMOTE_ARCHIVE="/tmp/agent-dev-center-prod.tar.gz"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"  # main=生产, develop=测试环境

trap 'echo "Deployment failed at line ${LINENO}." >&2' ERR

LOCK_FILE="/tmp/agent-dev-center-deploy.lock"

log() {
  printf '[deploy] %s\n' "$*"
}

acquire_lock() {
  if ! mkdir "${LOCK_FILE}" 2>/dev/null; then
    local pid
    if [ -f "${LOCK_FILE}/pid" ]; then
      pid=$(cat "${LOCK_FILE}/pid" 2>/dev/null)
    fi
    echo "[deploy] Deploy lock held by PID ${pid:-unknown}. Waiting up to 300s..." >&2
    for i in $(seq 1 60); do
      sleep 5
      if mkdir "${LOCK_FILE}" 2>/dev/null; then
        echo "[deploy] Lock acquired after ${i}x5s wait" >&2
        echo "$$" > "${LOCK_FILE}/pid"
        return 0
      fi
      # Check if previous holder is dead
      if [ -n "${pid:-}" ] && ! kill -0 "${pid}" 2>/dev/null; then
        rmdir "${LOCK_FILE}" 2>/dev/null || true
      fi
    done
    echo "[deploy] Failed to acquire deploy lock after 300s" >&2
    exit 1
  fi
  echo "$$" > "${LOCK_FILE}/pid"
}

release_lock() {
  rm -rf "${LOCK_FILE}" 2>/dev/null || true
}
trap 'release_lock; rm -rf "${tmp_dir:-}" 2>/dev/null || true; echo "Deployment failed at line ${LINENO}." >&2' EXIT

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

ssh_cmd() {
  ssh \
    -p "${SERVER_PORT}" \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=accept-new \
    "${SSH_TARGET}" \
    "$@"
}

required_files=(
  ".dockerignore"
  "${COMPOSE_FILE}"
  "${ENV_FILE}"
  "nginx-site.conf"
  "package.json"
  "package-lock.json"
  "backend/Dockerfile"
  "frontend/Dockerfile"
)

for cmd in ssh scp tar mktemp; do
  need_cmd "${cmd}"
done

for file in "${required_files[@]}"; do
  if [[ ! -e "${file}" ]]; then
    echo "Required deployment file missing: ${file}" >&2
    exit 1
  fi
done

if grep -Eq 'JWT_SECRET=(replace|change|dev-only|changeme)' "${ENV_FILE}"; then
  echo "Refusing to deploy with a placeholder JWT_SECRET in ${ENV_FILE}." >&2
  exit 1
fi

log "Acquiring deploy lock"
acquire_lock

log "Checking SSH access to ${SSH_TARGET}:${SERVER_PORT}"
ssh_cmd "echo ok" >/dev/null

log "Checking Docker Compose on remote host"
ssh_cmd "command -v docker >/dev/null && docker compose version >/dev/null"

# ── 冒烟测试：部署前验证核心工作流 ──
log "Running smoke tests before deployment"
if [ -f "scripts/smoke-test.sh" ]; then
  if ! bash scripts/smoke-test.sh "${SERVER_HOST}"; then
    echo "[deploy] ❌ Smoke tests FAILED — aborting deployment." >&2
    exit 1
  fi
  log "Smoke tests passed"
else
  log "⚠️  scripts/smoke-test.sh not found — skipping smoke tests"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-dev-center-prod.XXXXXX")"
archive="${tmp_dir}/agent-dev-center-prod.tar.gz"

# Verify local git is on the expected branch before archiving
LOCAL_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
LOCAL_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
if [ "${LOCAL_BRANCH}" != "${DEPLOY_BRANCH}" ] && [ "${DEPLOY_BRANCH}" != "main" ]; then
  log "WARNING: DEPLOY_BRANCH=${DEPLOY_BRANCH} but local branch is ${LOCAL_BRANCH}. Archive will contain current working tree."
elif [ "${LOCAL_BRANCH}" != "${DEPLOY_BRANCH}" ]; then
  log "NOTE: Deploying from local branch ${LOCAL_BRANCH} @ ${LOCAL_COMMIT} (DEPLOY_BRANCH defaults to main)"
fi
log "Creating deployment archive from branch ${LOCAL_BRANCH} @ ${LOCAL_COMMIT}"
	BUILD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
	BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "unknown")
	log "Build metadata: commit=${BUILD_COMMIT} timestamp=${BUILD_TIMESTAMP}"
		tar \
		  --exclude='.git' \
		  --exclude='node_modules' \
		  --exclude='backend/node_modules' \
		  --exclude='frontend/node_modules' \
		  --exclude='backend/dist' \
		  --exclude='frontend/dist' \
		  --exclude='*.log' \
		  -czf "${archive}" \
		  .dockerignore \
		  "${COMPOSE_FILE}" \
		  "${ENV_FILE}" \
		  nginx-site.conf \
		  package.json \
		  package-lock.json \
		  backend \
		  frontend \
		  scripts/lib

log "Preparing ${REMOTE_DIR} on remote host"
ssh_cmd "mkdir -p '${REMOTE_DIR}'"

log "Copying deployment archive with scp"
scp \
  -P "${SERVER_PORT}" \
  -o StrictHostKeyChecking=accept-new \
  "${archive}" \
  "${SSH_TARGET}:${REMOTE_ARCHIVE}"

log "Building images and starting services on remote host (branch=${DEPLOY_BRANCH})"
	RELEASE_TAG="${BUILD_COMMIT:0:12}"
		ssh_cmd "REMOTE_DIR='${REMOTE_DIR}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' \
  COMPOSE_FILE='${COMPOSE_FILE}' ENV_FILE='${ENV_FILE}' \
  DEPLOY_BRANCH='${DEPLOY_BRANCH}' \
  BUILD_COMMIT='${BUILD_COMMIT}' BUILD_TIMESTAMP='${BUILD_TIMESTAMP}' \
  RELEASE_TAG='${RELEASE_TAG}' \
  BACKEND_IMAGE='agent-dev-center-backend' FRONTEND_IMAGE='agent-dev-center-frontend' \
  bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

# ═══════════════════════════════════════════════════════════
# ADC 失败安全 Release
#
# 根因 5403a16: 生产镜像为旧 commit，workflow-advance/reject
# 未加载 workflowSnapshot。server/main 69ccfc1 已包含正确
# fallback 但镜像未重建。
#
# 流程:
#   1. 全新 staging 目录（不修改当前 release）
#   2. SAVE running image IDs BEFORE build → :previous
#   3. 构建新镜像
#   4. 守卫（嵌套目录 / archive 完整性）
#   5. docker compose up -d
#   6. 严格 health + buildCommit 校验
#   7. 校验通过 → CURRENT_RELEASE
#   8. 任何失败 → 自动回滚
# ═══════════════════════════════════════════════════════════

echo "[deploy] Source: ${DEPLOY_BRANCH} @ ${BUILD_COMMIT}"
echo "[deploy] Release tag: ${RELEASE_TAG}"

# ── 加载公共库 ──────────────────────────────────────────
LIB_SCRIPT="${RELEASE_DIR}/scripts/lib/release-common.sh"
# 将在 staging 解压后 source（提前准备函数供 trap 使用）

# ── 回滚函数（在 source 前声明，防止 source 失败） ──────
do_rollback() {
  echo "[deploy] ⚠️  ROLLING BACK production release..."
  echo "[deploy] Restoring :previous → :prod"

  if docker images "${BACKEND_IMAGE}:previous" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
    docker tag "${BACKEND_IMAGE}:previous" "${BACKEND_IMAGE}:prod" 2>/dev/null || true
  fi
  if docker images "${FRONTEND_IMAGE}:previous" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
    docker tag "${FRONTEND_IMAGE}:previous" "${FRONTEND_IMAGE}:prod" 2>/dev/null || true
  fi

  echo "[deploy] Restarting with --no-build..."
  if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --no-build 2>&1; then
    sleep 10
    # Verify rollback health
    for i in 1 2 3; do
      if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
        node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" 2>/dev/null; then
        echo "[deploy] ✅ Rollback health OK"
        echo "[deploy] DEPLOY_FAILED_ROLLED_BACK"
        exit 1
      fi
      sleep 5
    done
    echo "[deploy] ❌ ROLLBACK_FAILED: health check failed after rollback" >&2
  else
    echo "[deploy] ❌ ROLLBACK_FAILED: compose up --no-build failed" >&2
  fi

  echo "[deploy]    Container state:" >&2
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps 2>/dev/null >&2 || true
  echo "[deploy]    Backend images: ${BACKEND_IMAGE}:prod / :previous" >&2
  echo "[deploy]    Frontend images: ${FRONTEND_IMAGE}:prod / :previous" >&2
  echo "ROLLBACK_FAILED"
  exit 1
}

# ── Step 1: 创建全新 release staging 目录 ──────────────
RELEASE_DIR="${REMOTE_DIR}/releases/${RELEASE_TAG}"
mkdir -p "${RELEASE_DIR}"

# ── Step 2: 解压到 staging ─────────────────────────────
tar -xzf "${REMOTE_ARCHIVE}" -C "${RELEASE_DIR}"
rm -f "${REMOTE_ARCHIVE}"
cd "${RELEASE_DIR}"
chmod 600 "${ENV_FILE}"

# Source helpers now that files exist
if [ -f "scripts/lib/release-common.sh" ]; then
  source scripts/lib/release-common.sh
else
  echo "[deploy] ⚠️  release-common.sh not found, using fallback"
fi

# ── Step 3: 部署守卫 ──────────────────────────────────
# Guard 3a: 嵌套目录检查（部署卫生，非本次根因）
if [ -d "backend/src/src" ]; then
  echo "[deploy] ❌ FATAL: 检测到嵌套 backend/src/src/" >&2
  exit 1
fi
if find backend -type d -path "*/src/src" 2>/dev/null | grep -q .; then
  echo "[deploy] ❌ FATAL: 检测到 src/src 嵌套目录" >&2
  exit 1
fi
echo "[deploy] ✅ Guard 3a: 嵌套目录检查通过"

# Guard 3b: archive 完整性
for f in "${COMPOSE_FILE}" "${ENV_FILE}" "nginx-site.conf" "package.json"; do
  if [ ! -f "${f}" ]; then
    echo "[deploy] ❌ FATAL: ${f} missing from archive" >&2
    exit 1
  fi
done
echo "[deploy] ✅ Guard 3b: archive 完整性检查通过"

# ── Step 4: 保存当前运行容器 image IDs（build 前！） ──
echo "[deploy] Saving running container images BEFORE build..."

PREV_BACKEND_ID=""
if docker compose -f "${COMPOSE_FILE}" ps -q backend 2>/dev/null | grep -q .; then
  PREV_BACKEND_ID=$(docker inspect --format '{{.Image}}' "$(docker compose -f "${COMPOSE_FILE}" ps -q backend)" 2>/dev/null || echo "")
fi
PREV_FRONTEND_ID=""
if docker compose -f "${COMPOSE_FILE}" ps -q frontend 2>/dev/null | grep -q .; then
  PREV_FRONTEND_ID=$(docker inspect --format '{{.Image}}' "$(docker compose -f "${COMPOSE_FILE}" ps -q frontend)" 2>/dev/null || echo "")
fi

# Tag as :previous
if [ -n "${PREV_BACKEND_ID}" ]; then
  docker tag "${PREV_BACKEND_ID}" "${BACKEND_IMAGE}:previous" 2>/dev/null && \
    echo "[deploy] ✅ Backend previous saved: ${PREV_BACKEND_ID:0:19}..." || \
    echo "[deploy] ⚠️  Could not tag Backend previous"
fi
if [ -n "${PREV_FRONTEND_ID}" ]; then
  docker tag "${PREV_FRONTEND_ID}" "${FRONTEND_IMAGE}:previous" 2>/dev/null && \
    echo "[deploy] ✅ Frontend previous saved: ${PREV_FRONTEND_ID:0:19}..." || \
    echo "[deploy] ⚠️  Could not tag Frontend previous"
fi

# ── Step 5: 在 staging 中构建镜像 ─────────────────────
echo "[deploy] Building with BUILD_COMMIT=${BUILD_COMMIT} BUILD_TIMESTAMP=${BUILD_TIMESTAMP}"
docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  build \
  --pull \
  --build-arg BUILD_COMMIT="${BUILD_COMMIT}" \
  --build-arg BUILD_TIMESTAMP="${BUILD_TIMESTAMP}"

echo "[deploy] ✅ Build complete"

# Guard 5a: 确认镜像存在
if ! docker images "${BACKEND_IMAGE}:prod" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
  echo "[deploy] ❌ FATAL: ${BACKEND_IMAGE}:prod not found after build" >&2
  do_rollback
fi

# Guard 5b: 新镜像 ID 不能与旧镜像相同（重复部署检查）
NEW_BACKEND_ID=$(docker inspect --format '{{.Id}}' "${BACKEND_IMAGE}:prod" 2>/dev/null || echo "")
if [ -n "${PREV_BACKEND_ID}" ] && [ "${NEW_BACKEND_ID}" = "${PREV_BACKEND_ID}" ]; then
  echo "[deploy] ❌ FATAL: New image identical to running image (same commit, no changes)." >&2
  echo "[deploy]    This may be a duplicate deployment of the same commit." >&2
  do_rollback
fi

# ── Step 6: 启动服务 ──────────────────────────────────
echo "[deploy] Starting services..."
if ! docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans; then
  echo "[deploy] ❌ docker compose up failed" >&2
  do_rollback
fi

# ── Step 7: 部署后健康检查 + buildCommit 严格校验 ─────
echo "[deploy] Waiting for new containers (30s)..."
sleep 10

# 7a: Backend health
BACKEND_HEALTHY=0
for i in $(seq 1 6); do
  if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
    node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" 2>/dev/null; then
    BACKEND_HEALTHY=1
    break
  fi
  [ "$i" -lt 6 ] && sleep 5
done
if [ "${BACKEND_HEALTHY}" != "1" ]; then
  echo "[deploy] ❌ Backend health check FAILED" >&2
  do_rollback
fi
echo "[deploy] ✅ Backend health OK"

# 7b: Frontend health
FRONTEND_HEALTHY=0
for i in $(seq 1 6); do
  if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T frontend \
    wget -qO- http://127.0.0.1/health >/dev/null 2>&1; then
    FRONTEND_HEALTHY=1
    break
  fi
  [ "$i" -lt 6 ] && sleep 5
done
if [ "${FRONTEND_HEALTHY}" != "1" ]; then
  echo "[deploy] ❌ Frontend health check FAILED" >&2
  do_rollback
fi
echo "[deploy] ✅ Frontend health OK"

# 7c: Backend buildCommit 严格验证
echo "[deploy] Verifying buildCommit on NEW container..."
BUILD_COMMIT_OK=0
for i in $(seq 1 6); do
  HEALTH_JSON=$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
    node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(d=>process.stdout.write(JSON.stringify(d))).catch(()=>process.stdout.write('fail'))" 2>/dev/null || echo "fail")

  if [ "${HEALTH_JSON}" != "fail" ]; then
    REPORTED_COMMIT=$(echo "${HEALTH_JSON}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.buildCommit||'')}catch{console.log('')}})")
    REPORTED_ENTRY=$(echo "${HEALTH_JSON}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.runtimeEntry||'')}catch{console.log('')}})")

    ERRORS=""
    if [ "${REPORTED_COMMIT}" != "${BUILD_COMMIT}" ]; then
      ERRORS="buildCommit mismatch: expected=${BUILD_COMMIT:0:12}, got=${REPORTED_COMMIT:0:12}"
    fi
    if [ "${REPORTED_ENTRY}" != "dist/src/server.js" ]; then
      ERRORS="${ERRORS:+${ERRORS}; }runtimeEntry=${REPORTED_ENTRY}"
    fi

    if [ -z "${ERRORS}" ]; then
      BUILD_COMMIT_OK=1
      echo "[deploy] ✅ buildCommit verified: ${BUILD_COMMIT:0:12}"
      echo "[deploy] ✅ runtimeEntry verified: ${REPORTED_ENTRY}"
      break
    fi
    echo "[deploy] Retry $i: ${ERRORS}"
  fi
  sleep 5
done

if [ "${BUILD_COMMIT_OK}" != "1" ]; then
  echo "[deploy] ❌ buildCommit verification FAILED — rolling back" >&2
  do_rollback
fi

# ── Step 8: 所有检查通过 → 写入 CURRENT_RELEASE ───────
{
  echo "# ADC Production Release"
  echo "commit=${BUILD_COMMIT}"
  echo "timestamp=${BUILD_TIMESTAMP}"
  echo "backend_image_id=${NEW_BACKEND_ID}"
  echo "frontend_image_id=$(docker inspect --format '{{.Id}}' "${FRONTEND_IMAGE}:prod" 2>/dev/null || echo 'unknown')"
  echo "previous_backend_image_id=${PREV_BACKEND_ID:-unknown}"
  echo "previous_frontend_image_id=${PREV_FRONTEND_ID:-unknown}"
  echo "release_dir=${RELEASE_DIR}"
} > "${REMOTE_DIR}/CURRENT_RELEASE"

echo "[deploy] ✅ CURRENT_RELEASE written"

# ── Step 9: 清理旧 release 目录 ────────────────────────
cd "${REMOTE_DIR}"
for dir in releases/*/; do
  dir_name=$(basename "${dir}")
  if [ "${dir_name}" != "${RELEASE_TAG}" ]; then
    echo "[deploy] Cleaning old release: ${dir_name}"
    rm -rf "${dir}"
  fi
done

echo "[deploy] ✅ Release ${RELEASE_TAG} deployed successfully"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
REMOTE_SCRIPT

log "Deployment complete (branch=${DEPLOY_BRANCH})"
log "Frontend: http://${SERVER_HOST}"
log "Backend health: http://${SERVER_HOST}/api/health"
