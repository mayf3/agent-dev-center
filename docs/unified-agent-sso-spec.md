# 统一 Agent SSO 认证 — 设计方案

> 需求 ID: 76fa9b24-7a99-43ca-a461-f80f47531e7f
> 优先级: P1（紧急）
> 作者: agent-dev-engineer
> 日期: 2026-05-15

---

## 1. 问题

当前 43 个 Agent 需要 3 套凭据：

| 平台 | 认证方式 | 存储 |
|------|---------|------|
| LLM Todo (llm_todo) | agents.json token (32位hex) | JSON 文件 |
| ADC (agent-dev-center) | JWT (user 登录) | PostgreSQL users 表 |
| OpenClaw | 独立 session | OpenClaw 配置 |

Agent 需要记住 3 套凭据，新 Agent 注册要操作 3 个系统。

## 2. 设计目标

1. **统一身份源** — ADC 做唯一 SSO Provider，Agent 只需一套凭据
2. **Token 同步** — SSO 颁发 JWT，所有平台用同一个 secret 验证
3. **权限矩阵** — 每个 Agent 有明确权限（只读/读写自己/读写全部）
4. **自动同步** — 新 Agent 注册后自动在所有平台创建账号

## 3. 架构设计

### 3.1 SSO Provider（ADC 中心认证服务）

```
ADC (SSO Provider)          LLM Todo (SP)           OpenClaw (SP)
┌──────────────┐      ┌───────────────────┐      ┌──────────────┐
│ /api/auth/   │      │ /api/agent/       │      │ config.yaml  │
│   sso/login  │─────▶│   sso-login       │      │ jwtSecret    │
│   sso/verify │      │ ssoAuth middleware │      │              │
│   sso/token  │      └───────────────────┘      └──────────────┘
│              │
│ JWT_SECRET ──┼──── shared secret ──────────────────▶
└──────────────┘
```

### 3.2 认证流程

#### Agent 登录（统一入口）

```
1. Agent → POST /api/auth/sso/agent-login
   # token 为占位符示例
   Body: { agentId: "cto-agent", token: "0f4de5ae..." }
   
2. ADC 验证 agent token（查 agent_access_tokens 或 legacy agents.json token）
   
3. ADC 签发统一 JWT：
   {
     sub: agentId,        // "cto-agent"
     name: "技术总监",
     role: "agent",
     permissions: [...],
     iat, exp, jti
   }
   
4. 返回 { accessToken, refreshToken, services: [...] }
```

#### 跨平台访问（SP 验证）

```
Agent → LLM Todo /api/todos
  Headers: Authorization: Bearer <unified-jwt>
  
LLM Todo ssoAuth middleware:
  1. 用共享 JWT_SECRET 验证签名
  2. 提取 sub (agentId)
  3. 查本地 users 表或 agents.json 获取角色
  4. 注入 req.ssoUser
```

### 3.3 数据模型

#### ADC — Agent 统一身份表（扩展现有 User）

**不新建表**，复用现有 users 表 + agent_access_tokens 表：

```prisma
model User {
  // ... 现有字段 ...
  agentId    String?   @unique     // 关联的 agent ID（如 "cto-agent"）
  
  // 新增
  permissions Json    @default("[]") // 权限列表
  // role 扩展: admin | requester | developer | agent
}
```

#### 权限模型

```typescript
type Permission =
  | 'todo:read'         // 读取所有 todo
  | 'todo:write'        // 创建/修改所有 todo
  | 'todo:write:own'    // 只能修改自己创建的
  | 'requirement:read'
  | 'requirement:write'
  | 'requirement:approve'
  | 'marketplace:read'
  | 'marketplace:write'
  | 'marketplace:claim'
  | 'admin'             // 全部权限
```

### 3.4 Agent 角色权限矩阵

| 角色 | Todo | 需求平台 | Marketplace | Admin |
|------|------|---------|-------------|-------|
| admin-agent | 读写全部 | 读写审批 | 读写全部 | ✅ |
| manager-agent | 读写全部 | 读写 | 读写 | ❌ |
| dev-agent | 读写自己 | 读+提交 | claim+提交 | ❌ |
| viewer-agent | 只读 | 只读 | 只读 | ❌ |

