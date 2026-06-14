#!/usr/bin/env bash
# rollback.sh — Docker 一键回滚工具
#
# 用法:
#   ./scripts/rollback.sh                    # 交互式：列出备份镜像，选择回滚
#   ./scripts/rollback.sh --list             # 列出当前备份
#   ./scripts/rollback.sh --auto             # 自动回滚所有带 :previous 标签的镜像
#   ./scripts/rollback.sh <image> [image...] # 指定镜像回滚
#
# 环境变量:
#   COMPOSE_FILE  — docker-compose 文件（默认: docker-compose.prod.yml）
#   ENV_FILE      — 环境变量文件（默认: .env.production）
#

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/rollback-utils.sh"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

# ── 参数解析 ──
case "${1:-}" in
  --list|-l)
    list_backups
    exit 0
    ;;
  --auto|-a)
    shift
    # 自动检测所有 :previous 镜像
    mapfile -t images < <(docker image ls --filter "reference=*:previous" --format "{{.Repository}}:{{.Tag}}" | sed 's/:previous$//')
    if [ ${#images[@]} -eq 0 ]; then
      _error "没有找到备份镜像（:previous 标签）"
      exit 1
    fi
    _info "自动回滚镜像: ${images[*]}"
    rollback_images "${images[@]}"
    exit $?
    ;;
  --help|-h)
    echo "Docker 一键回滚工具"
    echo ""
    echo "用法:"
    echo "  rollback.sh             交互式回滚"
    echo "  rollback.sh --list      列出备份"
    echo "  rollback.sh --auto      自动回滚全部"
    echo "  rollback.sh img1 img2   指定镜像回滚"
    exit 0
    ;;
esac

# ── 交互式回滚 — 在非 TTY 下用非交互方式 ──
if [ $# -gt 0 ]; then
  # 指定镜像回滚
  rollback_images "$@"
else
  # 列出并回滚所有
  mapfile -t images < <(docker image ls --filter "reference=*:previous" --format "{{.Repository}}:{{.Tag}}" | sed 's/:previous$//')
  if [ ${#images[@]} -eq 0 ]; then
    _error "没有找到备份镜像（:previous 标签），尚无已备份的部署"
    exit 1
  fi
  _info "发现以下可回滚镜像:"
  for img in "${images[@]}"; do
    printf "  • %s\n" "${img}"
  done
  rollback_images "${images[@]}"
fi
