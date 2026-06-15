#!/usr/bin/env bash
# test-drift.sh — 状态漂移防堵测试：7个API路径全覆盖
set -euo pipefail

HOST="${1:-http://localhost:4000}"
TOKEN="${2:-}"
PASS=0; FAIL=0; RESULTS=(); TS=$(date +%s)

log()  { printf '[test-drift] %s\n' "$*" >&2; }
pass() { PASS=$((PASS+1)); RESULTS+=("PASS:$*"); log "✅ PASS: $*"; }
fail() { FAIL=$((FAIL+1)); RESULTS+=("FAIL:$*"); log "❌ FAIL: $*"; }

http_code() {
  local m=$1 p=$2 d=${3:-}
  local a=(-s -o /dev/null -w '%{http_code}' -X "$m" "${HOST}${p}" -H "Authorization: Bearer ${TOKEN}")
  [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d")
  curl "${a[@]}"
}

api() {
  local m=$1 p=$2 d=${3:-}
  local a=(-s -X "$m" "${HOST}${p}" -H "Authorization: Bearer ${TOKEN}")
  [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d")
  curl "${a[@]}"
}

if [[ -z "$TOKEN" ]]; then
  log "获取 token..."
  TOKEN=$(python3 -c "
import sys; sys.path.insert(0, '/opt/agent-dev-center/scripts')
from adc_client import ADCClient; c=ADCClient(); print(c.token)" 2>/dev/null) || true
  [[ -z "$TOKEN" ]] && { log "无法获取 token"; exit 1; }
fi

log "===== 状态漂移防堵测试 ====="
log "服务器: $HOST"

# 创建测试需求
TEST_REQ=$(api POST '/api/requirements' \
  '{"title":"[test-drift] state drift test","description":"auto test","priority":"P2","type":"BUGFIX","department":"技术部"}')
TEST_ID=$(echo "$TEST_REQ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
[[ -z "$TEST_ID" ]] && { fail "创建测试需求失败"; exit 1; }
pass "创建测试需求 $TEST_ID"
trap "log 清理...; api PATCH /api/requirements/${TEST_ID} '{\"description\":\"cleanup\"}' >/dev/null 2>&1 || true" EXIT

# 1. advance：无工作流 → 400
CODE=$(http_code POST "/api/requirements/${TEST_ID}/workflow/advance" '{}')
[[ "$CODE" == "400" ]] && pass "advance: 无工作流返回 400" || fail "advance: 期望 400 实际 $CODE"

# 2. reject：无工作流 → 400
CODE=$(http_code POST "/api/requirements/${TEST_ID}/workflow/reject" '{"comment":"test"}')
[[ "$CODE" == "400" ]] && pass "reject: 无工作流返回 400" || fail "reject: 期望 400 实际 $CODE"

# 3. PATCH 非法 currentStep → 400
CODE=$(http_code PATCH "/api/requirements/${TEST_ID}" '{"currentStep":"invalid_step"}')
[[ "$CODE" == "400" ]] && pass "PATCH: 非法 currentStep 返回 400" || fail "PATCH: 期望 400 实际 $CODE"

# 4. 无 token → 401
CODE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST "${HOST}/api/requirements/${TEST_ID}/workflow/advance")
[[ "$CODE" == "401" ]] && pass "无 token: advance 返回 401" || fail "无 token: 期望 401 实际 $CODE"

# 5. 非法 method → 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' -XDELETE "${HOST}/api/requirements/${TEST_ID}" -H "Authorization: Bearer ${TOKEN}")
[[ "$CODE" == "404" ]] && pass "DELETE: 返回 404" || fail "DELETE: 期望 404 实际 $CODE"

# 6. 参数校验：空体 → 400
CODE=$(http_code POST '/api/requirements' '{}')
[[ "$CODE" == "400" ]] && pass "参数校验: 空体返回 400" || fail "参数校验: 期望 400 实际 $CODE"

# 7. 认证拦截：invalid token → 401
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${HOST}/api/requirements" -H "Authorization: Bearer invalid")
[[ "$CODE" == "401" ]] && pass "认证: invalid token 返回 401" || fail "认证: 期望 401 实际 $CODE"

# 报告
JSON_REPORT=$(python3 -c "import json; print(json.dumps({'ts':$TS,'total':$((PASS+FAIL)),'passed':$PASS,'failed':$FAIL}))")
echo "$JSON_REPORT"
log "通过: $PASS  失败: $FAIL"
[[ "$FAIL" -gt 0 ]] && exit 1 || exit 0
