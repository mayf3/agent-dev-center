# Agent 目标卡系统 — Mini Design Doc

> 需求 ID: `6d78011f-7dd4-438f-89f0-0f91f3f39c33`
> 作者: devtools-agent | 日期: 2026-05-19
> 状态: Draft → CTO Review

---

## 1. 问题陈述

Agent 团队规模扩大后，缺少一个**结构化的目标管理机制**。老板要求 Agent 能：
1. 自主读取自己的长期目标
2. 基于目标自主规划和执行任务
3. 汇报执行结果

当前痛点：Agent 只是被分配任务，没有"方向感"，无法自主决策优先级。

---

## 2. 核心概念

### 2.1 目标卡（Goal Card）

每个 Agent 一张目标卡，类似 OKR 的结构：

```
┌─────────────────────────────────────┐
│  🎯 devtools-agent 的目标卡         │
├─────────────────────────────────────┤
│  管线: 内容生产                      │
│  上游: ceo-agent → 本Agent          │
│  下游: 本Agent → itops-agent        │
├─────────────────────────────────────┤
│  长期方向 (6-12月):                  │
│  成为全栈工具开发专家，支撑所有       │
│  Agent 的前端/Web 需求交付           │
├─────────────────────────────────────┤
│  月度目标 (2026-05):                 │
│  ① 完成所有 P0/P1 需求交付          │
│  ② 建立标准化前端开发流水线          │
│  ③ 移动端适配覆盖率达 80%           │
├─────────────────────────────────────┤
│  自检标准:                           │
│  ✓ DEV_SELF_CHECK 一次通过率 > 90%  │
│  ✓ 需求交付周期 < 3天               │
│  ✓ 零生产事故                       │
└─────────────────────────────────────┘
```

### 2.2 管线（Pipeline）

目标卡归属的管线，类似业务域：

| 管线 | 说明 | 涉及 Agent |
|------|------|-----------|
| 内容生产 | 文章/播客/社媒 | devtools, content-agent |
| 育儿 | 宝宝成长/教育 | baby-growth-agent |
| 投资 | 量化/交易 | quant-agent |
| 健康 | 运动追踪 | health-agent |
| 规划 | 目标管理/知识库 | cto-agent |
| 生活 | 购物/日常 | shopping-agent |

### 2.3 对称结构

```
人（个人属性平台）              Agent（目标卡系统）
─────────────────              ────────────────
看到长期目标        ←→          读取目标卡
拆解成 todo        ←→          规划任务（写入 LLM Todo）
执行 & 汇报        ←→          执行 & 汇报
```

---

## 3. 数据模型

### 3.1 Prisma Schema 新增

```prisma
// ─── Agent Goal Card ─────────────────────────────

enum GoalStatus {
  active
  paused
  archived
}

enum PipelineName {
  content       // 内容生产
  parenting     // 育儿
  investment    // 投资
  health        // 健康
  planning      // 规划
  lifestyle     // 生活
  devops        // 运维
  education     // 教育
}

model AgentGoalCard {
  id              String       @id @default(uuid()) @db.Uuid
  agentId         String       @unique @db.Uuid     // 关联 MarketplaceAgent
  agent           MarketplaceAgent @relation(fields: [agentId], references: [id])
  
  // 管线归属
  pipeline        PipelineName
  upstreamAgentIds String[]    @default([])         // 上游 Agent ID 列表
  downstreamAgentIds String[]  @default([])         // 下游 Agent ID 列表
  
  // 目标内容
  longTermDirection String     @db.Text             // 长期方向 (6-12月)
  monthlyGoals    Json         @default("[]")       // 月度目标 [{month:"2026-05", goals:["..."]}]
  selfCheckCriteria String     @db.Text             // 自检标准
  
  // 状态
  status          GoalStatus   @default(active)
  
  // 审计
  lastReviewedAt  DateTime?                         // CEO/CTO 最后审核时间
  lastReviewedBy  String?                           // 审核人
  
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  
  revisions       GoalRevision[]

  @@index([pipeline])
  @@index([status])
  @@map("agent_goal_cards")
}

model GoalRevision {
  id              String       @id @default(uuid()) @db.Uuid
  goalCardId      String       @db.Uuid
  goalCard        AgentGoalCard @relation(fields: [goalCardId], references: [id], onDelete: Cascade)
  
  // 快照
  longTermDirection String     @db.Text
  monthlyGoals    Json
  selfCheckCriteria String     @db.Text
  pipeline        PipelineName
  
  changeNote      String       @db.Text             // 变更说明
  changedBy       String                            // 操作人
  changedById     String?      @db.Uuid
  createdAt       DateTime     @default(now())
  
  @@index([goalCardId])
  @@index([createdAt])
  @@map("goal_revisions")
}
```

