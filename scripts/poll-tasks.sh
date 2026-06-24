#!/bin/bash
# Agent任务轮询脚本（通用模板）
# 用途：轻量级查询待办任务，有任务时才唤醒Agent
# 优势：不直接唤醒LLM，节省token成本

set -e

# ========================================
# 配置（通过环境变量传入）
# ========================================
AGENT_TYPE="${AGENT_TYPE:-backend-engineer}"
API_BASE="${API_BASE:-http://localhost:3000/api}"
TOKEN="${TOKEN:-}"
LOG_DIR="${LOG_DIR:-/var/log/agent-poll}"
LOG_FILE="$LOG_DIR/${AGENT_TYPE}.log"

# ========================================
# 初始化
# ========================================
mkdir -p "$LOG_DIR"

# 日志函数
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 错误处理
trap 'log "❌ 脚本执行出错: $?"' ERR

# ========================================
# 主逻辑
# ========================================
log "🔍 开始查询任务 (Agent: $AGENT_TYPE)"

# 检查TOKEN
if [ -z "$TOKEN" ]; then
  log "❌ 错误: TOKEN环境变量未设置"
  exit 1
fi

# 查询待办任务
log "📡 发送API请求: $API_BASE/tasks?assignee=$AGENT_TYPE&status=todo"

response=$(curl -s -X GET \
  "$API_BASE/tasks?assignee=$AGENT_TYPE&status=todo&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

# 检查HTTP状态码
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET \
  "$API_BASE/tasks?assignee=$AGENT_TYPE&status=todo&pageSize=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

if [ "$http_code" -ne 200 ]; then
  log "❌ API请求失败，HTTP状态码: $http_code"
  log "响应: $response"
  exit 1
fi

# 解析响应（检查是否安装了jq）
if ! command -v jq &> /dev/null; then
  log "❌ 错误: 未安装jq工具，请先安装: brew install jq"
  exit 1
fi

# 提取任务数量
task_count=$(echo "$response" | jq '.data | length // 0')

if [ "$task_count" -eq 0 ]; then
  log "✅ 暂无待办任务"
  exit 0
fi

log "🎯 发现 $task_count 个待办任务"

# 提取任务信息
task_titles=$(echo "$response" | jq -r '.data[] | "\(.id) | \(.title)"')
log "📋 任务列表:"
echo "$task_titles" | while read -r line; do
  log "   - $line"
done

# ========================================
# 唤醒Agent（这里需要根据实际环境实现）
# ========================================
log "🔔 准备唤醒Agent: $AGENT_TYPE"

# TODO: 根据实际环境实现唤醒逻辑
# 选项1: 通过OpenClaw sessions_send发送消息
# if command -v openclaw &> /dev/null; then
#   while IFS='|' read -r task_id task_title; do
#     openclaw sessions_send \
#       --session "agent:$AGENT_TYPE" \
#       --message "有新任务需要处理：$task_id - $task_title"
#   done < <(echo "$response" | jq -r '.data[] | "\(.id)|\(.title)"')
# fi

# 选项2: 通过HTTP调用Agent的webhook
# while IFS='|' read -r task_id task_title; do
#   curl -X POST "$AGENT_WEBHOOK_URL" \
#     -H "Content-Type: application/json" \
#     -d "{\"taskId\":\"$task_id\",\"title\":\"$task_title\"}"
# done < <(echo "$response" | jq -r '.data[] | "\(.id)|\(.title)"')

# 选项3: 写入消息队列（Redis/RabbitMQ）
# ...

log "⏳ 等待后续实现唤醒逻辑"
log "✅ 脚本执行完成"
