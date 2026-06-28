#!/bin/bash
# deploy.sh — ADC 一键部署脚本
# 用法: bash deploy.sh [service] [--skip-migrate] [--skip-verify] [--rollback]
#
# 功能：
# 1. 备份当前镜像（previous 标签）
# 2. Git pull 最新代码
# 3. Docker build
# 4. Prisma migrate
# 5. Docker compose up
# 6. 健康检查
# 7. 失败自动回滚
#
# 设计原则：
# - 每一步都有错误检查，失败立即停止
# - 自动备份，自动回滚
# - 日志记录所有操作
# - 不依赖人工记忆

set -euo pipefail

# ── 配置 ──
SERVICE="${1:-agent-dev-center-backend}"
SKIP_MIGRATE="${2:-}"
SKIP_VERIFY="${3:-}"
ROLLBACK="${4:-}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/deploy-$(date +%Y%m%d-%H%M%S).log"
HEALTH_URL="http://localhost:4000/api/health"
HEALTH_TIMEOUT=30

# ── 日志函数 ──
log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

error() {
  echo "[$(date '+%H:%M:%S')] ❌ $*" | tee -a "$LOG_FILE"
}

success() {
  echo "[$(date '+%H:%M:%S')] ✅ $*" | tee -a "$LOG_FILE"
}

# ── 回滚函数 ──
rollback() {
  error "部署失败，开始回滚..."
  
  # 恢复 previous 镜像
  if docker images "${SERVICE}:previous" --format '{{.Tag}}' | grep -q previous; then
    docker tag "${SERVICE}:previous" "${SERVICE}:latest" 2>/dev/null || true
    docker compose up -d "$SERVICE" 2>/dev/null || true
    sleep 5
    
    # 验证回滚
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      success "回滚成功，服务已恢复"
    else
      error "回滚后服务仍然异常，需要人工介入"
    fi
  else
    error "没有 previous 镜像可回滚"
  fi
  
  exit 1
}

# ── 手动回滚 ──
if [ "$ROLLBACK" = "--rollback" ]; then
  log "手动回滚模式"
  rollback
fi

# ── Step 1: 备份当前镜像 ──
log "Step 1: 备份当前镜像"
if docker images "${SERVICE}:latest" --format '{{.Tag}}' | grep -q latest; then
  docker tag "${SERVICE}:latest" "${SERVICE}:previous" 2>/dev/null || true
  success "已备份 ${SERVICE}:latest -> ${SERVICE}:previous"
else
  log "没有现有镜像需要备份"
fi

# ── Step 2: Git pull ──
log "Step 2: 拉取最新代码"
cd "$PROJECT_DIR"
git pull origin main 2>&1 | tee -a "$LOG_FILE" || {
  error "Git pull 失败"
  rollback
}
success "代码已更新"

# ── Step 3: Docker build ──
log "Step 3: 构建 Docker 镜像"
docker compose build "$SERVICE" 2>&1 | tee -a "$LOG_FILE" || {
  error "Docker build 失败"
  rollback
}
success "镜像构建完成"

# ── Step 4: Prisma migrate ──
if [ "$SKIP_MIGRATE" != "--skip-migrate" ]; then
  log "Step 4: 执行数据库迁移"
  docker compose run --rm "$SERVICE" npx prisma migrate deploy --schema=backend/prisma/schema.prisma 2>&1 | tee -a "$LOG_FILE" || {
    error "Prisma migrate 失败"
    rollback
  }
  success "数据库迁移完成"
else
  log "Step 4: 跳过数据库迁移"
fi

# ── Step 5: Docker compose up ──
log "Step 5: 启动服务"
docker compose up -d "$SERVICE" 2>&1 | tee -a "$LOG_FILE" || {
  error "Docker compose up 失败"
  rollback
}
success "服务已启动"

# ── Step 6: 健康检查 ──
if [ "$SKIP_VERIFY" != "--skip-verify" ]; then
  log "Step 6: 健康检查（${HEALTH_TIMEOUT}s 超时）"
  
  for i in $(seq 1 6); do
    sleep 5
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      success "健康检查通过"
      
      # 记录部署信息
      echo "$(date '+%Y-%m-%d %H:%M:%S') | $SERVICE | $(git rev-parse --short HEAD) | SUCCESS" >> /var/log/deploy.log 2>/dev/null || true
      
      log "部署完成！"
      log "日志: $LOG_FILE"
      exit 0
    fi
    log "  等待服务启动... ($i/6)"
  done
  
  error "健康检查超时"
  rollback
else
  log "Step 6: 跳过健康检查"
  success "部署完成（未验证）"
fi
