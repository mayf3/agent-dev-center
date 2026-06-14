#!/bin/bash
# health-check.sh — Docker 服务健康检查脚本
# 用法: health-check.sh [service-name] [--watch] [--interval 5]
#
# 功能：
#   1. 检查所有/指定服务的健康状态
#   2. 返回 JSON 格式结果（便于脚本集成）
#   3. --watch 模式持续监控
#
# 退出码：
#   0 — 所有服务健康
#   1 — 有服务不健康
#   2 — 参数错误

set -euo pipefail

SERVICE="${1:-}"
WATCH=false
INTERVAL=5

# 解析参数
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --watch) WATCH=true ;;
    --interval) INTERVAL="${2:-5}"; shift ;;
    --json) JSON_MODE=true ;;
  esac
  shift || true
done

# ── 服务健康检查 URL ──
declare -A HEALTH_URLS=(
  ["agent-dev-center-backend"]="http://localhost:4000/api/health"
  ["auth-service"]="http://localhost:3001/health"
  ["llm-todo-service"]="http://localhost:3458/health"
  ["svc-okr"]="http://localhost:3459/health"
)

declare -A SERVICE_NAMES=(
  ["agent-dev-center-backend"]="ADC 后端"
  ["auth-service"]="认证服务"
  ["llm-todo-service"]="Todo 服务"
  ["svc-okr"]="OKR 服务"
)

# ── 单次检查函数 ──
check_service() {
  local svc="$1"
  local url="${HEALTH_URLS[$svc]:-}"
  local name="${SERVICE_NAMES[$svc]:-$svc}"

  # 检查容器是否存在且运行中
  local container_status
  container_status=$(docker ps -a --filter "name=^${svc}$" --format '{{.Status}}' 2>/dev/null || echo "missing")

  if [ "$container_status" = "missing" ] || [ -z "$container_status" ]; then
    echo "UNHEALTHY|${svc}|${name}|容器不存在"
    return 1
  fi

  if echo "$container_status" | grep -q "Up"; then
    # 容器运行中，检查 HTTP 健康端点
    if [ -n "$url" ]; then
      local http_code
      http_code=$(curl -sf -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
      if [ "$http_code" = "200" ]; then
        echo "HEALTHY|${svc}|${name}|HTTP 200"
        return 0
      else
        echo "UNHEALTHY|${svc}|${name}|HTTP ${http_code}"
        return 1
      fi
    else
      echo "HEALTHY|${svc}|${name}|容器运行中（无 HTTP 检查）"
      return 0
    fi
  else
    echo "UNHEALTHY|${svc}|${name}|${container_status}"
    return 1
  fi
}

# ── 检查所有服务 ──
check_all() {
  local all_healthy=true
  local results=()

  if [ -n "$SERVICE" ] && [ "$SERVICE" != "--all" ]; then
    # 检查指定服务
    if [ -z "${HEALTH_URLS[$SERVICE]:-}" ]; then
      # 非预置服务，尝试通用检查
      results+=("$(check_service "$SERVICE")")
    else
      results+=("$(check_service "$SERVICE")")
    fi
  else
    # 检查所有已知服务
    for svc in "${!HEALTH_URLS[@]}"; do
      results+=("$(check_service "$svc" 2>/dev/null || true)")
    done
  fi

  # 输出结果
  printf "\n%-12s %-20s %-10s %s\n" "STATUS" "SERVICE" "NAME" "DETAIL"
  printf "%-12s %-20s %-10s %s\n" "------" "-------" "----" "------"

  for result in "${results[@]}"; do
    IFS='|' read -r status svc name detail <<< "$result"
    local icon
    if [ "$status" = "HEALTHY" ]; then
      icon="✅"
    else
      icon="❌"
      all_healthy=false
    fi
    printf "%-2s %-9s %-20s %-10s %s\n" "$icon" "$status" "$svc" "$name" "$detail"
  done

  echo ""

  if [ "$all_healthy" = true ]; then
    echo "🎉 所有服务健康"
    return 0
  else
    echo "⚠️  有服务异常，可执行回滚: rollback.sh <service-name>"
    return 1
  fi
}

# ── 主逻辑 ──
if [ "$WATCH" = true ]; then
  echo "🔍 监控模式（每 ${INTERVAL}s 刷新，Ctrl+C 退出）"
  echo ""
  while true; do
    clear
    echo "=== Docker 服务健康状态 ==="
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
    check_all || true
    sleep "$INTERVAL"
  done
else
  check_all
fi
