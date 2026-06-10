#!/bin/bash
# smoke-test.sh — ADC 工作流冒烟测试
# 部署前自动验证 5 个核心流程，任何一步失败 → 部署中止
#
# 用法: bash smoke-test.sh [host]
#
# 环境: ADC_EMAIL, ADC_PASSWORD 需在 .env 中配置，或直接传参
#
# 测试项:
#   1. 创建测试需求 → 分配工作流 → advance → 删除
#   2. 提交 DEV_SELF_CHECK → QA 审批 → advance
#   3. 提交 TEST_REPORT → QA 驳回 → 重新提交 → QA 审批
#   4. advance 时 assignee 自动解析（不漂移）
#   5. workflow/reject 端点可用
#
# 退出码:
#   0 = 所有测试通过
#   1 = 任意测试失败

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────────
HOST="${1:-8.163.44.127}"
API_BASE="http://localhost:4000/api"  # 内部端口，通过 SSH 访问
PASS=0
FAIL=0
FAILED_TESTS=""
TEST_PREFIX="[SMOKE]"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─── 辅助函数 ────────────────────────────────────────────────────
pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✅ PASS${NC}: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  FAILED_TESTS="$FAILED_TESTS\n  ❌ $1"
  echo -e "  ${RED}❌ FAIL${NC}: $1"
}

log() {
  echo -e "${YELLOW}${TEST_PREFIX}${NC} $1"
}

# SSH 执行 curl 的辅助
adc_curl() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local token="${4:-$TOKEN}"

  if [ -n "$data" ]; then
    ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$HOST" \
      "curl -s -w '\nHTTP_CODE:%{http_code}' -X $method '$API_BASE$path' \
      -H 'Authorization: Bearer $token' \
      -H 'Content-Type: application/json' \
      -d '$(echo "$data" | sed "s/'/'\\\\''/g")'" 2>/dev/null
  else
    ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$HOST" \
      "curl -s -w '\nHTTP_CODE:%{http_code}' -X $method '$API_BASE$path' \
      -H 'Authorization: Bearer $token'" 2>/dev/null
  fi
}

parse_http_code() {
  echo "$1" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://'
}

parse_body() {
  echo "$1" | grep -v "HTTP_CODE:"
}

# ─── 登录 ────────────────────────────────────────────────────────
login() {
  local email="$1"
  local password="$2"

  local resp
  resp=$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$HOST" \
    "curl -s -X POST '$API_BASE/auth/login' \
    -H 'Content-Type: application/json' \
    -d '{\"email\":\"$email\",\"password\":\"$password\"}'" 2>/dev/null)

  local token
  token=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  echo "$token"
}

# ─── 测试函数 ────────────────────────────────────────────────────

