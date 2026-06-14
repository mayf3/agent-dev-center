#!/bin/bash
# deploy-with-rollback.sh — 带自动回滚的 Docker 部署脚本
# 用法: deploy-with-rollback.sh <service-name> [compose-service] [--skip-migrate]
#
# 功能：
#   1. 部署前自动备份当前镜像为 previous
#   2. 构建新镜像并部署
#   3. 健康检查验证
#   4. 失败自动回滚到 previous 版本
#
# 与原 deploy.sh 的区别：
#   - 支持任意服务（不限于 agent-dev-center-backend）
#   - 回滚逻辑更健壮（验证回滚后健康状态）
#   - 部署日志记录到 /var/log/deploy/ 便于审计
#   - 支持 compose-service 名映射（镜像名 vs compose 服务名）

set -euo pipefail

# ── 参数解析 ──
SERVICE="${1:-agent-dev-center-backend}"
COMPOSE_SERVICE="${2:-$SERVICE}"
SKIP_MIGRATE=false

for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=true ;;
  esac
done

# ── 配置 ──
PROJECT_DIR="/opt/services/agent-dev-center"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
HEALTH_TIMEOUT=30
HEALTH_INTERVAL=5
HEALTH_RETRIES=6

# 服务 → 健康检查 URL
declare -A HEALTH_URLS=(
  ["agent-dev-center-backend"]="http://localhost:4000/api/health"
  ["auth-service"]="http://localhost:3001/health"
  ["llm-todo-service"]="http://localhost:3458/health"
  ["svc-okr"]="http://localhost:3459/health"
)

HEALTH_URL="${HEALTH_URLS[$SERVICE]:-}"
DEPLOY_LOG_DIR="/var/log/deploy"
DEPLOY_LOG_FILE="${DEPLOY_LOG_DIR}/deploy.log"
LOG_FILE="/tmp/deploy-${SERVICE}-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$DEPLOY_LOG_DIR" 2>/dev/null || true

