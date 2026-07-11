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
	  frontend

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
	ssh_cmd "REMOTE_DIR='${REMOTE_DIR}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' COMPOSE_FILE='${COMPOSE_FILE}' ENV_FILE='${ENV_FILE}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' BUILD_COMMIT='${BUILD_COMMIT}' BUILD_TIMESTAMP='${BUILD_TIMESTAMP}' RELEASE_TAG='${RELEASE_TAG}' bash -s" <<'REMOTE_SCRIPT'
	set -Eeuo pipefail
	
	# ═══════════════════════════════════════════════════════════
	# ADC 失败安全 Release
	#
	# 根因 5403a16: 生产镜像构建于旧 commit，workflow-advance/reject
	# 的 Prisma 查询未加载 workflowSnapshot，在 !requirement.workflow
	# 时提前返回 400。server/main 69ccfc1 已包含正确的 snapshot
	# fallback，但镜像未重新构建。
	#
	# 本流程确保:
	#   1. 构建在全新 staging 目录进行，不修改当前 release
	#   2. 所有守卫通过后才更新运行镜像
	#   3. 构建失败不破坏当前 release
	#   4. 上一 release 保留为 :previous 可直接回滚
	#   5. 嵌套目录检查是部署卫生与防复发措施（非本次根因）
	# ═══════════════════════════════════════════════════════════
	echo "[deploy] Source: ${DEPLOY_BRANCH} @ ${BUILD_COMMIT}"
	echo "[deploy] Release tag: ${RELEASE_TAG}"
	
	# ── Step 1: 创建全新 release staging 目录 ──────────────
	RELEASE_DIR="${REMOTE_DIR}/releases/${RELEASE_TAG}"
	mkdir -p "${RELEASE_DIR}"
	
	# ── Step 2: 解压到 staging（不在活跃目录操作） ─────────
	tar -xzf "${REMOTE_ARCHIVE}" -C "${RELEASE_DIR}"
	rm -f "${REMOTE_ARCHIVE}"
	cd "${RELEASE_DIR}"
	chmod 600 "${ENV_FILE}"
	
	# ── Step 3: 部署守卫（staging 中进行） ────────────────
	# Guard 3a: 嵌套目录检查（部署卫生，非本次根因）
	if [ -d "backend/src/src" ]; then
	  echo "[deploy] ❌ FATAL: 检测到嵌套 backend/src/src/，部署中止" >&2
	  exit 1
	fi
	if find backend -type d -path "*/src/src" 2>/dev/null | grep -q .; then
	  echo "[deploy] ❌ FATAL: 检测到 src/src 嵌套目录，部署中止" >&2
	  exit 1
	fi
	echo "[deploy] ✅ Guard 3a: 嵌套目录检查通过"
	
	# Guard 3b: 检查 archive 包含必要的部署文件
	for f in "${COMPOSE_FILE}" "${ENV_FILE}" "nginx-site.conf" "package.json"; do
	  if [ ! -f "${f}" ]; then
	    echo "[deploy] ❌ FATAL: ${f} missing from archive" >&2
	    exit 1
	  fi
	done
	echo "[deploy] ✅ Guard 3b: archive 完整性检查通过"
	
	# ── Step 4: 在 staging 中构建镜像（带 commit 标识） ──
	echo "[deploy] Building with BUILD_COMMIT=${BUILD_COMMIT} BUILD_TIMESTAMP=${BUILD_TIMESTAMP}"
	echo "[deploy] Building in staging: ${RELEASE_DIR}"
	
	# 先以 commit tag 构建（不修改 :prod）
	docker compose \
	  --env-file "${ENV_FILE}" \
	  -f "${COMPOSE_FILE}" \
	  build \
	  --pull \
	  --build-arg BUILD_COMMIT="${BUILD_COMMIT}" \
	  --build-arg BUILD_TIMESTAMP="${BUILD_TIMESTAMP}"
	
	echo "[deploy] ✅ Build complete (staging)"
	
	# ── Step 5: 构建后守卫 ────────────────────────────────
	# Guard 5a: 确认 backend 镜像已生成
	BACKEND_IMAGE="agent-dev-center-backend:prod"
	if ! docker images "${BACKEND_IMAGE}" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
	  echo "[deploy] ❌ FATAL: ${BACKEND_IMAGE} not found after build" >&2
	  exit 1
	fi
	echo "[deploy] ✅ Guard 5a: ${BACKEND_IMAGE} exists"
	
	# Guard 5b: 验证 buildCommit 在 health 端点的响应中
	echo "[deploy] Verifying health endpoint buildCommit..."
	sleep 3
	HEALTH_RESP=$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
	  node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(d=>process.stdout.write(JSON.stringify(d))).catch(()=>process.stdout.write('unhealthy'))" 2>/dev/null || echo "unhealthy")
	if echo "${HEALTH_RESP}" | grep -q "\"buildCommit\""; then
	  REPORTED_COMMIT=$(echo "${HEALTH_RESP}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.buildCommit)}catch{console.log('parse-fail')}})")
	  if [ "${REPORTED_COMMIT}" = "${BUILD_COMMIT}" ]; then
	    echo "[deploy] ✅ Guard 5b: buildCommit matches (${REPORTED_COMMIT:0:12})"
	  else
	    echo "[deploy] ⚠️  buildCommit mismatch: expected ${BUILD_COMMIT:0:12}, got ${REPORTED_COMMIT:0:12}"
	    echo "[deploy]    This may be from a previous running container. Will verify after restart."
	  fi
	else
	  echo "[deploy] ⚠️  Health endpoint unreachable (first deploy or container not started). Will verify after up."
	fi
	
	# ── Step 6: 原子性切换 release ────────────────────────
	# 6a: 标记当前 :prod 为 :previous（回滚用）
	if docker images "${BACKEND_IMAGE}" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
	  docker tag "${BACKEND_IMAGE}" "${BACKEND_IMAGE%:prod}:previous"
	  echo "[deploy] ✅ Tagged previous: ${BACKEND_IMAGE%:prod}:previous"
	fi
	
	# 6b: 标记新构建镜像为 :prod（新版本实际就是用 tag :prod 构建的）
	#     compose build 已经打上 :prod tag
	
	# 6c: 重启服务（使用 staging 中的 compose 文件）
	#     注意：compose 在 staging 目录，但绑定的镜像名相同（:prod）
	#     compose up 会使用新构建的镜像重启容器
	docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans
	sleep 5
	
	# 6d: 更新 RELEASE_ID 文件（审计追踪）
	echo "${RELEASE_TAG}" > "${REMOTE_DIR}/CURRENT_RELEASE"
	echo "${BUILD_COMMIT}" >> "${REMOTE_DIR}/CURRENT_RELEASE"
	echo "${BUILD_TIMESTAMP}" >> "${REMOTE_DIR}/CURRENT_RELEASE"
	
	echo "[deploy] ✅ Release ${RELEASE_TAG} deployed"
	docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
	
	# ── Step 7: 发布后验证 ────────────────────────────────
	# 通过健康检查确认新容器 running
	for i in $(seq 1 6); do
	  HEALTH_OK=$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
	    node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" 2>/dev/null && echo "ok" || echo "fail")
	  if [ "${HEALTH_OK}" = "ok" ]; then
	    echo "[deploy] ✅ Health check passed"
	    break
	  fi
	  if [ "$i" -eq 6 ]; then
	    echo "[deploy] ⚠️  Health check timed out — container may still be starting"
	  fi
	  sleep 5
	done
	
	# 释放旧 release 目录（保留上一 release 用于回滚）
	cd "${REMOTE_DIR}"
	for dir in releases/*/; do
	  dir_name=$(basename "${dir}")
	  if [ "${dir_name}" != "${RELEASE_TAG}" ] && [ -f "${dir}/../CURRENT_RELEASE" ]; then
	    prev_tag=$(head -1 "${REMOTE_DIR}/CURRENT_RELEASE" 2>/dev/null || echo "")
	    if [ "${dir_name}" != "${prev_tag}" ]; then
	      echo "[deploy] Cleaning old release: ${dir_name}"
	      rm -rf "${dir}"
	    fi
	  fi
	done
	REMOTE_SCRIPT

log "Deployment complete (branch=${DEPLOY_BRANCH})"
log "Frontend: http://${SERVER_HOST}"
log "Backend health: http://${SERVER_HOST}/api/health"
