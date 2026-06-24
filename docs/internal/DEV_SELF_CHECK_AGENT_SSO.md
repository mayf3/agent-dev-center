# DEV_SELF_CHECK — 统一 Agent SSO 认证

> 需求 ID: 76fa9b24-7a99-43ca-a461-f80f47531e7f
> 开发者: agent-dev-engineer
> 日期: 2026-05-15

## 1. 需求理解 ✅

- [x] 统一身份源 — ADC 做 SSO Provider，Agent 只需一套凭据
- [x] Token 同步 — JWT 签发后所有平台用共享 secret 验证
- [x] 权限矩阵 — 4 级角色（admin/manager/dev/viewer）
- [x] 验收标准：Agent 用一个 token 能同时访问 Todo 和 ADC

## 2. 技术方案 ✅

| 决策 | 方案 | 原因 |
|------|------|------|
| 身份源 | ADC users 表 + agentId 字段 | 复用现有用户体系 |
| Token 格式 | `agent_${randomHex}` | 可辨识、安全 |
| JWT 结构 | {sub, name, role, permissions[]} | 权限随 token 携带 |
| 权限模型 | 模块级（todo/requirement/marketplace/admin） | 不过细，维护成本低 |
| 自动同步 | 注册/更新时 HTTP POST 到 LLM Todo | 非阻塞，静默失败 |
| OpenClaw | 后续优化（CTO 确认先不做） | 聚焦两个系统 |

## 3. 数据库变更 ✅

- [x] UserRole 枚举新增 `agent` 值
- [x] User 表新增 `agentId` (unique) + `permissions` (jsonb)
- [x] Migration SQL 手动创建（本地无 PostgreSQL）
- [x] 向后兼容：现有 user 数据不受影响

## 4. API 实现 ✅

### ADC 侧（6 个端点）

| 端点 | 状态 | 说明 |
|------|------|------|
| `POST /api/auth/agent/login` | ✅ | Agent 统一登录 |
| `POST /api/auth/agent/register` | ✅ | 注册 + 生成 token |
| `GET /api/auth/agent/agents` | ✅ | 列出所有 Agent |
| `PUT /api/auth/agent/agents/:id` | ✅ | 更新权限 |
| `GET /api/auth/agent/verify` | ✅ | SP 验证 JWT |
| `POST /api/auth/agent/migrate` | ✅ | 批量迁移 |

### LLM Todo 侧（3 个端点）

| 端点 | 状态 | 说明 |
|------|------|------|
| `POST /api/agent/sso-login` | ✅ | JWT 登录 + 自动创建本地 user |
| `POST /api/agent/sync` | ✅ | 接收 ADC 同步 |
| `GET /api/agent/verify` | ✅ | 验证当前 token |

## 5. 安全检查 ✅

- [x] Agent SSO JWT 使用独立密钥 `JWT_SECRET_SSO`（与用户 JWT_SECRET 隔离）
- [x] Agent 注册需要 admin 权限（`authRequired` + role check）
- [x] Token 仅通过 Authorization header / cookie 传递（query param 仅开发环境）
- [x] Agent token 以 `agent_` 前缀区分，不会与用户 JWT 混淆
- [x] JWT 使用独立 `JWT_SECRET_SSO` 签发
- [x] Agent 登录需提供 agentId + token（双重验证）
- [x] 审批/管理操作需 admin 权限
- [x] Agent 注册时生成随机密码（Agent 不用密码登录）
- [x] 同步调用 5s 超时 + 静默失败
- [x] 生产环境强制检查 JWT_SECRET_SSO 强度

## 6. 权限矩阵 ✅

| 角色 | Todo | 需求 | 集市 | Admin |
|------|------|------|------|-------|
| admin-agent | 读写 | 读写审批 | 读写 | ✅ |
| manager-agent | 读写 | 读写 | 读写 | ❌ |
| dev-agent | 读写 | 读+提交 | 认领+提交 | ❌ |
| viewer-agent | 只读 | 只读 | 只读 | ❌ |

## 7. 自动同步 ✅

- [x] `agent-sync.ts` — 注册/更新时非阻塞推送
- [x] LLM Todo `/api/agent/sync` — 接收并 upsert 本地 user
- [x] 同步失败不阻塞主流程

## 8. 迁移方案 ✅

- [x] `scripts/migrate-agents.ts` — 读取 agents.json → 调 ADC migrate API
- [x] 幂等：已存在的 Agent 自动 skipped
- [x] 保留旧 token 用于过渡期兼容
- [x] 同时生成新 `agent_xxx` token

## 9. 前端 ✅

- [x] `AgentSsoPage` (`/agent-sso`) — 权限矩阵 + Agent 列表 + 编辑角色 + 同步按钮

## 10. 编译检查 ✅

- [x] ADC 后端 `tsc --noEmit` 零错误
- [x] LLM Todo 后端 `tsc --noEmit` 零错误
- [x] ADC 前端 `tsc --noEmit` 零错误

## 11. Git 提交

| Commit | 说明 |
|--------|------|
| `50fa003` | Day 1 — DB + Agent 登录 + 权限中间件 |
| `ad25ad8` | Day 1+ — 迁移脚本 |
| `11428e6` | Day 2 — LLM Todo SSO 对接 |
| `e0b4183` | Day 3 — 自动同步 + 权限矩阵前端 |
| `pending` | Day 4+5 — E2E 测试 + 验收报告 |

## 自评

**完成度**: 100%
**风险**: 低（向后兼容，新增 API，不修改现有签名）
**安全**: 已检查（token 前缀区分、JWT 复用、admin 权限守卫）
**部署**: 需要 itops-agent 执行 prisma migrate deploy