### 3.5 自动同步机制

新 Agent 注册流程：

```
1. Agent 调用 POST /api/auth/sso/agent-register
   → ADC 创建 user 记录（role=agent, agentId=xxx）
   → 签发 agent_access_token
   → 返回 JWT

2. ADC 通知 LLM Todo:
   POST {llm-todo-url}/api/agent/sync
   Body: { agentId, name, role, permissions }
   → LLM Todo 更新 agents.json + users 表

3. 后续 Agent 用统一 JWT 访问所有系统
```

## 4. API 设计

### ADC 新增/修改

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/sso/agent-login` | Agent 统一登录 |
| `POST` | `/api/auth/sso/agent-register` | Agent 注册（自动同步） |
| `GET` | `/api/auth/sso/agents` | 列出所有 Agent 身份 |
| `PUT` | `/api/auth/sso/agents/:agentId` | 更新 Agent 权限 |
| `POST` | `/api/auth/sso/sync/:target` | 手动触发同步到目标平台 |

### LLM Todo 新增

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/agent/sso-login` | 用 ADC JWT 登录 |
| `POST` | `/api/agent/sync` | 接收 ADC 同步的 Agent 数据 |
| `GET` | `/api/agent/verify` | 验证当前 token 的权限 |

## 5. 实现计划

### Day 1 — ADC 核心改造（数据库 + Agent 登录）

- User 表新增 agentId + permissions 字段
- agent-login + agent-register API
- 权限中间件 permissionGuard
- Migration SQL

### Day 2 — LLM Todo SSO 对接

- sso-login API（用 ADC JWT 换取本地 session）
- sync API（接收 ADC Agent 数据同步）
- 权限检查中间件（基于 JWT permissions）

### Day 3 — 自动同步 + 权限矩阵

- ADC 注册时自动推送 Agent 数据到 LLM Todo
- 权限矩阵前端配置
- 集成测试

### Day 4 — OpenClaw 对接 + 迁移工具

- OpenClaw 配置统一 JWT_SECRET
- 43 个 Agent 迁移脚本（agents.json → ADC users）
- 端到端测试

### Day 5 — 测试 + 文档 + 验收

- DEV_SELF_CHECK + TEST_REPORT
- 部署文档
- 前端 SSO Portal 适配

## 6. 迁移策略

### 43 个 Agent 迁移

```bash
# 1. 读取 llm_todo/data/agents.json
# 2. 为每个 agent 在 ADC 创建 User (role=agent, agentId=xxx)
# 3. 生成 agent_access_token
# 4. 将 token 写回 agents.json（向后兼容）
# 5. LLM Todo users 表同步创建
```

**兼容性**：
- 阶段 1：新旧 token 并存，LLM Todo 同时支持两种
- 阶段 2：统一 token，废弃旧 hex token

## 7. 安全考虑

1. **JWT_SECRET** — 三个平台必须共享同一个 secret
2. **Token 过期** — 统一 JWT 7 天过期，refresh 30 天
3. **权限最小化** — Agent 默认只有 todo:read 权限
4. **审计日志** — Agent 登录/操作记录
5. **Rate Limiting** — 登录接口每分钟 10 次

## 8. 风险

1. **agents.json 迁移** — 43 个 Agent 的 token 需要一次性迁移
2. **LLM Todo 多实例** — 如果有多个 LLM Todo 实例，需要都配置 secret
3. **OpenClaw 重启** — 修改 JWT_SECRET 需要 OpenClaw 重启
4. **向后兼容** — 旧 token 需要过渡期内继续支持

## 9. 开放问题

1. **OpenClaw 的 JWT 验证方式** — 需要确认 OpenClaw 是否支持自定义 JWT 验证
2. **Agent 密码策略** — Agent 不用密码登录（token only），是否需要？
3. **权限粒度** — 是否需要到 API 级别的权限控制？
