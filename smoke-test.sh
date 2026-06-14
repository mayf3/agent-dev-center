#!/usr/bin/env bash
# smoke-test.sh — ADC 工作流冒烟测试
#
# 部署前自动验证核心流程。集成到 deploy.sh，失败立即中止部署。
#
# Usage:
#   bash smoke-test.sh                         # 使用 .env 中的凭据
#   bash smoke-test.sh --host 8.163.44.127     # 指定主机
#   bash smoke-test.sh --verbose               # 详细输出
#
# 返回值：0=全部通过, 1=至少一项失败

set -Eeuo pipefail

HOST="${HOST:-8.163.44.127}"
VERBOSE=false
PASS=0
FAIL=0
START_TS=$(date +%s)

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    --help) head -20 "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── 颜色／日志 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf "${YELLOW}[smoke]${NC} %s\n" "$*"; }
ok()   { PASS=$((PASS+1)); printf "  ${GREEN}✅ PASS${NC}: %s\n" "$*"; }
fail() { FAIL=$((FAIL+1)); printf "  ${RED}❌ FAIL${NC}: %s\n" "$*"; }

# ── 依赖检查 ──
for cmd in curl jq python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
done

# ── 加载凭据 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADC_CLIENT="$HOME/.openclaw/skills/adc-task-puller/scripts/adc_client.py"

# 从 .env 加载（搜索 workspace 或当前目录）
ENV_FILE=""
for candidate in "$SCRIPT_DIR/.env" "$SCRIPT_DIR/../../.env" "/Users/yanfenma/.openclaw/groups/workspace-oc_527e3dc701b31a6a9475fbe9cc00b219/.env"; do
  if [ -f "$candidate" ]; then
    ENV_FILE="$candidate"
    break
  fi
done

if [ -z "$ENV_FILE" ]; then
  echo "ERROR: Cannot find .env with ADC credentials" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

ADC_API_BASE="https://${HOST}"
export ADC_API_BASE

# ── 工具函数 ──

get_token() {
  python3 "$ADC_CLIENT" login 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('token','').split('...')[0])"
}

api() {
  local method="$1" path="$2"
  shift 2
  python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.api('${method}', '${path}', $([ $# -gt 0 ] && echo "'$1'" || echo "{}"))
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}))
    sys.exit(1)
"
}

print_result() {
  local label="$1" result="$2"
  if echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'error' not in d, d.get('error','')" 2>/dev/null; then
    ok "$label"
    $VERBOSE && echo "$result" | python3 -m json.tool 2>/dev/null || true
  else
    fail "$label — $(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null)"
  fi
}

# ── 生成唯一前缀 ──
PREFIX="smk-$(date +%s)-$$"
CLEANUP_IDS=()

cleanup() {
  local rc=$?
  log "清理测试数据..."
  for rid in "${CLEANUP_IDS[@]}"; do
    result=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.api('DELETE', '/api/requirements/${rid}')
    print('deleted')
except Exception as e:
    # 如果已删除或不存在，忽略
    print(f'skip: {e}')
" 2>/dev/null) || true
    $VERBOSE && log "  Cleanup ${rid}: ${result}"
  done
  local elapsed=$(( $(date +%s) - START_TS ))
  log "=== 冒烟测试完成: ${PASS} 通过, ${FAIL} 失败, 耗时 ${elapsed}s ==="
  if [ $FAIL -gt 0 ]; then
    printf "\n${RED}❌ 冒烟测试未通过 — 中止部署${NC}\n"
  else
    printf "\n${GREEN}✅ 全部通过${NC}\n"
  fi
  exit $(( FAIL > 0 ? 1 : 0 ))
}
trap cleanup EXIT

log "=== ADC 冒烟测试开始 ==="
log "主机: ${HOST}"
log "前缀: ${PREFIX}"

# ═══════════════════════════════════════════
# Test 1: 创建需求 → 分配工作流 → advance → 删除
# ═══════════════════════════════════════════
log ""
log "━━━ Test 1: 创建+分配+advance+删除 ━━━"

