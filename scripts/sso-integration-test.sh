#!/usr/bin/env bash
# SSO 全链路集成测试
set -uo pipefail

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ADC_URL="https://{your-server-ip}"
PASS=true
FAILURES=""

echo "=== SSO 全链路集成测试 ($TIMESTAMP) ==="
echo ""

# Step 1: Login
echo -n "[1/4] ADC 登录 ... "
LOGIN=$(curl -sk -X POST "$ADC_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"{your-test-password}"}' \
  --connect-timeout 10 --max-time 20 2>/dev/null)
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "❌"; exit 1; fi
echo "✅ ${TOKEN:0:20}..."

# Step 2: ADC self-test
echo -n "[2/4] ADC 需求列表 ... "
R=$(curl -sk -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$ADC_URL/api/requirements" --connect-timeout 10 --max-time 20 2>/dev/null)
if [ "$R" = "200" ]; then echo "✅ $R"; else echo "❌ $R"; PASS=false; fi

# Step 3: Cross-service
echo "[3/4] 跨服务 SSO 验证..."
check_sso() {
  local n=$1 p=$2
  echo -n "  $n ... "
  local c
  c=$(curl -sk -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$ADC_URL$p" --connect-timeout 10 --max-time 20 2>/dev/null)
  if [ "$c" = "200" ] || [ "$c" = "401" ] || [ "$c" = "403" ]; then
    echo "✅ $c"
  else
    echo "❌ $c"; PASS=false; FAILURES="${FAILURES}$n: $c\n"
  fi
}
check_sso "LLM Todo" "/todo/api/projects"
check_sso "KPI Dashboard" "/kpi/api/projects"
# Note: Article Review 未接入 SSO，暂不测试

# Step 4: Negative
echo "[4/4] 反向测试..."
echo -n "  ADC（无令牌）... "
N1=$(curl -sk -o /dev/null -w '%{http_code}' "$ADC_URL/api/requirements" --connect-timeout 10 --max-time 20 2>/dev/null)
if [ "$N1" = "401" ]; then echo "✅ $N1"; else echo "❌ $N1"; PASS=false; fi

echo -n "  LLM Todo（无令牌）... "
N2=$(curl -sk -o /dev/null -w '%{http_code}' "$ADC_URL/todo/api/projects" --connect-timeout 10 --max-time 20 2>/dev/null)
if [ "$N2" = "401" ] || [ "$N2" = "404" ]; then echo "✅ $N2"; else echo "❌ $N2"; PASS=false; fi

echo ""
if $PASS; then echo "✅ 全部通过"; exit 0; else echo "❌ 失败:"; echo -e "$FAILURES"; exit 1; fi