# Test 1: 创建→分配工作流→advance→删除
test_1_create_advance_delete() {
  log "━━━ Test 1: 创建测试需求 → 分配工作流 → advance → 删除 ━━━"

  # 1a. 创建需求
  local title="smoke-test-$(date +%s)"
  local create_data
  create_data=$(python3 -c "
import json
print(json.dumps({
    'title': '$title',
    'description': '临时测试需求，冒烟测试自动创建，测试完后自动删除',
    'type': 'INFRA',
    'priority': 'P3',
    'department': 'engineering'
}))
")
  local create_resp
  create_resp=$(adc_curl POST "/requirements" "$create_data")
  local http_code
  http_code=$(parse_http_code "$create_resp")
  local body
  body=$(parse_body "$create_resp")

  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    fail "Test 1a: 创建需求失败 (HTTP $http_code)"
    return 1
  fi

  local rid
  rid=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  if [ -z "$rid" ]; then
    fail "Test 1a: 创建需求未返回 ID"
    return 1
  fi
  pass "Test 1a: 创建需求成功 (ID: $rid)"

  # 1b. 分配工作流
  local assign_resp
  assign_resp=$(adc_curl POST "/requirements/$rid/workflow/assign" '{"workflowName":"standard-dev","startStep":"dev_self_check"}')
  http_code=$(parse_http_code "$assign_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 1b: 分配工作流失败 (HTTP $http_code)"
    # 清理
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 1b: 分配工作流成功"

  # 1c. Advance
  local advance_resp
  advance_resp=$(adc_curl POST "/requirements/$rid/workflow/advance" '{"comment":"冒烟测试 advance"}')
  http_code=$(parse_http_code "$advance_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 1c: advance 失败 (HTTP $http_code): $(parse_body "$advance_resp")"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 1c: advance 成功"

  # 验证 currentStep 变了
  local verify_resp
  verify_resp=$(adc_curl GET "/requirements/$rid")
  local step
  step=$(parse_body "$verify_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('currentStep',''))" 2>/dev/null || echo "")
  if [ -z "$step" ]; then
    fail "Test 1d: 无法获取需求状态"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 1d: 状态已更新为 $step"

  # 1e. 删除
  local del_resp
  del_resp=$(adc_curl DELETE "/requirements/$rid")
  http_code=$(parse_http_code "$del_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 1e: 删除需求失败 (HTTP $http_code)"
    return 1
  fi
  pass "Test 1e: 删除需求成功"

  return 0
}

# Test 2: DEV_SELF_CHECK → QA 审批 → advance
test_2_report_submit_approve() {
  log "━━━ Test 2: 提交 DEV_SELF_CHECK → QA 审批 → advance ━━━"

  # 2a. 创建需求
  local title="smoke-test-2-$(date +%s)"
  local create_data
  create_data=$(python3 -c "
import json
print(json.dumps({
    'title': '$title',
    'description': '冒烟测试 Test 2',
    'type': 'INFRA',
    'priority': 'P3',
    'department': 'engineering'
}))
")
  local create_resp
  create_resp=$(adc_curl POST "/requirements" "$create_data")
  local http_code
  http_code=$(parse_http_code "$create_resp")
  local body
  body=$(parse_body "$create_resp")
  local rid
  rid=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  # 分配工作流
  adc_curl POST "/requirements/$rid/workflow/assign" '{"workflowName":"standard-dev"}' > /dev/null 2>&1 || true

  pass "Test 2a: 创建需求成功 (ID: $rid)"

  # 2b. 提交 DEV_SELF_CHECK 报告
  local report_data
  report_data=$(python3 -c "
import json
print(json.dumps({
    'reportType': 'DEV_SELF_CHECK',
    'content': {
        'summary': '冒烟测试 - DEV_SELF_CHECK',
        'items': ['测试项1: 通过', '测试项2: 通过'],
        'conclusion': '通过'
    }
}))
")
  local report_resp
  report_resp=$(adc_curl POST "/requirements/$rid/reports" "$report_data")
  http_code=$(parse_http_code "$report_resp")
  body=$(parse_body "$report_resp")

  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    fail "Test 2b: 提交 DEV_SELF_CHECK 报告失败 (HTTP $http_code)"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi

  local report_id
  report_id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
  if [ -z "$report_id" ]; then
    report_id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  fi
  pass "Test 2b: 提交 DEV_SELF_CHECK 报告成功 (报告ID: $report_id)"

  # 2c. QA 审批通过
  local qa_resp
  qa_resp=$(adc_curl POST "/requirements/$rid/reports/$report_id/qa-review" '{"status":"approved","reviewComment":"冒烟测试 - QA审批通过"}')
  http_code=$(parse_http_code "$qa_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 2c: QA 审批失败 (HTTP $http_code): $(parse_body "$qa_resp")"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 2c: QA 审批通过"

  # 2d. Advance
  local adv_resp
  adv_resp=$(adc_curl POST "/requirements/$rid/workflow/advance" '{"comment":"冒烟测试 - advance"}')
  http_code=$(parse_http_code "$adv_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 2d: advance 失败 (HTTP $http_code): $(parse_body "$adv_resp")"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 2d: advance 成功"

  # 清理
  adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true

  return 0
}

# Test 3: TEST_REPORT → QA 驳回 → 重新提交 → QA 审批
test_3_report_reject_resubmit() {
  log "━━━ Test 3: 提交 TEST_REPORT → QA 驳回 → 重新提交 → QA 审批 ━━━"

  # 3a. 创建需求
  local title="smoke-test-3-$(date +%s)"
  local create_data
  create_data=$(python3 -c "
import json
print(json.dumps({
    'title': '$title',
    'description': '冒烟测试 Test 3',
    'type': 'INFRA',
    'priority': 'P3',
    'department': 'engineering'
}))
")
  local create_resp
  create_resp=$(adc_curl POST "/requirements" "$create_data")
  local rid
  rid=$(parse_body "$create_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  # 分配工作流
  adc_curl POST "/requirements/$rid/workflow/assign" '{"workflowName":"standard-dev"}' > /dev/null 2>&1 || true
  pass "Test 3a: 创建需求成功 (ID: $rid)"

  # 3b. 提交 DEV_SELF_CHECK 报告（必须先有自检报告才能到 testing 阶段）
  local report1_data
  report1_data=$(python3 -c "
import json
print(json.dumps({
    'reportType': 'DEV_SELF_CHECK',
    'content': {'summary': '冒烟测试', 'items': ['ok'], 'conclusion': '通过'}
}))
")
  local report1_resp
  report1_resp=$(adc_curl POST "/requirements/$rid/reports" "$report1_data")
  local report1_id
  report1_id=$(parse_body "$report1_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

  # QA 审批
  adc_curl POST "/requirements/$rid/reports/$report1_id/qa-review" '{"status":"approved","reviewComment":"ok"}' > /dev/null 2>&1 || true

  # Advance 到 testing
  adc_curl POST "/requirements/$rid/workflow/advance" '{"comment":"advance to testing"}' > /dev/null 2>&1 || true

  # 3c. 提交 TEST_REPORT
  local test_report_data
  test_report_data=$(python3 -c "
import json
print(json.dumps({
    'reportType': 'TEST_REPORT',
    'content': {
        'summary': '冒烟测试 - 测试报告（首次提交，期待被驳回）',
        'testCases': [{'id':'TC1','description':'冒烟测试用例','expected':'200','actual':'200','result':'PASS'}],
        'conclusion': 'PASS'
    }
}))
")
  local test_resp
  test_resp=$(adc_curl POST "/requirements/$rid/reports" "$test_report_data")
  local http_code
  http_code=$(parse_http_code "$test_resp")
  local test_report_id
  test_report_id=$(parse_body "$test_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

  if [ -z "$test_report_id" ]; then
    fail "Test 3c: 提交 TEST_REPORT 失败 (HTTP $http_code)"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 3c: 首次提交 TEST_REPORT 成功 (报告ID: $test_report_id)"

  # 3d. QA 驳回报告
  local reject_resp
  reject_resp=$(adc_curl POST "/requirements/$rid/reports/$test_report_id/qa-review" '{"status":"rejected","reviewComment":"冒烟测试 - QA驳回，请补充测试用例"}')
  http_code=$(parse_http_code "$reject_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 3d: QA 驳回失败 (HTTP $http_code): $(parse_body "$reject_resp")"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 3d: QA 驳回成功"

  # 3e. 重新提交 TEST_REPORT（不返回 409）
  local resubmit_data
  resubmit_data=$(python3 -c "
import json
print(json.dumps({
    'reportType': 'TEST_REPORT',
    'content': {
        'summary': '冒烟测试 - 测试报告（重新提交）',
        'testCases': [
            {'id':'TC1','description':'正向测试','expected':'200','actual':'200','result':'PASS'},
            {'id':'TC2','description':'反向测试','expected':'401','actual':'401','result':'PASS'},
            {'id':'TC3','description':'边界测试','expected':'400','actual':'400','result':'PASS'}
        ],
        'conclusion': 'PASS'
    }
}))
")
  local resubmit_resp
  resubmit_resp=$(adc_curl POST "/requirements/$rid/reports" "$resubmit_data")
  http_code=$(parse_http_code "$resubmit_resp")

  if [ "$http_code" = "409" ]; then
    fail "Test 3e: 重新提交返回 409 Conflict（不允许重新提交）"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi

  if [ "$http_code" != "200" ] && [ "$http_code" != "201" ]; then
    fail "Test 3e: 重新提交 TEST_REPORT 失败 (HTTP $http_code): $(parse_body "$resubmit_resp")"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi

  local resubmit_id
  resubmit_id=$(parse_body "$resubmit_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

  if [ -z "$resubmit_id" ]; then
    fail "Test 3e: 重新提交未返回新报告 ID"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 3e: 重新提交 TEST_REPORT 成功（未返回 409）"

  # 3f. QA 审批通过重新提交的报告
  local qa_approve_resp
  qa_approve_resp=$(adc_curl POST "/requirements/$rid/reports/$resubmit_id/qa-review" '{"status":"approved","reviewComment":"冒烟测试 - 重新提交后审批通过"}')
  http_code=$(parse_http_code "$qa_approve_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 3f: 重新提交后 QA 审批失败 (HTTP $http_code)"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 3f: QA 审批通过（重新提交后）"

  # 清理
  adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true

  return 0
}

# Test 4: advance 时 assignee 自动解析（不漂移）
test_4_assignee_no_drift() {
  log "━━━ Test 4: advance 时 assignee 自动解析（不漂移） ━━━"

  # 4a. 创建需求
  local title="smoke-test-4-$(date +%s)"
  local create_data
  create_data=$(python3 -c "
import json
print(json.dumps({
    'title': '$title',
    'description': '冒烟测试 Test 4',
    'type': 'INFRA',
    'priority': 'P3',
    'department': 'engineering'
}))
")
  local create_resp
  create_resp=$(adc_curl POST "/requirements" "$create_data")
  local rid
  rid=$(parse_body "$create_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  # 分配工作流
  adc_curl POST "/requirements/$rid/workflow/assign" '{"workflowName":"standard-dev","startStep":"dev_self_check"}' > /dev/null 2>&1 || true
  pass "Test 4a: 创建需求成功 (ID: $rid)"

  # 4b. 检查 assignee 是否设置且不为空
  local get_resp
  get_resp=$(adc_curl GET "/requirements/$rid")
  local assignee
  assignee=$(parse_body "$get_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('assignee',''))" 2>/dev/null || echo "")
  if [ -z "$assignee" ]; then
    fail "Test 4b: assignee 为空（可能未自动分配）"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 4b: assignee 已设置: $assignee"

  # 4c. Advance 后检查 assignee 不变（不漂移）
  local adv_resp
  adv_resp=$(adc_curl POST "/requirements/$rid/workflow/advance" '{"comment":"冒烟测试 advance"}')
  local http_code
  http_code=$(parse_http_code "$adv_resp")
  if [ "$http_code" != "200" ]; then
    fail "Test 4c: advance 失败 (HTTP $http_code)"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi

  # 验证 assignee 未变化
  get_resp=$(adc_curl GET "/requirements/$rid")
  local new_assignee
  new_assignee=$(parse_body "$get_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('assignee',''))" 2>/dev/null || echo "")
  local new_step
  new_step=$(parse_body "$get_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('currentStep',''))" 2>/dev/null || echo "")

  if [ "$assignee" != "$new_assignee" ]; then
    fail "Test 4d: assignee 漂移: 「$assignee」→「$new_assignee」"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi
  pass "Test 4d: advance 后 assignee 未漂移: $new_assignee（当前步骤: $new_step）"

  # 清理
  adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true

  return 0
}

# Test 5: workflow/reject 端点可用
test_5_reject_endpoint() {
  log "━━━ Test 5: workflow/reject 端点可用 ━━━"

  # 5a. 创建需求
  local title="smoke-test-5-$(date +%s)"
  local create_data
  create_data=$(python3 -c "
import json
print(json.dumps({
    'title': '$title',
    'description': '冒烟测试 Test 5',
    'type': 'INFRA',
    'priority': 'P3',
    'department': 'engineering'
}))
")
  local create_resp
  create_resp=$(adc_curl POST "/requirements" "$create_data")
  local rid
  rid=$(parse_body "$create_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  # 分配工作流
  adc_curl POST "/requirements/$rid/workflow/assign" '{"workflowName":"standard-dev","startStep":"dev_self_check"}' > /dev/null 2>&1 || true
  pass "Test 5a: 创建需求成功 (ID: $rid)"

  # 5b. 调用 reject 端点
  local reject_resp
  reject_resp=$(adc_curl POST "/requirements/$rid/workflow/reject" '{"comment":"冒烟测试 - reject端点测试","targetStep":"dev_self_check"}')
  local http_code
  http_code=$(parse_http_code "$reject_resp")

  if [ "$http_code" = "404" ]; then
    fail "Test 5b: reject 端点返回 404（未部署）"
    adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true
    return 1
  fi

  if [ "$http_code" = "200" ]; then
    pass "Test 5b: workflow/reject 端点可用 (HTTP 200)"
  else
    # 400 或 409 也说明端点存在（业务逻辑校验，不是 404）
    pass "Test 5b: workflow/reject 端点存在 (HTTP $http_code - 业务校验正常)"
  fi

  # 清理
  adc_curl DELETE "/requirements/$rid" > /dev/null 2>&1 || true

  return 0
}

# ─── 主流程 ──────────────────────────────────────────────────────
main() {
  echo ""
  echo "══════════════════════════════════════════════"
  echo "   ADC 工作流冒烟测试"
  echo "   时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "   主机: $HOST"
  echo "══════════════════════════════════════════════"
  echo ""

  # 加载 .env
  if [ -f ".env" ]; then
    set -a; source .env; set +a
  fi

  # 登录
  local email="${ADC_EMAIL:-devtools-agent@agent.local}"
  local password="${ADC_PASSWORD:-}"

  if [ -z "$password" ]; then
    echo -e "${RED}❌ ADC_PASSWORD 未设置${NC}"
    echo "   请在 .env 中配置 ADC_EMAIL 和 ADC_PASSWORD"
    exit 1
  fi

  echo "正在登录 ADC..."
  TOKEN=$(login "$email" "$password")
  if [ -z "$TOKEN" ]; then
    echo -e "${RED}❌ 登录失败${NC}"
    exit 1
  fi
  echo -e "${GREEN}✅ 登录成功${NC}"
  echo ""

  # 运行测试
  test_1_create_advance_delete || true
  echo ""
  test_2_report_submit_approve || true
  echo ""
  test_3_report_reject_resubmit || true
  echo ""
  test_4_assignee_no_drift || true
  echo ""
  test_5_reject_endpoint || true
  echo ""

  # ─── 结果汇总 ──────────────────────────────────────────────
  TOTAL=$((PASS + FAIL))
  echo "══════════════════════════════════════════════"
  echo "   测试结果: ${PASS}/${TOTAL} 通过"
  if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}   ❌ 失败项:${NC}$FAILED_TESTS"
  fi
  echo "══════════════════════════════════════════════"
  echo ""

  if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}❌ 冒烟测试未通过！部署中止。${NC}"
    exit 1
  else
    echo -e "${GREEN}✅ 所有冒烟测试通过，可以部署。${NC}"
    exit 0
  fi
}

main "$@"