log "  Step 1.1: 创建测试需求..."
RESULT=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.create_requirement(
        title='${PREFIX}-test1-冒烟测试',
        description='## 背景\\n系统自动创建的冒烟测试需求，30秒后自动删除\\n\\n## 验收标准\\n1. 创建成功\\n2. 分配工作流成功\\n3. advance 成功',
        priority='P3',
        req_type='TEST',
        department='测试'
    )
    print(result.get('id', ''))
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
")
if echo "$RESULT" | grep -q '^[0-9a-f]\{8\}-'; then
  T1_ID="$RESULT"
  CLEANUP_IDS+=("$T1_ID")
  ok "  Test 1.1: 创建需求 $T1_ID"
else
  fail "  Test 1.1: 创建需求失败 — $RESULT"
fi

if [ -n "${T1_ID:-}" ]; then
  log "  Step 1.2: 分配工作流..."
  RESULT=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.assign_workflow('${T1_ID}', 'default', 'draft')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
  print_result "  Test 1.2: 分配工作流" "$RESULT"

  log "  Step 1.3: advance 到 pm_review..."
  RESULT=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.advance('${T1_ID}', '冒烟测试自动推进')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
  print_result "  Test 1.3: advance" "$RESULT"
fi

# ═══════════════════════════════════════════
# Test 2: 提交 DEV_SELF_CHECK → QA 审批 → advance
# ═══════════════════════════════════════════
log ""
log "━━━ Test 2: 报告提交+QA审批+advance ━━━"

log "  Step 2.1: 创建需求..."
RESULT=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.create_requirement(
        title='${PREFIX}-test2-冒烟测试-报告',
        description='## 背景\\n测试报告提交和审批流程\\n\\n## 验收标准\\n1. 报告提交成功\\n2. QA审批成功\\n3. advance成功',
        priority='P3',
        req_type='TEST',
        department='测试'
    )
    print(result.get('id', ''))
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
")
if echo "$RESULT" | grep -q '^[0-9a-f]\{8\}-'; then
  T2_ID="$RESULT"
  CLEANUP_IDS+=("$T2_ID")
  ok "  Test 2.1: 创建需求 $T2_ID"
else
  fail "  Test 2.1: 创建需求失败 — $RESULT"
fi

if [ -n "${T2_ID:-}" ]; then
  log "  Step 2.2: 分配工作流..."
  python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try: client.assign_workflow('${T2_ID}', 'default', 'draft')
except: pass
" 2>/dev/null || true

  log "  Step 2.3: advance 到 dev_self_check..."
  python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try: client.advance('${T2_ID}', '冒烟测试推进')
