# TEST_REPORT — 统一 Agent SSO 认证

> 需求 ID: 76fa9b24-7a99-43ca-a461-f80f47531e7f
> 测试者: agent-dev-engineer
> 日期: 2026-05-15

## 1. 测试范围

| 模块 | 测试类型 | 文件 |
|------|---------|------|
| Agent 注册 | E2E | `src/__tests__/agent-sso.e2e.ts` |
| Agent 登录 | E2E | 同上 |
| Token 验证 | E2E | 同上 |
| 权限管理 | E2E | 同上 |
| 批量迁移 | E2E | 同上 |
| JWT 结构 | E2E | 同上 |
| 自动同步 | 单元 | `agent-sync.ts`（手动验证） |

## 2. 测试用例

### 2.1 Agent 注册（6 用例）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 1 | 注册新 Agent (dev-agent) | 201, 返回 agentToken + jwt | ✅ PASS |
| 2 | 重复注册 | 409 Conflict | ✅ PASS |
| 3 | User 表创建 (role=agent) | agentId 正确 | ✅ PASS |
| 4 | MarketplaceAgent 创建 | displayName 正确 | ✅ PASS |
| 5 | AgentAccessToken 创建 | token 格式 agent_xxx | ✅ PASS |
| 6 | dev-agent 默认权限 | todo:read, todo:write, marketplace:claim | ✅ PASS |

### 2.2 Agent 登录（3 用例）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 1 | 有效 agentId + token | 200, 返回 accessToken + services | ✅ PASS |
| 2 | 无效 token | 401 | ✅ PASS |
| 3 | 不存在的 agentId | 404 | ✅ PASS |

### 2.3 Token 验证（2 用例）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 1 | 有效 JWT | 200, valid=true, 返回 agent 信息 | ✅ PASS |
| 2 | 无效 JWT | 401 | ✅ PASS |

### 2.4 权限管理（3 用例）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 1 | 列出所有 Agent (admin) | 200, 包含测试 Agent | ✅ PASS |
| 2 | 更新角色为 manager-agent | 200, permissions 更新 | ✅ PASS |
| 3 | DB 中权限已更新 | requirement:write, marketplace:write | ✅ PASS |

### 2.5 批量迁移（2 用例）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 1 | 首次迁移 2 个 Agent | created=2, errors=0 | ✅ PASS |
| 2 | 重复迁移 | skipped=2 | ✅ PASS |

### 2.6 JWT 结构（2 用例）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| 1 | payload 字段 | sub, name, role, permissions[], iat, exp | ✅ PASS |
| 2 | 过期时间 | 7 天 | ✅ PASS |

## 3. 跨平台验证（手动）

### 3.1 ADC → LLM Todo 流程

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | 在 ADC 注册 Agent | ✅ 返回 agentToken + JWT |
| 2 | ADC 自动同步到 LLM Todo | ✅ 非阻塞调用 |
| 3 | 用 JWT 调用 LLM Todo `/api/agent/sso-login` | ✅ 自动创建本地 user |
| 4 | 用 JWT 调用 LLM Todo `/api/agent/verify` | ✅ 返回权限列表 |
| 5 | 用 JWT 访问 LLM Todo `/api/todos` | ✅ ssoAuth 解析成功 |

### 3.2 权限验证

| 角色 | todo:read | todo:write | marketplace:claim | admin |
|------|-----------|------------|-------------------|-------|
| admin-agent | ✅ | ✅ | ✅ | ✅ |
| manager-agent | ✅ | ✅ | ❌ | ❌ |
| dev-agent | ✅ | ✅ | ✅ | ❌ |
| viewer-agent | ✅ | ❌ | ❌ | ❌ |

## 4. 测试统计

| 指标 | 值 |
|------|---|
| 总用例数 | 18 |
| 通过 | 18 |
| 失败 | 0 |
| 通过率 | 100% |
| 手动验证 | 8 步全通过 |

## 5. 已知限制

1. **E2E 测试需要 ADC 后端运行** — 测试时需 `npm run dev` 启动
2. **自动同步依赖 LLM Todo 可达** — 网络不通时静默跳过
3. **OpenClaw 暂未接入** — CTO 确认后续优化
4. **旧 token 过渡期共存** — 生产部署后需安排旧 token 废弃时间

## 6. 部署清单

```bash
# ADC 侧
cd /opt/agent-dev-center/backend
git pull
npx prisma migrate deploy
pm2 restart agent-dev-center

# LLM Todo 侧
cd /opt/llm-todo
git pull
# 确保 .env 中 SSO_JWT_SECRET 与 ADC 的 JWT_SECRET 一致
pm2 restart llm-todo

# 迁移 43 Agent
cd /opt/agent-dev-center
ADC_BASE_URL=http://localhost:3000 npx tsx scripts/migrate-agents.ts --token=$(获取admin-jwt)
```

## 结论

✅ **全部测试通过，可部署。**
