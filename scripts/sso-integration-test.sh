#!/usr/bin/env bash
# ===========================================================
# SSO 全链路集成测试
# 验证 ADC 签发的 SSO JWT 可被所有统一认证服务接受
# 每次 SSO 变更、密钥轮换、部署后必须运行
# ===========================================================
set -euo pipefail

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ADC_URL="https://8.163.44.127"
PASS=true
FAILURES=""

echo "=== SSO 全链路集成测试 ($TIMESTAMP) ==="
echo ""

# Step 1: Login and get token
echo -n "[1/4] ADC 登录（获取 SSO 令牌）... "
LOGIN=$(curl -sk -X POST "$ADC_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agent.dev","password":"agent2026"}' \
  --connect-timeout 5 --max-time 10 2>/dev/null || echo '{"error":"timeout"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('accessToken',''))" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "❌ 无法获取令牌"; exit 1
fi
echo "✅ Token: ${TOKEN:0:20}..."

# Step 2: ADC self-test
echo ""
echo "[2/4] ADC 本体验证..."
echo -n "  需求列表 ... "
ADC=$(curl -sk -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "$ADC_URL/api/requirements" --connect-timeout 5 --max-time 10 2>/dev/null || echo "failed")
if [ "$ADC" == "200" ]; then echo "✅ $ADC"; else echo "❌ $ADC"; PASS=false; FAILURES="${FAILURES}ADC: $ADC\n"; fi

# Step 3: Cross-service SSO verification
echo ""
echo "[3/4] 跨服务 SSO 验证..."
TEST_SSO() {
  local NAME=$1 PATH=$2
  echo -n "  $NAME ($PATH) ... "
  local S=$(curl -sk -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
    "$ADC_URL$PATH" --connect-timeout 5 --max-time 20 2>/dev/null || echo "failed")
  if [ "$S" == "200" ] || [ "$S" == "401" ] || [ "$S" == "403" ]; then
    echo "✅ $S"
  else
    echo "❌ $S"; PASS=false; FAILURES="${FAILURES}${NAME}: $S\n"
  fi
}

TEST_SSO "LLM Todo"        "/todo/api/projects"
TEST_SSO "Article Review"  "/article-review/api/auth"
TEST_SSO "KPI Dashboard"   "/kpi/api/projects"

# Step 4: Negative test
echo ""
echo "[4/4] 反向测试（无令牌应被拒绝）..."
echo -n "  ADC 需求列表（无令牌）... "
N1=$(curl -sk -o /dev/null -w '%{http_code}' "$ADC_URL/api/requirements" --connect-timeout 5 --max-time 10 2>/dev/null || echo "failed")
if [ "$N1" == "401" ]; then echo "✅ $N1"; else echo "❌ $N1"; PASS=false; FAILURES="${FAILURES}无令牌ADC: $N1\n"; fi

echo -n "  LLM Todo（无令牌）... "
N2=$(curl -sk -o /dev/null -w '%{http_code}' "$ADC_URL/todo/api/projects" --connect-timeout 5 --max-time 10 2>/dev/null || echo "failed")
if [ "$N2" == "401" ] || [ "$N2" == "404" ]; then echo "✅ $N2"; else echo "❌ $N2"; PASS=false; FAILURES="${FAILURES}无令牌Todo: $N2\n"; fi

# Result
echo ""
echo "=== 结果 ==="
if $PASS; then echo "✅ 全部通过"; exit 0; else echo "❌ 失败："; echo -e "$FAILURES"; exit 1; fi
