#!/bin/bash
# fix-sso.sh — 一键修复所有服务的 SSO/JWT 密钥配置
# 用法: bash fix-sso.sh
# 前提: 在 {your-server-ip} 服务器上运行，或通过 ssh 运行

set -euo pipefail

echo "============================================"
echo "  SSO/JWT 密钥一键修复"
echo "============================================"

# Step 1: 创建统一密钥文件
echo ""
echo "[1/4] 创建 /opt/.sso-env ..."
cat > /opt/.sso-env << 'EOF'
# 统一 SSO/JWT 密钥 — 所有服务引用此文件
# 禁止在 docker-compose.yml 中硬编码 JWT_SECRET
# 上次更新: 2026-05-25
JWT_SECRET=efaae9e3a8016b06ccf2466e618644d1e1918d134f0e3b6a357f6abe6b9a7ea6
SSO_JWT_SECRET=efaae9e3a8016b06ccf2466e618644d1e1918d134f0e3b6a357f6abe6b9a7ea6
EOF
chmod 600 /opt/.sso-env
echo "  ✅ /opt/.sso-env 已创建"

# Step 2: 修复 svc-okr
echo ""
echo "[2/4] 修复 svc-okr docker-compose.yml ..."
cd /opt/svc-okr

# 用 python 替换 docker-compose.yml
python3 << 'PYEOF'
import yaml, sys

with open('docker-compose.yml', 'r') as f:
    dc = yaml.safe_load(f)

for svc_name, svc in dc.get('services', {}).items():
    env = svc.get('environment', {})
    # Remove hardcoded JWT secrets
    keys_to_remove = [k for k in env if 'JWT_SECRET' in k and isinstance(env[k], str) and len(env[k]) > 20]
    for k in keys_to_remove:
        del env[k]
    # Add env_file reference
    if 'env_file' not in svc:
        svc['env_file'] = '/opt/.sso-env'
    elif isinstance(svc['env_file'], list):
        if '/opt/.sso-env' not in svc['env_file']:
            svc['env_file'].append('/opt/.sso-env')

with open('docker-compose.yml', 'w') as f:
    yaml.dump(dc, f, default_flow_style=False, allow_unicode=True)
PYEOF

echo "  ✅ svc-okr docker-compose.yml 已修复"

# Step 3: 修复 services
echo ""
echo "[3/4] 修复 services docker-compose.yml ..."
cd /opt/services

python3 << 'PYEOF'
import yaml

with open('docker-compose.yml', 'r') as f:
    dc = yaml.safe_load(f)

for svc_name, svc in dc.get('services', {}).items():
    env = svc.get('environment', {})
    # Remove hardcoded SSO_JWT_SECRET
    keys_to_remove = [k for k in env if 'JWT_SECRET' in k.upper()]
    for k in keys_to_remove:
        if isinstance(env[k], str) and len(env[k]) > 20:
            del env[k]
    # Add env_file reference
    if 'env_file' not in svc:
        svc['env_file'] = '/opt/.sso-env'
    elif isinstance(svc['env_file'], list):
        if '/opt/.sso-env' not in svc['env_file']:
            svc['env_file'].append('/opt/.sso-env')

with open('docker-compose.yml', 'w') as f:
    yaml.dump(dc, f, default_flow_style=False, allow_unicode=True)
PYEOF

echo "  ✅ services docker-compose.yml 已修复"

# Step 4: 重启所有服务
echo ""
echo "[4/4] 重启所有服务 ..."
cd /opt/services && docker compose down && docker compose up -d
cd /opt/svc-okr && docker compose down && docker compose up -d

echo ""
echo "等待服务启动 (15s)..."
sleep 15

# Step 5: 验证
echo ""
echo "============================================"
echo "  验证结果"
echo "============================================"

# Get ADC token
TOKEN=$(curl -s http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agent.dev","password":"'"${ADC_ADMIN_PASSWORD:?ADC_ADMIN_PASSWORD not set}"'"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ 无法获取 ADC token"
  exit 1
fi

PASS=0
FAIL=0

for svc_port_path in "llm-todo:3458:/api/todos" "svc-okr:3461:/api/goals" "article-review:3000:/api/health" "kpi-dashboard:3457:/api/health" "shopping-list:3001:/api/health" "biz-explorer:34567:/api/health"; do
  IFS=':' read -r name port path <<< "$svc_port_path"
  with_token=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port$path" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
  if [ "$with_token" = "200" ]; then
    echo "  ✅ $name (:$port$path) — $with_token"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name (:$port$path) — $with_token"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "通过: $PASS  失败: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 所有服务 SSO 密钥修复完成！"
else
  echo "⚠️  有服务验证失败，请检查日志"
fi
