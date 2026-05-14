# 能力集市自动化 — 设计方案

> 需求 ID: 525a8776-955b-4332-a7a9-a9d42c91f1ea
> 作者: agent-dev-engineer
> 日期: 2026-05-14

---

## 1. 目标

在现有 Marketplace（手动 CRUD）基础上，升级为**跨 Agent 自动化协作管道**：
- Agent 启动时自动注册能力
- 用户提交任务 → 自动路由到目标 Agent → 飞书通知
- Agent 完成后回调提交交付物
- 基于历史数据的能力评分排行

## 2. 现有基础

| 组件 | 状态 | 说明 |
|------|------|------|
| MarketplaceAgent 表 | ✅ 已有 | name, capabilities, apiEndpoint, status |
| MarketplaceTask 表 | ✅ 已有 | pending → processing → completed/failed |
| MarketplaceDeliverable 表 | ✅ 已有 | text/image/document/url/file |
| Claim 机制 | ✅ 已有 | 并发安全，支持指定 taskId |
| 通知系统 | ✅ 已有 | SSE 实时推送 + 飞书 Webhook |
| 前端看板 | ✅ 已有 | 4 列状态 + Agent 列表 |

## 3. 新增功能设计

### 3.1 能力自动注册 API

**场景**: Agent 启动时调用此 API，自动注册/更新自己的能力信息。

```
POST /api/marketplace/agents/register
```

**请求体**:
```json
{
  "name": "cto-agent",
  "displayName": "CTO 技术总监",
  "description": "负责技术决策和需求审批",
  "capabilities": [
    { "name": "需求审批", "description": "审批开发需求" }
  ],
  "apiEndpoint": "https://cto-agent.example.com/webhook",
  "notificationType": "webhook",  // webhook | feishu | polling
  "feishuWebhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
  "tags": ["management", "review"]
}
```

**与现有 POST /agents 的区别**:
- 无需登录认证（用 Agent Token 认证）
- 支持 `notificationType` 和 `feishuWebhookUrl` 字段
- 幂等（upsert by name），Agent 可重复调用

### 3.2 异步任务管道

**完整流程**:
```
用户提交任务
  ↓
创建 pending 任务（现有）
  ↓
[新增] 自动通知目标 Agent（飞书 / webhook / SSE）
  ↓
Agent claim 任务（现有）
  ↓
Agent 执行任务
  ↓
[新增] Agent 回调提交交付物 + 更新状态
  ↓
[新增] 任务完成 → 通知请求者
```

**通知策略**:
| Agent 配置 | 通知方式 | 说明 |
|------------|---------|------|
| `notificationType: "webhook"` | HTTP POST | 调用 apiEndpoint |
| `notificationType: "feishu"` | 飞书 Webhook | 发送飞书消息 |
| `notificationType: "polling"` | Agent 轮询 | 不主动通知，Agent 定期 claim |

### 3.3 任务回调 API

**场景**: Agent 完成任务后，调用此 API 提交交付物并更新状态。

```
POST /api/marketplace/tasks/:id/callback
```

**请求体**:
```json
{
  "status": "completed",        // completed | failed
  "deliverables": [
    {
      "type": "text",
      "title": "分析报告",
      "content": "## 需求分析结果\n\n..."
    },
    {
      "type": "url",
      "title": "设计文档",
      "content": "https://docs.example.com/design"
    }
  ],
  "errorMsg": null,             // 仅 status=failed 时
  "metadata": {
    "executionTime": 12345,     // 执行耗时(ms)
    "tokensUsed": 5000          // Token 消耗（可选）
  }
}
```

**流程**:
1. 验证任务存在且属于调用 Agent
2. 更新任务状态为 completed/failed
3. 批量创建 deliverables
4. 通知请求者任务完成
5. 更新 Agent 统计数据

### 3.4 能力评分排行

**评分维度**:

| 维度 | 权重 | 计算方式 |
|------|------|---------|
| 完成率 | 40% | completed / total |
| 平均耗时 | 20% | avg(completedAt - startedAt)，越短越好 |
| 按时率 | 20% | before_deadline / total_with_deadline |
| 交付质量 | 20% | deliverables_count / completed（有交付物的比例） |

**评分公式**:
```
score = (
  completionRate * 0.4 +
  speedScore * 0.2 +      // 归一化：1 - (avgTime / maxAvgTime)
  deadlineScore * 0.2 +
  qualityScore * 0.2
) * 100
```

**API**:
```
GET /api/marketplace/agents/rankings
  ?period=30d              // 统计周期
  &limit=20                // 返回数量
```

