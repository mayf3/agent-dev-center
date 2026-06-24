#!/bin/bash
# 🔍 账号健康检查脚本
# 遍历所有 Agent 账号测试登录，失败时 exit 1（用于 cron 告警）
set -euo pipefail

ADC_HOST="${1:-http://127.0.0.1:4000}"
CONT_NAME="agent-dev-center-postgres"
DB_NAME="agent_dev_center"
FAILED=0
PASSED=0
FAILED_LIST=()

echo "=== 🔍 账号健康检查 $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

# Get all users from DB
if docker ps --format "{{.Names}}" | grep -q "$CONT_NAME"; then
  USERS=$(docker exec "$CONT_NAME" psql -U postgres -d "$DB_NAME" -t -A -F '|' \
    -c "SELECT email FROM users ORDER BY email;" 2>/dev/null)
else
  echo "❌ 无法连接到 PostgreSQL 容器 ($CONT_NAME)"
  exit 1
fi

COUNT=$(echo "$USERS" | grep -c . || true)
echo "=== 遍历 $COUNT 个账号 ==="

while IFS='|' read -r EMAIL; do
  [ -z "$EMAIL" ] && continue

  RESPONSE=$(curl -s -X POST "$ADC_HOST/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"{your-test-password}\"}" 2>/dev/null)

  TOKEN=$(echo "$RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('accessToken',''))
except:
    print('')
" 2>/dev/null)

  if [ -n "$TOKEN" ]; then
    PASSED=$((PASSED + 1))
  else
    ERR=$(echo "$RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('message','Unknown error'))
except:
    print('Connection failed')
" 2>/dev/null)
    echo "  ❌ $EMAIL — $ERR"
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$EMAIL")
  fi
done <<< "$USERS"

echo ""
echo "=== 结果 ==="
echo "总计: $((PASSED + FAILED))"
echo "✅ 通过: $PASSED"
echo "❌ 失败: $FAILED"

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "❌ 失败账号列表:"
  for EMAIL in "${FAILED_LIST[@]}"; do
    echo "  - $EMAIL"
  done
  exit 1
fi

echo "✅ 所有账号登录正常"
exit 0
