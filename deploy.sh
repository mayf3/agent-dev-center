#!/usr/bin/env bash
set -Eeuo pipefail

SERVER_HOST="${SERVER_HOST:-8.163.44.127}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PORT="${SERVER_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-/opt/agent-dev-center}"
SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"
REMOTE_ARCHIVE="/tmp/agent-dev-center-prod.tar.gz"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

trap 'echo "Deployment failed at line ${LINENO}." >&2' ERR

log() {
  printf '[deploy] %s\n' "$*"
}

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

log "Running pre-deploy smoke tests..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/smoke-test.sh" ]; then
  bash "${SCRIPT_DIR}/smoke-test.sh" --host "${SERVER_HOST}" || {
    echo "❌ Smoke tests failed — deployment aborted." >&2
    exit 1
  }
else
  log "WARNING: smoke-test.sh not found, skipping pre-deploy validation"
fi

log "Checking SSH access to ${SSH_TARGET}:${SERVER_PORT}"
ssh_cmd "echo ok" >/dev/null

log "Checking Docker Compose on remote host"
ssh_cmd "command -v docker >/dev/null && docker compose version >/dev/null"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-dev-center-prod.XXXXXX")"
archive="${tmp_dir}/agent-dev-center-prod.tar.gz"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

log "Creating deployment archive"
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

log "Building images and starting services on remote host"
ssh_cmd "REMOTE_DIR='${REMOTE_DIR}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' COMPOSE_FILE='${COMPOSE_FILE}' ENV_FILE='${ENV_FILE}' bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
cd "${REMOTE_DIR}"
tar -xzf "${REMOTE_ARCHIVE}" -C "${REMOTE_DIR}"
rm -f "${REMOTE_ARCHIVE}"
chmod 600 "${ENV_FILE}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build --pull
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
REMOTE_SCRIPT

log "Deployment complete"
log "Frontend: http://${SERVER_HOST}"
log "Backend health: http://${SERVER_HOST}/api/health"