except: pass
" 2>/dev/null || true

  log "  Step 2.4: 提交 DEV_SELF_CHECK 报告..."
  RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.submit_report('${T2_ID}', 'DEV_SELF_CHECK', {
        'summary': '冒烟测试自检报告',
        'items': ['检查项1: 通过', '检查项2: 通过'],
        'conclusion': '通过'
    })
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
  print_result "  Test 2.4: 提交 DEV_SELF_CHECK" "$RESULT"

  # 从返回结果提取 report_id
  T2_REPORT_ID=$(echo "$RESULT" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    if 'data' in d and isinstance(d['data'], dict):
        print(d['data'].get('id',''))
    elif 'id' in d:
        print(d['id'])
except: pass
" 2>/dev/null)

  if [ -n "$T2_REPORT_ID" ]; then
    log "  Step 2.5: QA 审批报告（通过）..."
    RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.qa_review('${T2_ID}', '${T2_REPORT_ID}', 'approved', '冒烟测试 QA 通过')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
    print_result "  Test 2.5: QA 审批" "$RESULT"

    log "  Step 2.6: advance..."
    RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.advance('${T2_ID}', '冒烟测试推进')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
    print_result "  Test 2.6: advance after QA approve" "$RESULT"
  else
    fail "  Test 2.4: 无法获取 report_id"
  fi
fi

# ═══════════════════════════════════════════
# Test 3: 提交 TEST_REPORT → QA 驳回 → 重新提交 → QA 审批
# ═══════════════════════════════════════════
log ""
log "━━━ Test 3: 报告驳回+重新提交+审批 ━━━"

log "  Step 3.1: 创建需求..."
RESULT=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.create_requirement(
        title='${PREFIX}-test3-冒烟测试-驳回',
        description='## 背景\\n测试报告驳回和重新提交\\n\\n## 验收标准\\n1. 报告被驳回\\n2. 重新提交成功\\n3. 重新审批通过',
        priority='P3',
        req_type='TEST',
        department='测试'
    )
    print(result.get('id', ''))
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
")
if echo "$RESULT" | grep -q '^[0-9a-f]\{8\}-'; then
  T3_ID="$RESULT"
  CLEANUP_IDS+=("$T3_ID")
  ok "  Test 3.1: 创建需求 $T3_ID"
else
  fail "  Test 3.1: 创建需求失败 — $RESULT"
fi

if [ -n "${T3_ID:-}" ]; then
  python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    client.assign_workflow('${T3_ID}', 'default', 'draft')
    client.advance('${T3_ID}', '推进')
except: pass
" 2>/dev/null || true

  log "  Step 3.2: 初次提交 DEV_SELF_CHECK..."
  RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.submit_report('${T3_ID}', 'DEV_SELF_CHECK', {
        'summary': '初次提交待驳回',
        'items': ['待完善'],
        'conclusion': '待改进'
    })
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
  print_result "  Test 3.2: 初次提交报告" "$RESULT"

  T3_REPORT_ID=$(echo "$RESULT" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    if 'data' in d and isinstance(d['data'], dict):
        print(d['data'].get('id',''))
    elif 'id' in d:
        print(d['id'])
except: pass
" 2>/dev/null)

  if [ -n "$T3_REPORT_ID" ]; then
    log "  Step 3.3: QA 驳回报告..."
    RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.qa_review('${T3_ID}', '${T3_REPORT_ID}', 'rejected', '冒烟测试：模拟驳回')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
    print_result "  Test 3.3: QA 驳回" "$RESULT"

    log "  Step 3.4: 重新提交报告..."
    RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.submit_report('${T3_ID}', 'DEV_SELF_CHECK', {
        'summary': '重新提交-已修正',
        'items': ['已修复: 问题1', '已修复: 问题2'],
        'conclusion': '通过'
    })
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
    print_result "  Test 3.4: 重新提交报告" "$RESULT"

    T3_REPORT_ID2=$(echo "$RESULT" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    if 'data' in d and isinstance(d['data'], dict):
        print(d['data'].get('id',''))
    elif 'id' in d:
        print(d['id'])
except: pass
" 2>/dev/null)

    if [ -n "$T3_REPORT_ID2" ]; then
      log "  Step 3.5: QA 审批重新提交的报告..."
      RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.qa_review('${T3_ID}', '${T3_REPORT_ID2}', 'approved', '重新提交后通过')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
      print_result "  Test 3.5: QA 审批重新提交" "$RESULT"
    fi
  fi
fi

# ═══════════════════════════════════════════
# Test 4: advance 时 assignee 自动解析（不漂移）
# ═══════════════════════════════════════════
log ""
log "━━━ Test 4: assignee 不漂移 ━━━"

log "  Step 4.1: 创建需求并设置 assignee..."
RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.create_requirement(
        title='${PREFIX}-test4-冒烟测试-assignee',
        description='## 背景\\n测试assignee不漂移\\n\\n## 验收标准\\n1. assignee设置正确\\n2. advance后不变\\n3. 再次advance后不变',
        priority='P3',
        req_type='TEST',
        department='测试',
        assignee='前端工程师-React'
    )
    rid = result.get('id', '')
    client.assign_workflow(rid, 'default', 'draft')
    # 检查 assignee
    req = client.fetch_one(rid)
    assignee = (req or {}).get('assignee', '')
    print(f'{rid}|{assignee}')
except Exception as e:
    print(f'ERROR: {e}')
")
if echo "$RESULT" | grep -q '^[0-9a-f]\{8\}-'; then
  T4_ID="${RESULT%%|*}"
  T4_ASSIGNEE="${RESULT##*|}"
  CLEANUP_IDS+=("$T4_ID")
  ok "  Test 4.1: 创建需求 $T4_ID (assignee=$T4_ASSIGNEE)"
  
  # advance 一次
  log "  Step 4.2: advance 并检查 assignee..."
  RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    client.advance('${T4_ID}', '冒烟测试推进')
    req = client.fetch_one('${T4_ID}')
    print(req.get('assignee', ''))
except Exception as e:
    print(f'ERROR: {e}')
")
  if [ "$RESULT" = "$T4_ASSIGNEE" ]; then
    ok "  Test 4.2: advance 后 assignee 未漂移 ($RESULT)"
  elif echo "$RESULT" | grep -q '^ERROR'; then
    fail "  Test 4.2: $RESULT"
  else
    fail "  Test 4.2: assignee 漂移 (预期=$T4_ASSIGNEE, 实际=$RESULT)"
  fi
else
  fail "  Test 4.1: $RESULT"
fi

# ═══════════════════════════════════════════
# Test 5: workflow/reject 端点可用
# ═══════════════════════════════════════════
log ""
log "━━━ Test 5: reject 端点可用 ━━━"

log "  Step 5.1: 创建需求..."
RESULT=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
import json
client = ADCClient()
try:
    result = client.create_requirement(
        title='${PREFIX}-test5-冒烟测试-reject',
        description='## 背景\\n测试reject端点\\n\\n## 验收标准\\n1. reject可用\\n2. 步骤正确回退',
        priority='P3',
        req_type='TEST',
        department='测试'
    )
    print(result.get('id', ''))
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
")
if echo "$RESULT" | grep -q '^[0-9a-f]\{8\}-'; then
  T5_ID="$RESULT"
  CLEANUP_IDS+=("$T5_ID")
  ok "  Test 5.1: 创建需求 $T5_ID"
  
  python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    client.assign_workflow('${T5_ID}', 'default', 'draft')
    client.advance('${T5_ID}', '推进到pm_review')
except: pass
" 2>/dev/null || true

  log "  Step 5.2: reject 回到 draft..."
  RESULT=$(python3 -c "
import sys, os, json
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    result = client.reject('${T5_ID}', 'draft', '冒烟测试：模拟打回')
    print(json.dumps(result))
except Exception as e:
    print(f'ERROR: {e}')
")
  print_result "  Test 5.2: reject 到 draft" "$RESULT"

  log "  Step 5.3: 验证步骤已回退..."
  STEP=$(python3 -c "
import sys, os
os.environ['ADC_API_BASE'] = '${ADC_API_BASE}'
sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/adc-task-puller/scripts'))
from adc_client import ADCClient
client = ADCClient()
try:
    req = client.fetch_one('${T5_ID}')
    print(req.get('currentStep', ''))
except Exception as e:
    print(f'ERROR: {e}')
")
  if [ "$STEP" = "draft" ]; then
    ok "  Test 5.3: 步骤已回退到 draft"
  elif echo "$STEP" | grep -q '^ERROR'; then
    fail "  Test 5.3: $STEP"
  else
    fail "  Test 5.3: 步骤未正确回退 (currentStep=$STEP)"
  fi
else
  fail "  Test 5.1: $RESULT"
fi

# ═══════════════════════════════════════════
# 测试结束后 cleanup 会自动执行
# ═══════════════════════════════════════════
log ""
log "所有测试完成，等待清理..."