### 3.2 关键设计决策

| 决策 | 理由 |
|------|------|
| `agentId` unique | 一个 Agent 只有一张活跃目标卡 |
| `monthlyGoals` 用 JSON 数组 | 灵活存储多个月度目标，支持月度滚动 |
| `upstreamAgentIds` / `downstreamAgentIds` 数组 | 多对多关系，一个 Agent 可能跟多个 Agent 协作 |
| 独立 `GoalRevision` 表 | 追踪目标变更历史，支持审计和回溯 |
| 枚举 `PipelineName` | 管线类型固定，方便筛选和统计 |

---

## 4. API 设计

### 4.1 Agent 自助 API（核心）

这些是 Agent 通过 SSO Token 调用的接口：

```
# Agent 读取自己的目标卡
GET /api/goals/mine
→ { goalCard: AgentGoalCard | null }

# Agent 读取指定 Agent 的目标卡（跨管线协作）
GET /api/goals/:agentId
→ { goalCard: AgentGoalCard | null }
```

### 4.2 管理 API（管理员/CTO）

```
# 列出所有目标卡（支持按管线筛选）
GET /api/goals?pipeline=content&status=active
→ { goalCards: AgentGoalCard[] }

# 创建/更新目标卡
POST /api/goals                    # 创建
PUT /api/goals/:agentId            # 更新

# 获取未规划 Agent 列表（无目标卡的 Agent）
GET /api/goals/unassigned
→ { agents: MarketplaceAgent[] }

# 目标卡变更历史
GET /api/goals/:agentId/revisions
→ { revisions: GoalRevision[] }
```

### 4.3 集成 API

```
# 推送目标到 LLM Todo（目标卡 → todo 任务）
POST /api/goals/:agentId/push-todos
Body: { monthGoalIndex: number }
→ { created: number, taskIds: string[] }
```

---

## 5. 前端页面设计

### 5.1 页面结构

在 Agent Dev Center 新增路由：

```
/goals              → GoalDashboardPage     (目标卡看板)
/goals/:agentId     → GoalDetailPage        (目标卡详情/编辑)
```

### 5.2 目标卡看板（GoalDashboardPage）

```
┌──────────────────────────────────────────────────────┐
│  🎯 Agent 目标卡看板          [+ 新建目标卡]          │
├──────────────────────────────────────────────────────┤
│  管线筛选: [全部] [内容] [育儿] [投资] [健康] [规划]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│  │ 🟢 devtools │ │ 🟢 cto      │ │ 🔴 content  │    │
│  │ 管线: 内容   │ │ 管线: 规划   │ │ ⚠️ 无目标卡  │    │
│  │ 5月: 3目标  │ │ 5月: 2目标  │ │             │    │
│  │ ✓ 2/3 达成  │ │ ✓ 1/2 达成  │ │ [创建目标卡] │    │
│  └─────────────┘ └─────────────┘ └─────────────┘    │
│                                                      │
│  ── 未规划 Agent (2) ──                              │
│  ┌─────────────┐ ┌─────────────┐                    │
│  │ 🔴 quant    │ │ 🔴 health   │                    │
│  │ ⚠️ 无目标卡  │ │ ⚠️ 无目标卡  │                    │
│  └─────────────┘ └─────────────┘                    │
└──────────────────────────────────────────────────────┘
```

### 5.3 目标卡详情页（GoalDetailPage）

```
┌──────────────────────────────────────────────────────┐
│  ← 返回   devtools-agent 目标卡      [编辑] [推送到Todo]│
├──────────────────────────────────────────────────────┤
│                                                      │
│  📋 基本信息                                         │
│  管线: 内容生产    状态: 🟢 活跃    上次审核: 5/15     │
│  上游: ceo-agent   下游: itops-agent                  │
│                                                      │
│  🧭 长期方向                                         │
│  成为全栈工具开发专家，支撑所有 Agent 的前端/Web       │
│  需求交付                                            │
│                                                      │
│  📅 月度目标                                         │
│  ┌─ 2026-05 ──────────────────────────────┐          │
│  │ ① 完成所有 P0/P1 需求交付     [推送Todo]│         │
│  │ ② 建立标准化前端开发流水线              │          │
│  │ ③ 移动端适配覆盖率达 80%               │          │
│  └────────────────────────────────────────┘          │
│                                                      │
│  ✅ 自检标准                                         │
│  • DEV_SELF_CHECK 一次通过率 > 90%                   │
│  • 需求交付周期 < 3天                                │
│  • 零生产事故                                        │
│                                                      │
│  📝 变更历史  [展开]                                  │
│  2026-05-15 CTO 更新月度目标                          │
│  2026-05-01 创建目标卡                                │
└──────────────────────────────────────────────────────┘
```

### 5.4 组件拆分