# ── 日志函数 ──
log()   { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
error() { echo "[$(date '+%H:%M:%S')] ❌ $*" | tee -a "$LOG_FILE"; }
success() { echo "[$(date '+%H:%M:%S')] ✅ $*" | tee -a "$LOG_FILE"; }

# ── 回滚函数 ──
do_rollback() {
  local reason="$1"
  error "部署失败：$reason"
  error "开始自动回滚..."

  if ! docker images "${SERVICE}:previous" --format '{{.Tag}}' 2>/dev/null | grep -q previous; then
    error "没有 ${SERVICE}:previous 镜像，无法自动回滚！"
    error "需要手动修复：检查 docker logs ${SERVICE}"
    exit 1
  fi

  log "恢复 previous 镜像..."
  docker tag "${SERVICE}:previous" "${SERVICE}:latest"

  log "重启容器..."
  docker compose -f "$COMPOSE_FILE" up -d "$COMPOSE_SERVICE" 2>&1 | tee -a "$LOG_FILE" || true

  # 等待容器启动
  sleep 5

  if [ -n "$HEALTH_URL" ]; then
    for i in $(seq 1 $HEALTH_RETRIES); do
      if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        success "回滚成功！${SERVICE} 已恢复到上一版本"
        echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | ROLLBACK_SUCCESS" >> "$DEPLOY_LOG_FILE"
        exit 1  # 仍然返回非零，表示本次部署失败
      fi
      log "  等待回滚服务启动... ($i/$HEALTH_RETRIES)"
      sleep $HEALTH_INTERVAL
    done
    error "回滚后健康检查仍然失败！需要人工介入"
    error "排查: docker logs $SERVICE --tail 100"
    echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | ROLLBACK_FAILED" >> "$DEPLOY_LOG_FILE"
  else
    if docker ps --format '{{.Names}}' | grep -q "^${SERVICE}$"; then
      success "回滚完成（容器运行中，未做 HTTP 健康检查）"
      echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | ROLLBACK_SUCCESS_NO_HEALTH_CHECK" >> "$DEPLOY_LOG_FILE"
    else
      error "回滚后容器未运行！需要人工介入"
      echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | ROLLBACK_FAILED" >> "$DEPLOY_LOG_FILE"
    fi
  fi

  exit 1
}

# ── Step 1: 备份当前镜像 ──
log "=== 部署开始: $SERVICE ==="
log "Step 1/6: 备份当前镜像"

if docker images "${SERVICE}:latest" --format '{{.Tag}}' 2>/dev/null | grep -q latest; then
  CURRENT_ID=$(docker images "${SERVICE}:latest" --format '{{.ID}}')
  docker tag "${SERVICE}:latest" "${SERVICE}:previous"
  success "已备份 ${SERVICE}:latest (ID: ${CURRENT_ID}) → ${SERVICE}:previous"
else
  log "  没有现有 latest 镜像，跳过备份"
fi

# ── Step 2: 拉取最新代码 ──
log "Step 2/6: 同步最新代码"
cd "$PROJECT_DIR"
git checkout main 2>&1 | tee -a "$LOG_FILE"
git pull server main 2>&1 | tee -a "$LOG_FILE" || do_rollback "git pull 失败"
success "代码已同步"

# ── Step 3: 构建新镜像 ──
log "Step 3/6: 构建 Docker 镜像"
docker compose -f "$COMPOSE_FILE" build "$COMPOSE_SERVICE" 2>&1 | tee -a "$LOG_FILE" || do_rollback "Docker build 失败"
success "镜像构建完成"

# ── Step 4: 数据库迁移（可选）──
if [ "$SKIP_MIGRATE" = false ] && [ "$COMPOSE_SERVICE" = "backend" ]; then
  log "Step 4/6: 执行数据库迁移"
  docker compose -f "$COMPOSE_FILE" run --rm "$COMPOSE_SERVICE" npx prisma migrate deploy 2>&1 | tee -a "$LOG_FILE" || do_rollback "Prisma migrate 失败"
  success "数据库迁移完成"
else
  log "Step 4/6: 跳过数据库迁移"
fi

# ── Step 5: 启动新版本 ──
log "Step 5/6: 启动服务"
docker compose -f "$COMPOSE_FILE" up -d "$COMPOSE_SERVICE" 2>&1 | tee -a "$LOG_FILE" || do_rollback "Docker compose up 失败"
success "服务已启动"

# ── Step 6: 健康检查 ──
log "Step 6/6: 健康检查"

if [ -z "$HEALTH_URL" ]; then
  log "  未配置健康检查 URL，等待 3s 后检查容器状态"
  sleep 3
  if docker ps --format '{{.Names}}' | grep -q "^${SERVICE}$"; then
    success "容器运行中 — 部署完成（未做 HTTP 健康检查）"
    echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | $(git rev-parse --short HEAD) | SUCCESS_NO_HEALTH_CHECK" >> "$DEPLOY_LOG_FILE"
    exit 0
  else
    do_rollback "容器未运行"
  fi
fi

log "  健康检查 URL: ${HEALTH_URL}"
log "  超时: ${HEALTH_TIMEOUT}s (${HEALTH_RETRIES} 次重试)"

for i in $(seq 1 $HEALTH_RETRIES); do
  sleep $HEALTH_INTERVAL
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    success "健康检查通过 — 部署成功！"
    echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | $(git rev-parse --short HEAD) | SUCCESS" >> "$DEPLOY_LOG_FILE"
    echo ""
    echo "部署摘要:"
    echo "  服务: $SERVICE"
    echo "  版本: $(git rev-parse --short HEAD)"
    echo "  日志: $LOG_FILE"
    exit 0
  fi
  log "  等待服务启动... ($i/$HEALTH_RETRIES)"
done

# 健康检查失败 → 自动回滚
do_rollback "健康检查超时 (${HEALTH_TIMEOUT}s)"
