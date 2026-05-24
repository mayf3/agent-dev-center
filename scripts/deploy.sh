#!/usr/bin/env bash
set -euo pipefail

# ===========================================================
# ADC 平台部署脚本
# 用法: ./scripts/deploy.sh [--skip-tests] [--skip-typecheck]
# ===========================================================
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== 🔍 ADC 部署流水线 ==="
echo ""

# Step 1: Type Check
if [[ "${1:-}" != "--skip-typecheck" ]]; then
  echo ">>> [1/5] TypeScript 类型检查..."
  cd backend && npx tsc --noEmit 2>&1 || {
    echo "❌ TypeScript 类型检查失败，终止部署"
    exit 1
  }
  cd "$REPO_ROOT"
  echo "✅ TypeScript 类型检查通过"
else
  echo ">>> [1/5] TypeScript 类型检查 (跳过)"
fi
echo ""

# Step 2: Unit Tests
if [[ "${1:-}" != "--skip-tests" ]]; then
  echo ">>> [2/5] 单元测试..."
  cd backend && npx vitest run 2>&1 || {
    echo "❌ 单元测试失败，终止部署"
    exit 1
  }
  cd "$REPO_ROOT"
  echo "✅ 单元测试通过"
else
  echo ">>> [2/5] 单元测试 (跳过)"
fi
echo ""

# Step 3: Build
echo ">>> [3/5] 构建..."
npm run build 2>&1 || {
  echo "❌ 构建失败"
  exit 1
}
echo "✅ 构建完成"
echo ""

# Step 4: Git Push
echo ">>> [4/5] 推送代码到服务器..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push server "$CURRENT_BRANCH:main" 2>&1 || {
  echo "❌ Git push 失败"
  exit 1
}
echo "✅ 代码已推送至服务器"
echo ""

# Step 5: Wait for deployment and health check
echo ">>> [5/5] 等待部署并执行健康检查..."
sleep 10

echo "--- 健康检查 ---"

echo ">>> [5b] SSO 全链路集成测试..."
bash scripts/sso-integration-test.sh || {
  echo "❌ SSO 集成测试失败"
  HEALTH_PASS=false
}
HEALTH_PASS=true

# 检查前端
echo -n "  前端 (/)          → "
FRONTEND_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' https://8.163.44.127/ 2>/dev/null || echo "failed")
if [[ "$FRONTEND_STATUS" == "200" ]]; then
  echo "✅ $FRONTEND_STATUS"
else
  echo "❌ $FRONTEND_STATUS"
  HEALTH_PASS=false
fi

# 检查 API 健康
echo -n "  API 健康 (/api/health) → "
API_HEALTH=$(curl -sk -o /dev/null -w '%{http_code}' https://8.163.44.127/api/health 2>/dev/null || echo "failed")
if [[ "$API_HEALTH" == "200" ]]; then
  echo "✅ $API_HEALTH"
else
  echo "❌ $API_HEALTH"
  HEALTH_PASS=false
fi

# 检查 API 登录（应该 401，表示路由可达，需 POST）
echo -n "  API 登录 (/api/auth/login) → "
AUTH_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"email":"test@test.com","password":"test"}' https://8.163.44.127/api/auth/login 2>/dev/null || echo "failed")
if [[ "$AUTH_STATUS" == "401" ]]; then
  echo "✅ $AUTH_STATUS (401=路由正常，需认证)"
elif [[ "$AUTH_STATUS" == "200" ]]; then
  echo "⚠️  $AUTH_STATUS (登录成功，也在预期内)"
elif [[ "$AUTH_STATUS" == "403" ]]; then
  echo "❌ $AUTH_STATUS (403=被网关拦截，有配置问题)"
  HEALTH_PASS=false
else
  echo "❌ $AUTH_STATUS"
  HEALTH_PASS=false
fi

# 检查需求列表
echo -n "  需求列表 (/api/requirements) → "
REQ_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' https://8.163.44.127/api/requirements 2>/dev/null || echo "failed")
if [[ "$REQ_STATUS" == "200" || "$REQ_STATUS" == "401" ]]; then
  echo "✅ $REQ_STATUS"
else
  echo "❌ $REQ_STATUS"
  HEALTH_PASS=false
fi

echo ""
if [[ "$HEALTH_PASS" == "true" ]]; then
  echo "✅ 全部健康检查通过！部署成功！"
else
  echo "❌ 部分健康检查失败，请立即排查"
  exit 1
fi
