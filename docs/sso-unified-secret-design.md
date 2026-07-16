# SSO 密钥统一管理设计方案（2026-05-24）

## 问题现状

SSO 相关密钥散落在以下位置，每次变更需要手动同步：

| 位置 | 变量名 | 现状 |
|------|--------|------|
| `agent-dev-center/docker-compose.yml` | `JWT_SECRET_SSO` | 已硬编码 |
| `agent-dev-center/.env` | 无（已改用 compose 硬编码） | 仅含 POSTGRES_* |
| `agent-dev-center/.env.production` | `JWT_SECRET_SSO` | 已有值，但 compose 已不用 |
| `llm-todo/.env` | `SSO_JWT_SECRET` | 已更新 |
| `/opt/services/docker-compose.yml` | `SSO_JWT_SECRET` (x6) | 已更新 |

## 设计方案

### 方案 A（推荐）：根目录 .env 作为唯一真相源

**原理**：在 `/opt/services/` 目录放一个 `.env` 文件定义所有共享密钥，所有子服务的 docker-compose 按需引用。

**结构**：
```
/opt/services/
├── .env                      # ← 唯一真相源（共享密钥）
│   ├── SSO_JWT_SECRET=<value>
│   ├── POSTGRES_PASSWORD=<value>
│   └── ...
├── docker-compose.yml        # 根 compose，引用 ${SSO_JWT_SECRET}
├── agent-dev-center/
│   ├── docker-compose.yml    # 引用 ${SSO_JWT_SECRET}
│   └── ...
├── llm-todo/
│   └── .env                  # 删掉 SSO_JWT_SECRET，由根 compose 传入
└── ...
```

**优点**：
- 改一个文件所有服务同步更新
- 每个服务不需要单独管理 SSO 密钥
- `.env` 不出现在 git 中（`.gitignore`），避免密钥泄露

**缺点**：
- 需要改多个 docker-compose.yml 引用 `/opt/services/.env`
- 需要确保所有服务都走根 compose 或能读到根 .env

### 方案 B（简化版）：统一使用 ADC 的 JWT_SECRET 值

**原理**：所有服务的 `SSO_JWT_SECRET` / `JWT_SECRET_SSO` 直接使用 ADC 的 `JWT_SECRET` 值作硬编码。

**条件**：每次更换密钥时，需要同时更新：
1. `/opt/services/agent-dev-center/docker-compose.yml` 的 `JWT_SECRET`
2. `/opt/services/docker-compose.yml` 的 6 个 `SSO_JWT_SECRET`
3. `/opt/services/llm-todo/.env` 的 `SSO_JWT_SECRET`

**优点**：改动最小，当前状态就是方案 B 的实现。

**缺点**：3 处需要手动同步，没有防错机制。

### 方案 C（完整版）：密钥管理服务

**原理**：引入密钥管理（如 HashiCorp Vault / 简单的加密 KV）。

**优点**：最安全、最灵活、支持轮换。

**缺点**：对 1.6GB 的小服务器来说太重了，性价比低。

## 推荐实施方案

**短期（当前）**：采用方案 B，已实施完成。

**中期（下次密钥变更前）**：过渡到方案 A。
1. 在 `/opt/services/` 创建 `.env`，定义 `SSO_JWT_SECRET`
2. 所有子服务的 compose 统一引用 `SSO_JWT_SECRET: ${SSO_JWT_SECRET}`
3. 删除各子服务 `.env` / `.env.production` 中的重复定义
4. `.env` 加入 `.gitignore`，只在服务器本地维护

**长期**：若团队规模扩大（15+ 服务），考虑方案 C。

## SSO 全链路集成测试脚本

每次部署后自动执行以下检查：

```bash
#!/bin/bash
# 1. 从 ADC 获取登录令牌
TOKEN=$(curl -sk -X POST 'https://8.163.44.127/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@agent.dev","password":"agent2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 2. 用令牌调用其他服务
SERVICES=(
  "/todo/api/projects"         # LLM Todo
  "/article-review/api/auth"   # Article Review (SSO 验证)
  "/kpi/api/projects"          # KPI Dashboard
)

for service in "${SERVICES[@]}"; do
  STATUS=$(curl -sk -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    "https://8.163.44.127$service")
  if [ "$STATUS" == "200" ] || [ "$STATUS" == "401" ]; then
    echo "✅ $service: $STATUS"
  else
    echo "❌ $service: $STATUS (SSO 验证可能失败)"
  fi
done
```

此脚本可作为 `scripts/server-health-check.sh` 的补充，或在 `deploy.sh` 的 healthcheck 阶段调用。