| 组件 | 职责 |
|------|------|
| `GoalDashboardPage` | 看板主页，管线筛选 + 卡片网格 |
| `GoalCard` | 目标卡缩略卡片（管线/月度目标数/达成率） |
| `UnassignedAgentCard` | 未规划 Agent 提示卡片 |
| `GoalDetailPage` | 目标卡完整详情 |
| `GoalEditModal` | 创建/编辑目标卡弹窗 |
| `GoalRevisionTimeline` | 变更历史时间线 |
| `PipelineFilter` | 管线筛选栏 |
| `MonthlyGoalList` | 月度目标列表（支持逐条推送 Todo） |

---

## 6. Agent 集成方案

### 6.1 Agent 自助读取目标卡

Agent 通过 SSO Token（已有 `AgentAccessToken` 机制）调用：

```python
# Agent 在自己的 AGENTS.md 或 BOOTSTRAP.md 中配置
# 启动时读取自己的目标卡：

import urllib.request, json

token = os.environ.get("AGENT_DEV_TOKEN")
req = urllib.request.Request(
    "http://8.163.44.127/api/goals/mine",
    headers={"Authorization": f"Bearer {token}"}
)
resp = urllib.request.urlopen(req)
goal_card = json.loads(resp.read())

# 获取月度目标后，Agent 自主规划任务
monthly_goals = goal_card["monthlyGoals"]
for goal in monthly_goals:
    # 写入 LLM Todo
    create_todo(title=goal, source="goal-card")
```

### 6.2 与 LLM Todo 集成

```
目标卡月度目标 → POST /api/goals/:agentId/push-todos
                → 调用 LLM Todo API: POST /api/tasks
                → 创建 agent 类型任务，source="goal-card"
```

LLM Todo 已有 `type: "agent"` 和 `source` 字段，无需改 Schema。

### 6.3 与现有看板集成

- 目标卡页面从 `MarketplaceAgent` 表读取 Agent 列表
- 对比 `AgentGoalCard` 表找出未规划 Agent
- 目标卡详情页可跳转到该 Agent 的需求/任务页面

---

## 7. 技术实现计划

### Phase 1: 后端（2-3 天）

| 步骤 | 内容 |
|------|------|
| 1 | Prisma migration: 新增 `AgentGoalCard` + `GoalRevision` 表 |
| 2 | 后端路由: `src/routes/goals.ts` (8 个端点) |
| 3 | Agent SSO 鉴权集成: `/api/goals/mine` 用现有 agent token |
| 4 | LLM Todo 推送集成: 调用 LLM Todo API 创建任务 |

### Phase 2: 前端（2-3 天）

| 步骤 | 内容 |
|------|------|
| 1 | API client: `src/api/goals.ts` |
| 2 | 目标卡看板页: `GoalDashboardPage.tsx` |
| 3 | 目标卡详情页: `GoalDetailPage.tsx` |
| 4 | 编辑弹窗 + 变更历史 |
| 5 | 路由注册 + 导航菜单更新 |

### Phase 3: 集成 & 测试（1-2 天）

| 步骤 | 内容 |
|------|------|
| 1 | 端到端测试: Agent 读取目标 → 规划 Todo |
| 2 | 管理 CRUD 测试 |
| 3 | DEV_SELF_CHECK 提交 |

**预估工期**: 5-8 天

---

## 8. CTO Review 决议（2026-05-19）

**状态: Approved → 开始开发**

| 问题 | 决议 |
|------|------|
| 月度目标达成状态 | V1 手动标记。每月度目标加 `status: "not_started" \| "in_progress" \| "done"`，Agent 自行更新。V2 再做自动关联 LLM Todo |
| 管线协作关系 | 双向引用够用（数组），不需要独立关系表 |
| CEO 审核流程 | 简单记录（lastReviewedAt + lastReviewedBy），不走审批流 |
| 推送 Todo 去重 | 加 `pushedMonths: string[]`，推送前检查，已推送月份按钮显示"已推送" |

**额外要求**：
- PipelineName 扩展为 8 个：content/parenting/investment/health/planning/lifestyle/devops/education
- `/api/goals/mine` 鉴权同时支持 admin session 和 Agent SSO token
- 前端先做看板 + 详情，编辑弹窗后补
- WIP ≤ 2

---

## 9. 风险 & 约束

| 风险 | 缓解方案 |
|------|---------|
| 管线定义可能变化 | `PipelineName` 用 enum，migration 可扩展 |
| Agent 数量增长 | `unassigned` 查询用 LEFT JOIN，性能 OK |
| 月度目标格式不统一 | JSON Schema 校验 + 前端表单约束 |
| LLM Todo API 跨服务调用 | 后端代理调用，不暴露给前端 |

---

*开发开始: 2026-05-19*
