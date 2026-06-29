#!/bin/bash
# verify-sso.sh — 验证所有服务的 SSO/JWT 密钥是否与 ADC 平台一致
# 用法: bash verify-sso.sh [--fix]
# --fix: 自动修复密钥不一致的服务（需确认）

set -euo pipefail

ADC_URL="http://localhost:4000"
ADC_EMAIL="admin@agent.dev"
ADC_PASS="ag-k4mjuq-d2jgq5"
SSO_ENV_FILE="/opt/.sso-env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "============================================"
echo "  SSO/JWT 密钥一致性验证"
echo "============================================"
echo ""

# Step 1: 获取 ADC token
echo "[1/5] 获取 ADC 平台 token..."
TOKEN=$(curl -s "$ADC_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADC_EMAIL\",\"password\":\"$ADC_PASS\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$TOKEN" ] || [ ${#TOKEN} -lt 100 ]; then
  echo -e "${RED}❌ 无法获取 ADC token，平台可能不可用${NC}"
  exit 1
fi
echo -e "${GREEN}✅ ADC token 获取成功 (${#TOKEN} chars)${NC}"

# Step 2: 检查 /opt/.sso-env 是否存在
echo ""
echo "[2/5] 检查统一密钥文件 $SSO_ENV_FILE..."
if [ -f "$SSO_ENV_FILE" ]; then
  echo -e "${GREEN}✅ 统一密钥文件存在${NC}"
  grep -v '^#' "$SSO_ENV_FILE" | grep -v '^$'
else
  echo -e "${YELLOW}⚠️  统一密钥文件不存在，需要创建${NC}"
fi

# Step 3: 逐个服务测试 token 验证
echo ""
echo "[3/5] 测试各服务 token 验证..."
echo "-------------------------------------------"

# 格式: 服务名:端口:测试路径:期望(200或401)
SERVICES=(
  "llm-todo:3458:/api/todos:200"
  "article-review:3000:/api/health:200"
  "svc-okr:3461:/api/goals:200"
  "kpi-dashboard:3457:/api/health:200"
  "shopping-list:3001:/api/health:200"
  "biz-explorer:34567:/api/health:200"
  "podcast-viewer:53821:/api/health:200"
)

PASS=0
FAIL=0
WARN=0

for svc in "${SERVICES[@]}"; do
  IFS=':' read -r name port path expected <<< "$svc"
  
  # Test WITH token
  with_token=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port$path" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
  
  # Test WITHOUT token
  without_token=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port$path" 2>/dev/null || echo "000")
  
  if [ "$with_token" = "200" ] && [ "$without_token" = "401" ]; then
    echo -e "  ${GREEN}✅ $name (:$port) — 鉴权正常 (有token=200, 无token=401)${NC}"
    ((PASS++))
  elif [ "$with_token" = "200" ] && [ "$without_token" = "200" ]; then
    echo -e "  ${YELLOW}⚠️  $name (:$port) — 非阻塞模式 (有token=200, 无token=200)${NC}"
    ((WARN++))
  elif [ "$with_token" != "200" ] && [ "$with_token" != "000" ]; then
    echo -e "  ${RED}❌ $name (:$port) — token验证失败 (有token=$with_token, 无token=$without_token)${NC}"
    ((FAIL++))
  elif [ "$with_token" = "000" ]; then
    echo -e "  ${RED}❌ $name (:$port) — 服务不可达${NC}"
    ((FAIL++))
  else
    echo -e "  ${YELLOW}?  $name (:$port) — 未预期状态 (有token=$with_token, 无token=$without_token)${NC}"
    ((WARN++))
  fi
done

echo "-------------------------------------------"

# Step 4: 检查 docker-compose 中的密钥
echo ""
echo "[4/5] 检查 docker-compose 密钥配置..."
ISSUES=0
for f in /opt/*/docker-compose.yml /opt/*/docker-compose.yaml; do
  [ -f "$f" ] || continue
  dir=$(dirname "$f")
  svc=$(basename "$dir")
  
  # Check for hardcoded JWT secrets
  hardcoded=$(grep -c "JWT_SECRET=.*[a-f0-9]\{32\}" "$f" 2>/dev/null || echo "0")
  if [ "$hardcoded" -gt 0 ]; then
    echo -e "  ${YELLOW}⚠️  $svc — 硬编码密钥 ($hardcoded 处)${NC}"
    ((ISSUES++))
  fi
  
  # Check for env_file reference
  has_env_file=$(grep -c "env_file" "$f" 2>/dev/null || echo "0")
  if [ "$has_env_file" -eq 0 ] && [ "$hardcoded" -gt 0 ]; then
    echo -e "  ${YELLOW}   → 建议改用 env_file: $SSO_ENV_FILE${NC}"
  fi
done

if [ "$ISSUES" -eq 0 ]; then
  echo -e "  ${GREEN}✅ 无硬编码密钥${NC}"
fi

# Step 5: Summary
echo ""
echo "[5/5] 汇总"
echo "============================================"
echo -e "  通过: ${GREEN}$PASS${NC}  警告: ${YELLOW}$WARN${NC}  失败: ${RED}$FAIL${NC}"
echo "  硬编码问题: $ISSUES 处"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}🚨 有服务鉴权失败，需要修复 JWT_SECRET${NC}"
  echo "  修复方法: 将服务的 JWT_SECRET 改为 ADC 的 JWT_SECRET"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  有服务处于非阻塞模式，建议改为阻塞模式${NC}"
  exit 2
else
  echo -e "${GREEN}🎉 所有服务鉴权配置正确${NC}"
  exit 0
fi
