#!/usr/bin/env bash
# SSO 配置一致性检查
# 验证所有服务的 SSO_JWT_SECRET 使用同一个值
set -uo pipefail

echo "=== SSO 配置一致性检查 ==="

extract_sso_secret() {
  local FILE=$1
  if [ ! -f "$FILE" ]; then echo ""; return; fi
  grep -oE 'SSO_JWT_SECRET=[A-Za-z0-9_-]+' "$FILE" 2>/dev/null | head -1 | cut -d= -f2
  grep -oE 'JWT_SECRET_SSO:[ ]*[A-Za-z0-9_-]+' "$FILE" 2>/dev/null | head -1 | awk '{print $2}'
}

check_placeholder() {
  echo "$1" | grep -qi 'prod-sso-secret\|prod-jwt-secret\|at-least-16-chars\|change-me'
}

ERRORS=0
declare -A VALUES

check_file() {
  local FILE=$1 LABEL=$2
  local VAL
  VAL=$(grep -oE 'SSO_JWT_SECRET=[A-Za-z0-9]+' "$FILE" 2>/dev/null | head -1 | cut -d= -f2)
  if [ -z "$VAL" ]; then
    VAL=$(grep -oE 'JWT_SECRET_SSO:[[:space:]]*[A-Za-z0-9]+' "$FILE" 2>/dev/null | head -1 | awk '{print $NF}')
  fi

  if [ -z "$VAL" ]; then
    echo "⚠️  $LABEL: 未找到 SSO 密钥"
    return
  fi

  if check_placeholder "$VAL"; then
    echo "❌ $LABEL: 占位符值 (${VAL:0:15}...)"
    ERRORS=$((ERRORS+1))
    return
  fi

  echo "✅ $LABEL: ${VAL:0:12}..."
  VALUES["$LABEL"]="$VAL"
}

check_file "/opt/services/docker-compose.yml" "根 compose"
check_file "/opt/services/agent-dev-center/docker-compose.yml" "ADC compose"
check_file "/opt/services/llm-todo/.env" "LLM Todo .env"

echo ""
echo "--- 一致性比对 ---"
UNIQUE=$(printf '%s\n' "${VALUES[@]}" 2>/dev/null | sort -u | wc -l | tr -d ' ')

if [ "$UNIQUE" -eq 0 ]; then
  echo "⚠️  没有找到任何密钥值"
elif [ "$UNIQUE" -eq 1 ]; then
  echo "✅ 所有配置使用同一个密钥"
else
  echo "❌ 发现 $UNIQUE 种不同密钥值！"
  for L in "${!VALUES[@]}"; do
    echo "  $L: ${VALUES[$L]}"
  done
  ERRORS=$((ERRORS+1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then echo "❌ 失败 ($ERRORS)"; exit 1; else echo "✅ 通过"; exit 0; fi
