#!/bin/bash
# qa-review-poll.sh — 定时检查 pending 报告并通知 QA
# 用法：由 cron 每 30 分钟调用一次
# 输出：pending 报告数量 + 详情（便于 cron 日志/告警）
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$PWD/.env" ] && { set -a; source "$PWD/.env"; set +a; }

ADC_API_URL="${ADC_API_URL:-http://localhost:4000/api}"
ADC_HOST="${ADC_HOST:-8.163.44.127}"

TOKEN=$(ADC_EMAIL="${ADC_EMAIL:-}" ADC_PASSWORD="${ADC_PASSWORD:-}" bash "$SKILL_DIR/scripts/login.sh" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "ERROR: 无法获取 Token" >&2; exit 1; fi

# 通过 SSH 调用 pending-review API
response=$(ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "root@$ADC_HOST" 2>/dev/null \
  "curl -s 'http://localhost:4000/api/reports/pending-review' -H 'Authorization: Bearer $TOKEN'")

count=$(echo "$response" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  reports = d.get('data', d) if isinstance(d, dict) else d
  if isinstance(reports, list):
    print(len(reports))
  else:
    print(0)
except:
  print(0)
" 2>/dev/null)

if [ "$count" -gt 0 ]; then
  echo "[QA-REVIEW] $count pending reports awaiting review"
  echo "$response" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  reports = d.get('data', d) if isinstance(d, dict) else d
  if isinstance(reports, list):
    for r in reports[:10]:
      req_id = r.get('requirementId','?')[:8]
      rtype = r.get('reportType','?')
      status = r.get('status','?')
      print(f'  {req_id} | {rtype} | {status}')
except:
  pass
" 2>/dev/null
else
  echo "[QA-REVIEW] No pending reports"
fi
