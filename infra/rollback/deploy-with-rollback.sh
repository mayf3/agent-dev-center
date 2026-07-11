#!/bin/bash
# deploy-with-rollback.sh — 带自动回滚的 Docker 部署脚本（已废弃）
#
# 此入口已废弃。所有 ADC 生产发布请使用仓库根目录的 deploy.sh。
#
# 区别：
#   根目录 deploy.sh: archive → scp → staging → build → guard → compose up → health
#   本脚本:         git pull → build → up（无 staging，无 buildCommit 守卫）
#   scripts/deploy.sh: git pull → build → up（同样缺少 staging 和守卫）
#
# 三个入口中只有根目录 deploy.sh 支持:
#   - 失败安全 release staging
#   - 运行容器 image ID 保存 (docker inspect)
#   - 自动回滚 (previous → prod, --no-build)
#   - buildCommit 精确验证
#   - 编译产物 workflowSnapshot 守卫
#   - 部署锁 (acquire_lock)
#
# 本脚本保留仅用于回滚辅助参考，不可用于正式发布。

set -euo pipefail

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ❌ 此部署入口已废弃"
echo ""
echo "  请使用仓库根目录 deploy.sh 进行生产发布。"
echo "  用法: bash deploy.sh"
echo ""
echo "  唯一正式发布入口："
echo "    /opt/agent-dev-center/releases/<sha>/  (staging)"
echo "    agent-dev-center-backend:prod          (运行镜像)"
echo "    agent-dev-center-backend:previous       (回滚镜像)"
echo ""
echo "  本脚本保留仅用于回滚辅助参考。"
echo "═══════════════════════════════════════════════════════"
echo ""
exit 1

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

# ── Git pull 后守卫 — 检查嵌套 src/src ──
if [ -d "backend/src/src" ]; then
  error "检测到嵌套 backend/src/src/ 目录 — 部署中止"
  do_rollback "嵌套 src/src 目录"
fi
log "✅ 嵌套目录检查通过"

# ── Step 3: 构建新镜像（带 build metadata）──
BUILD_COMMIT=$(cd "$PROJECT_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")
BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "unknown")
log "Step 3/6: 构建 Docker 镜像 (commit=${BUILD_COMMIT})"
docker compose -f "$COMPOSE_FILE" build \
  --build-arg "BUILD_COMMIT=${BUILD_COMMIT}" \
  --build-arg "BUILD_TIMESTAMP=${BUILD_TIMESTAMP}" \
  "$COMPOSE_SERVICE" 2>&1 | tee -a "$LOG_FILE" || do_rollback "Docker build 失败"
success "镜像构建完成 (commit=${BUILD_COMMIT})"

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
