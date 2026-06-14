#!/usr/bin/env bash
# rollback-utils.sh — Docker 部署回滚工具库
#
# 提供函数给 deploy.sh 使用，实现"保留上一版本镜像 + 一键回退"
#
# 用法:
#   source scripts/rollback-utils.sh
#   backup_images "agent-dev-center-backend" "agent-dev-center-frontend"
#   rollback_images "agent-dev-center-backend" "agent-dev-center-frontend"
#

set -Eeuo pipefail

# ── 颜色 / 日志 ──
_info()  { printf '\033[36m[rollback]\033[0m %s\n' "$*"; }
_ok()    { printf '\033[32m[rollback] ✔ %s\033[0m\n' "$*"; }
_warn()  { printf '\033[33m[rollback] ⚠ %s\033[0m\n' "$*"; }
_error() { printf '\033[31m[rollback] ✘ %s\033[0m\n' "$*" >&2; }

# ── 函数 ──

# backup_images <image_name> [image_name ...]
# 用法: 构建新镜像之前调用
# 作用: 将已有的 :prod 标签镜像备份为 :previous
#       如果不存在 :prod 镜像则跳过（首次部署）
backup_images() {
  local has_previous=false
  for img in "$@"; do
    if docker image inspect "${img}:prod" >/dev/null 2>&1; then
      _info "备份镜像: ${img}:prod → ${img}:previous"
      docker tag "${img}:prod" "${img}:previous"
      has_previous=true
    else
      _warn "镜像 ${img}:prod 不存在，跳过备份（可能是首次部署）"
    fi
  done

  if $has_previous; then
    _ok "镜像备份完成"
  fi
}

# rollback_images <image_name> [image_name ...]
# 用法: 手动或自动回滚时调用
# 作用: 将 :previous 标签恢复为 :prod，保留故障镜像为 :failed
rollback_images() {
  local any_rolled=false
  for img in "$@"; do
    if docker image inspect "${img}:previous" >/dev/null 2>&1; then
      # 如果当前有 :prod 镜像，先标记为 :failed
      if docker image inspect "${img}:prod" >/dev/null 2>&1; then
        _info "标记故障镜像: ${img}:prod → ${img}:failed"
        docker tag "${img}:prod" "${img}:failed" 2>/dev/null || true
      fi

      _info "执行回滚: ${img}:previous → ${img}:prod"
      docker tag "${img}:previous" "${img}:prod"
      any_rolled=true
    else
      _warn "镜像 ${img}:previous 不存在，无法回滚"
    fi
  done

  if $any_rolled; then
    docker compose --env-file "${ENV_FILE:-.env.production}" -f "${COMPOSE_FILE:-docker-compose.prod.yml}" up -d --remove-orphans
    _ok "回滚完成 — 服务已重启"
  else
    _error "没有可回滚的镜像"
    return 1
  fi
}

# auto_rollback_on_fail <health_check_url> <image_name> [image_name ...]
# 用法: deploy.sh 在 docker compose up -d 之后调用
# 作用: 检查健康端点，如果失败则自动回滚
auto_rollback_on_fail() {
  local health_url="${1:-}"
  shift 2>/dev/null || true

  if [ -z "$health_url" ]; then
    _warn "auto_rollback_on_fail: 未传入健康检查 URL，跳过自动回滚"
    return 0
  fi

  local max_retries=12   # 约 60 秒超时
  local retry_interval=5 # 秒

  _info "健康检查: ${health_url}（最多等待 $((max_retries * retry_interval)) 秒）"

  local success=false
  for ((i=1; i<=max_retries; i++)); do
    if curl -sf "${health_url}" >/dev/null 2>&1; then
      success=true
      break
    fi
    _info "等待服务就绪... (${i}/${max_retries})"
    sleep "${retry_interval}"
  done

  if $success; then
    _ok "健康检查通过 — ${health_url}"
    return 0
  fi

  _error "健康检查失败 — ${health_url}，触发自动回滚！"

  if [ $# -eq 0 ]; then
    _error "未提供镜像名，无法自动回滚"
    return 1
  fi

  rollback_images "$@"
  return 1
}

# list_backups
# 列出所有带有 :previous 标签的镜像
list_backups() {
  docker image ls --filter "reference=*:previous" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"
}

# ── 独立入口（当直接执行此脚本时触发 rollback）──
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "${1:-}" = "list" ]; then
    list_backups
  elif [ "${1:-}" = "rollback" ]; then
    shift
    if [ $# -eq 0 ]; then
      _error "用法: rollback-utils.sh rollback <image_name> [image_name ...]"
      exit 1
    fi
    rollback_images "$@"
  else
    echo "用法:"
    echo "  source rollback-utils.sh    # 作为库导入"
    echo "  rollback-utils.sh list      # 列出备份镜像"
    echo "  rollback-utils.sh rollback <image> [image...]  # 执行回滚"
  fi
fi
