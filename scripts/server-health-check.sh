#!/usr/bin/env bash
set -euo pipefail

# ===========================================================
# ADC 平台服务器端健康检查脚本
# 被 post-receive hook 和 cron 调用
# 用法: ./scripts/server-health-check.sh [--notify]
# ===========================================================

# 配置
ADC_URL="http://{your-server-ip}"  # localhost 走 HTTP（Nginx 内部转发）
ADC_HTTPS="https://{your-server-ip}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CHECK_FAILED=false
FAILURES=""

check_endpoint() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local desc="$4"

  echo -n "  $name ... "
  local status
  status=$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || echo "failed")

  if [[ "$status" == "$expected" || "$status" =~ ^($expected)$ ]]; then
    echo -e "${GREEN}✅ $status${NC}"
  else
    echo -e "${RED}❌ $status (expected $expected)${NC}"
    CHECK_FAILED=true
    FAILURES="${FAILURES}${name}: got ${status}, expected ${expected}\n"
  fi
}

echo "=== ADC 平台健康检查 ($TIMESTAMP) ==="
echo ""

# 1. 前端是否可达
check_endpoint "前端首页   " "$ADC_HTTPS/" "200" "SPA 首页"

# 2. API 健康检查
check_endpoint "API 健康   " "$ADC_HTTPS/api/health" "200" "健康检查端点"

# 3. API 登录端点（401=路由存在需认证）
echo -n "  API 登录   ... "
AUTH_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"email":"test@test.com","password":"wrong"}' --connect-timeout 5 --max-time 10 "$ADC_HTTPS/api/auth/login" 2>/dev/null || echo "failed")
if [[ "$AUTH_STATUS" == "401" || "$AUTH_STATUS" == "200" ]]; then
  echo -e "${GREEN}✅ $AUTH_STATUS${NC}"
else
  echo -e "${RED}❌ $AUTH_STATUS (expected 401/200)${NC}"
  CHECK_FAILED=true
  FAILURES="${FAILURES}API 登录: got ${AUTH_STATUS}, expected 401|200\n"
fi

# 4. 需求列表（401=路由存在需认证）
check_endpoint "需求列表   " "$ADC_HTTPS/api/requirements" "401|200" "GET 需求"

# 5. Docker 容器健康
echo -n "  Docker 状态 ... "
DOCKER_OK=$(docker ps --filter "name=agent-dev-center" --format '{{.Names}} {{.Status}}' 2>/dev/null || echo "")
if echo "$DOCKER_OK" | grep -q "healthy"; then
  echo -e "${GREEN}✅${NC}"
  echo "$DOCKER_OK" | while read -r line; do echo "     $line"; done
else
  echo -e "${RED}❌ 容器非健康状态${NC}"
  CHECK_FAILED=true
  FAILURES="${FAILURES}Docker containers not healthy\n"
  echo "$DOCKER_OK" | while read -r line; do echo "     $line"; done
fi

echo ""

if [[ "$CHECK_FAILED" == "true" ]]; then
  echo -e "${RED}❌ 健康检查失败！${NC}"
  echo -e "失败项目:\n$FAILURES"

  # 尝试自动恢复
  echo ">>> 尝试自动恢复..."
  docker restart agent-dev-center-backend 2>/dev/null || true
  sleep 5

  # 恢复后重验
  echo ">>> 恢复后重验..."
  RETRY_OK=true
  for url in "$ADC_HTTPS/" "$ADC_HTTPS/api/health"; do
    status=$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || echo "failed")
    if [[ "$status" != "200" ]]; then
      RETRY_OK=false
    fi
  done

  if [[ "$RETRY_OK" == "true" ]]; then
    echo -e "${GREEN}✅ 自动恢复成功${NC}"
    exit 0
  else
    echo -e "${RED}❌ 自动恢复失败，需要人工介入${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}✅ 全部检查通过${NC}"
fi
