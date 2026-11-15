#!/bin/bash
# normalize-roles.sh — 统一 ADC 账号角色
# 7270c9e0: 将所有普通 Agent 账号统一为 requester 角色
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$PWD/.env" ] && { set -a; source "$PWD/.env"; set +a; }

ADC_HOST="${ADC_HOST:-{your-server-ip}}"

# Credentials are provided through private environment variables.
: "${ADC_EMAIL:?Set ADC_EMAIL in a private environment file}"
: "${ADC_PASSWORD:?Set ADC_PASSWORD in a private environment file}"
TOKEN=$(bash "$SKILL_DIR/scripts/login.sh" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "ERROR: 无法获取 Token" >&2; exit 1; fi

# 查询所有用户
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=yes "root@$ADC_HOST" 2>/dev/null \
  "curl -s 'http://localhost:4000/api/admin/users' -H 'Authorization: Bearer $TOKEN'" | python3 -c "
import sys, json

d = json.load(sys.stdin)
users = d if isinstance(d, list) else d.get('data', d.get('users', []))

# 管理层用户保持不变
ADMIN_EMAILS = {'admin@agent.dev', 'cto@agent.local', 'admin@example.com'}
ADMIN_ROLES = {'admin', 'cto_agent', 'cto'}

changes = []
for u in users:
    email = u.get('email', '')
    role = u.get('role', '')
    irole = u.get('internalRole', '')

    # 跳过管理员
    if email in ADMIN_EMAILS or role in ADMIN_ROLES:
        continue

    # 普通开发者 Agent → 如果 role 不是 developer，标记
    if role == 'requester' and irole not in ('', None):
        # 有 internalRole 的 requester 可能是有意的，跳过
        continue

    if role == 'developer':
        changes.append(f'  {email}: role={role} → requester (internalRole={irole})')

if changes:
    print(f'需要修改 {len(changes)} 个用户：')
    for c in changes:
        print(c)
else:
    print('所有用户角色已标准化，无需修改')
" 2>/dev/null