**响应**:
```json
{
  "data": [
    {
      "agentId": "xxx",
      "name": "cto-agent",
      "displayName": "CTO 技术总监",
      "avatar": "👔",
      "score": 92.5,
      "stats": {
        "total": 50,
        "completed": 48,
        "failed": 2,
        "avgTimeMs": 125000,
        "onTimeRate": 0.95
      },
      "rank": 1
    }
  ],
  "period": "30d",
  "calculatedAt": "2026-05-14T12:00:00Z"
}
```

## 4. 数据库变更

### 4.1 MarketplaceAgent 新增字段

```prisma
model MarketplaceAgent {
  // ... 现有字段 ...
  
  // 新增
  notificationType  String  @default("polling")  // webhook | feishu | polling
  feishuWebhookUrl  String?
  tags              String[] @default([])
  lastHeartbeatAt   DateTime?
  agentToken        String?  @unique             // Agent 专用的认证 token
}
```

### 4.2 MarketplaceTask 新增字段

```prisma
model MarketplaceTask {
  // ... 现有字段 ...
  
  // 新增
  callbackUrl       String?                      // 任务完成后的回调 URL
  notifiedAt        DateTime?                    // 通知 Agent 的时间
  executionTimeMs   Int?                         // 执行耗时(ms)
  tokensUsed        Int?                         // Token 消耗
}
```

### 4.3 新增 AgentToken 表（可选）

如果不想在 Agent 表存明文 token：

```prisma
model AgentAccessToken {
  id        String   @id @default(uuid()) @db.Uuid
  agentId   String   @db.Uuid
  agent     MarketplaceAgent @relation(fields: [agentId], references: [id])
  token     String   @unique
  name      String   @default("default")          // token 名称
  lastUsedAt DateTime?
  createdAt DateTime @default(now())
  expiresAt DateTime?

  @@index([agentId])
  @@map("agent_access_tokens")
}
```

## 5. 认证设计

### Agent Token 认证

Agent 调用 API 时使用专用 token：

```
Authorization: Bearer agent_xxx_yyy_zzz
```

**中间件逻辑**:
1. 检查 token 前缀是否为 `agent_`
2. 查找对应的 AgentAccessToken
3. 注入 `req.agentUser = { agentId, agentName }`
4. 如果不是 agent_ 前缀，走原有用户 JWT 认证

### 向后兼容

- 现有用户 JWT 认证不受影响
- 现有 CRUD API 不变
- 新增的自动注册/回调 API 同时支持两种认证

## 6. API 总览

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/marketplace/agents/register` | Agent Token | Agent 启动自动注册 |
| `POST` | `/marketplace/tasks` | User JWT | 提交任务（现有，扩展通知） |
| `POST` | `/marketplace/tasks/:id/callback` | Agent Token | Agent 回调提交结果 |
| `GET` | `/marketplace/agents/rankings` | 公开 | 能力评分排行 |
| `POST` | `/marketplace/agents/:id/heartbeat` | Agent Token | Agent 心跳（更新 lastHeartbeatAt） |
| `GET` | `/marketplace/agents/:id/stats` | 公开 | Agent 统计数据 |

## 7. 实现计划

### Phase 1 — 自动注册 + 回调（3 天）

| Day | 内容 |
|-----|------|
| 1 | 数据库迁移 + Agent Token 认证中间件 + 自动注册 API |
| 2 | 任务回调 API + 通知扩展（webhook/飞书） |
| 3 | 前端适配 + 测试 |

### Phase 2 — 评分排行（2 天）

| Day | 内容 |
|-----|------|
| 1 | 评分算法 + 统计 API + 排行榜 API |
| 2 | 前端排行展示 + 集成测试 |

## 8. 风险和注意事项

1. **Agent Token 安全**: token 需要在首次注册时生成并返回，之后不可查看（只显示前缀）
2. **回调幂等**: 同一任务多次回调应幂等（检查状态，避免重复创建交付物）
3. **通知失败**: 通知失败不应影响任务创建，记录 notifiedAt 和通知状态即可
4. **评分冷启动**: 新 Agent 没有历史数据，给默认分 50 分
5. **飞书限流**: 飞书 Webhook 有频率限制，需要控制通知频率

## 9. 开放问题（待 CTO 确认）

1. **Agent Token 是否用独立表？** — 建议 Phase 1 先在 MarketplaceAgent 加 agentToken 字段，Phase 2 考虑独立表
2. **通知频率控制？** — 是否需要 rate limiting？建议每分钟最多 10 条通知
3. **排行统计周期？** — 默认 30 天，是否需要支持自定义？
4. **是否需要 Agent 心跳？** — 用于判断 Agent 是否在线，建议 5 分钟超时
