#!/bin/bash
# rollback.sh — Docker 部署一键回滚脚本
# 用法: rollback.sh <service-name> [--check-only]
#
# 功能：
#   1. 检查 previous 标签是否存在
#   2. 将 previous 镜像恢复为 latest
#   3. 重启容器
#   4. 健康检查验证
#
# 退出码：
#   0 — 回滚成功 / 健康检查通过
#   1 — 回滚失败 / 没有 previous 镜像
#   2 — 参数错误

set -euo pipefail

# ── 参数校验 ──
if [ $# -lt 1 ]; then
  echo "用法: $0 <service-name> [--check-only]"
  echo ""
  echo "可回滚的服务（有 previous 标签的）："
  echo ""
  # 列出所有有 previous 标签的镜像
  docker images --format '{{.Repository}}:{{.Tag}}' | grep ':previous' | sort -u | sed 's/^/  /'
  exit 2
fi

SERVICE="$1"
CHECK_ONLY="${2:-}"

# ── 配置 ──
PROJECT_DIR="/opt/services/agent-dev-center"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
HEALTH_TIMEOUT=30
HEALTH_INTERVAL=5
HEALTH_RETRIES=6

# 服务 → 健康检查 URL 映射
declare -A HEALTH_URLS=(
  ["agent-dev-center-backend"]="http://localhost:4000/api/health"
  ["auth-service"]="http://localhost:3001/health"
  ["llm-todo-service"]="http://localhost:3458/health"
  ["svc-okr"]="http://localhost:3459/health"
)

HEALTH_URL="${HEALTH_URLS[$SERVICE]:-}"
LOG_FILE="/tmp/rollback-${SERVICE}-$(date +%Y%m%d-%H%M%S).log"

# ── 日志函数 ──
log()   { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
error() { echo "[$(date '+%H:%M:%S')] ❌ $*" | tee -a "$LOG_FILE"; }
success() { echo "[$(date '+%H:%M:%S')] ✅ $*" | tee -a "$LOG_FILE"; }

# ── Step 0: 检查 previous 标签 ──
log "检查 ${SERVICE}:previous 镜像..."

if ! docker images "${SERVICE}:previous" --format '{{.Tag}}' 2>/dev/null | grep -q previous; then
  error "${SERVICE}:previous 镜像不存在，无法回滚"
  echo ""
  echo "当前可用的镜像标签："
  docker images "${SERVICE}" --format '  {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}' 2>/dev/null || echo "  (无)"
  exit 1
fi

success "找到 ${SERVICE}:previous 镜像"
docker images "${SERVICE}" --format '  {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}' | head -5

# ── 如果是仅检查模式，到此为止 ──
if [ "$CHECK_ONLY" = "--check-only" ]; then
  success "仅检查模式：previous 标签存在，可以回滚"
  exit 0
fi

# ── Step 1: 记录当前镜像信息（回滚前的 latest）──
CURRENT_HASH=$(docker images "${SERVICE}:latest" --format '{{.ID}}' 2>/dev/null || echo "none")
PREVIOUS_HASH=$(docker images "${SERVICE}:previous" --format '{{.ID}}' 2>/dev/null || echo "none")
log "当前 latest 镜像 ID: ${CURRENT_HASH}"
log "回滚目标 previous 镜像 ID: ${PREVIOUS_HASH}"

# ── Step 2: 将 previous 标记为 latest ──
log "恢复 ${SERVICE}:previous → ${SERVICE}:latest..."
docker tag "${SERVICE}:previous" "${SERVICE}:latest"
success "镜像标签已更新"

# ── Step 3: 使用新镜像重启容器 ──
log "重启容器 ${SERVICE}..."

# 判断服务是否在 docker compose 中
if docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null | grep -q "^${SERVICE}$"; then
  docker compose -f "$COMPOSE_FILE" up -d "$SERVICE" 2>&1 | tee -a "$LOG_FILE"
else
  # 不在 compose 文件中，尝试直接 docker restart
  docker stop "$SERVICE" 2>/dev/null || true
  docker rm "$SERVICE" 2>/dev/null || true
  docker run -d --name "$SERVICE" --restart unless-stopped "${SERVICE}:latest" 2>&1 | tee -a "$LOG_FILE"
fi

success "容器已重启"

# ── Step 4: 健康检查 ──
if [ -n "$HEALTH_URL" ]; then
  log "健康检查: ${HEALTH_URL} (超时 ${HEALTH_TIMEOUT}s)"

  for i in $(seq 1 $HEALTH_RETRIES); do
    sleep $HEALTH_INTERVAL
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      success "健康检查通过 — 回滚成功！"
      echo ""
      echo "回滚摘要:"
      echo "  服务: $SERVICE"
      echo "  回滚前镜像: ${CURRENT_HASH}"
      echo "  回滚后镜像: ${PREVIOUS_HASH}"
      echo "  日志: $LOG_FILE"
      exit 0
    fi
    log "  等待服务启动... ($i/$HEALTH_RETRIES)"
  done

  error "健康检查超时 — 回滚后服务异常，需要人工介入"
  echo ""
  echo "排查命令:"
  echo "  docker logs $SERVICE --tail 50"
  echo "  curl -v $HEALTH_URL"
  exit 1
else
  # 没有配置健康检查 URL，只验证容器状态
  sleep 3
  if docker ps --format '{{.Names}}' | grep -q "^${SERVICE}$"; then
    success "容器运行中 — 回滚完成（未做 HTTP 健康检查）"
    exit 0
  else
    error "容器未运行 — 回滚可能失败"
    exit 1
  fi
fi
