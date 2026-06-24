# 统一身份与规划平台 — Mini Design Doc

> 需求 ID: `9fd9b02a-f658-44e2-b343-b09f2f5cf5d7`
> 替代: `5e370a95`（个人属性与规划平台）+ `83dd4941`（Agent团队管理看板）
> 作者: devtools-agent | 日期: 2026-05-22
> 状态: Draft

---

## 1. 问题陈述

当前"人"和"Agent"是两套分裂的系统和数据模型：

| 维度 | 个人属性平台 (5e370a95) | Agent 团队看板 (83dd4941) |
|------|------------------------|-------------------------|
| 身份模型 | `User` 表 (users) | `MarketplaceAgent` 表 + `AgentGoalCard` 表 |
| Profile | 个人信息页 | Agent详情页 |
| OKR | 缺失（走LLM Todo临时任务） | 月度目标卡（6d78011f） |
| 能力图谱 | 技能树（skill-tree.ts） | 无独立能力字段 |
| 长期方向 | Roadmap | longTermDirection |

**错误分裂的后果：**
- 人和 Agent 在系统中身份不平等（Agent 用 `agentId`，人用 `userId`）
- 数据结构重复（如管线/层级在不同表里各存一套）
- 无法统一展示"所有实体的全面状态"

---

## 2. 核心设计理念：一份数据，两套视图

```
                ┌────────────────────────┐
                │     Identity 表         │
                │  (type=human|agent)     │
                │  ┌─ 通用字段 ────────┐ │
                │  │  displayName      │ │
                │  │  longTermDirection │ │
                │  │  monthlyGoals     │ │
                │  │  capabilities     │ │
                │  │  pipeline         │ │
                │  │  layer            │ │
                │  └───────────────────┘ │
                │  ┌─ Agent特有 ───────┐ │
                │  │  agentId          │ │
                │  │  ownerId          │ │
                │  │  agentType        │ │
                │  └───────────────────┘ │
                │  ┌─ Human特有 ───────┐ │
                │  │  userId           │ │
                │  └───────────────────┘ │
                └────────────────────────┘
                          ↕
                ┌────────────────────────┐
                │  Unified Profile Page   │
                │  (同一套组件, type 决  │
                │   定渲染差异)           │
                └────────────────────────┘
```

**核心原则：**
- `type=human|agent` 区分实体类型
- 通用字段（OKR/方向/能力图谱）完全共享
- Agent 特殊字段 `agentId`, `ownerId`（属于谁）, `agentType`（开发/运维/安全...）
- Human 只需要引用 `userId`（关联 ADC 登录用户）

**注意：不要和现有 `users` 表冲突。** ADC 的 `users` 表管的是"登录系统的人"。Identity 管的是"系统中有 Profile 的所有实体"——一个 User 可以有多个 Agent（owner），一个 Agent 就是一个人工智能助手的身份。

---

## 3. 项目归属

**推荐：整合到现有 ADC（Agent Dev Center），新增模块。**

理由：
- ADC 已有 `user`、`marketplace_agent`、`agent_goal_cards`、`weekly_reports` 表
- 新增一个 `identities` 表作为统一查询视图，原有的表继续存在（双写过渡期后废弃）
- 前端新增 `/identity/` 路由（Profile 页 + OKR 管理 + 能力图谱）
- 不需要引入新的前端/后端项目，减少运维成本和跨系统同步复杂度

**路由设计：**
```
/identity/               → 统一实体列表（人 + Agent 平级展示）
/identity/human/:id      → 人的 Profile 页
/identity/agent/:id      → Agent 的 Profile 页
/identity/:id/okr        → 实体的 OKR 管理页
/identity/:id/capabilities → 实体的能力图谱
```

**导航菜单调整：**
- 当前：个人平台 / Agent 看板（两个入口）
- 统一后：一个入口 "实体"→ 筛选类型下拉切换 human/agent

---

## 4. 数据模型设计

### 4.1 Prisma 模型

```prisma
enum EntityType {
  human
  agent
}

model Identity {
  id              String     @id @default(uuid()) @db.Uuid
  
  // ── 类型 ──
  type            EntityType       // human | agent
  
  // ── 通用字段（人和 Agent 都有） ──
  displayName       String
  avatar            String?
  description       String         @db.Text
  longTermDirection String         @db.Text    // 长期方向
  // monthlyGoals JSON schema:
  // Array<{
  //   month: string;        // "2026-05"
  //   goal: string;         // 目标描述
  //   krs: Array<{          // Key Results
  //     text: string;
  //     progress: number;   // 0-100
  //     status: 'todo'|'doing'|'done'
  //   }>;
  //   status: 'active'|'completed'|'cancelled';
  // }>
  monthlyGoals      Json           @default("[]")
  capabilities      Json           @default("[]") // ["skill1", "skill2"]
  pipeline          PipelineName?
  layer             GoalLayer?
  
  // ── Agent 特有字段 ──
  agentId           String?        @unique     // 关联 marketplace_agents.id
  ownerId           String?        @map("owner_id")    // 属于哪个 User，引用 users.id（无 FK 约束）
  agentType         String?                    // "devtools" | "dev-engineer" | "itops" | ...
  
  // ── Human 特有字段 ──
  userId            String?        @unique @db.Uuid // 关联 users.id
  
  // ── 元数据 ──
  status            String         @default("active") // active | paused | archived
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  
  @@index([type])
  @@index([pipeline])
  @@index([status])
  @@index([ownerId])      // 高频查询：查某个 User 有哪些 Agent
  @@map("identities")
}
```

### 4.2 与现有表的关系

```
┌──────────┐     ┌────────────┐     ┌──────────────────┐
│  users   │     │ identities │     │ marketplace_agents│
│ (ADC)    │←────┤ (新增)     │←────┤ (已有)           │
│          │     │            │     │                  │
│ id       │     │ userId →   │     │ ← agentId        │
│ name     │     │ type=human │     │ type=agent       │
│ email    │     └────────────┘     └──────────────────┘
│ role     │
└──────────┘
```

**数据流：**
1. **读路径**：前端查 `GET /api/identities` → 返回 Unified 列表（人 + Agent 合并排序）
2. **写路径**（⚠️ 同步双写）：编辑 OKR → 写 `identities` 表 → **同步**写回 `agent_goal_cards`（同一事务或失败时拒绝请求，避免时间窗口不一致）
3. **迁移后**：Agent 的 goal card 数据从 `agent_goal_cards` 迁移到 `identities.monthlyGoals`

---

## 5. API 路由规划

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/identities` | 统一实体列表（支持 `?type=human\|agent` 过滤） |
| `GET` | `/api/identities/:id` | 单实体详情（含 OKR、能力图谱） |
| `PATCH` | `/api/identities/:id` | 更新实体信息（长期方向、管线等） |
| `GET` | `/api/identities/:id/goals` | 实体的 OKR 列表（月度目标） |
| `PATCH` | `/api/identities/:id/goals` | 更新实体的 OKR |
| `GET` | `/api/identities/:id/capabilities` | 实体的能力图谱 |
| `PATCH` | `/api/identities/:id/capabilities` | 更新能力图谱 |
| `POST` | `/api/identities/sync` | 管理接口：从 User/Agent 同步数据 |

**后端文件结构：**
```
backend/src/routes/identities.ts     → 主路由
backend/src/services/identity.ts     → 业务逻辑（合并查询、数据同步）
```

---

## 6. 前端组件树

```
IdentityPage (统一入口页)
├── IdentityList
│   ├── IdentityCard (通用卡片)
│   │   ├── EntityTypeBadge (human/agent 标签)
│   │   ├── OKRProgress (OKR 进度条)
│   │   └── CapabilityTags (能力标签)
│   └── TypeFilter (human/agent 下拉筛选)
│
├── IdentityProfilePage (统一 Profile)
│   ├── ProfileHeader (头像、名称、类型)
│   ├── LongTermDirectionCard (长期方向)
│   ├── OKRCard (月度 OKR 列表 + KR 进度)
│   │   └── KRProgressBar (可量化进度条)
│   ├── CapabilityCloud (能力图谱/技能树)
│   └── WeeklyReportTimeline (周报时间线, Agent only)
│
└── IdentityOKRPage (OKR 管理页)
    ├── OKRGrid (所有实体 OKR 概览)
    └── OKREditModal (编辑 OKR)
```

**前端文件结构：**
```
frontend/src/pages/
├── IdentityListPage.tsx       → /identity (替代 AgentTeamBoard + GoalDashboard)
├── IdentityProfilePage.tsx    → /identity/:type/:id (统一 Profile)
├── IdentityOKRPage.tsx        → /identity/:id/okr

frontend/src/api/
├── identities.ts              → API 客户端

frontend/src/components/
├── IdentityCard.tsx           → 统一卡片组件
├── EntityTypeBadge.tsx        → human/agent 标签
├── OKRProgress.tsx            → 统一 OKR 进度条
```

**导航调整：**
```
当前:                   统一后:
├─ 需求管理             ├─ 需求管理
├─ Agent 看板  ← 301   ├─ 统一身份  ← 新增 (替代)
├─ OKR 看板    ← 301   ├─ OKR 管理   ← 统一入口
├─ Kanban 看板          ├─ Kanban 看板
```

**301 重定向规则：**
```
/agent-team-board  →  /identity?type=agent   (301)
/goals             →  /identity?type=human   (301)
```
旧路径 301 永久重定向，浏览器/爬虫自动更新 bookmark。

---

## 7. 数据迁移方案

### 7.1 阶段一：创建 Identity 表 + 双写（过渡期）

```
1. Prisma migration → 创建 identities 表
2. 新 API (identities.ts) 读取 Identity 表
3. 编辑逻辑：写入 Identity + 异步同步回 AgentGoalCard
4. 原页面（AgentTeamBoard/AgentDetail）继续读原表
```

### 7.2 阶段二：切换读路径

```
1. 原页面逐步切换为读 Identity 表
2. AgentGoalCard、WeeklyReport 标记为 legacy
3. Identity 表成为单一数据源
```

### 7.3 阶段三：清理旧表

```
1. 确认所有读路径切换完成
2. 删除 AgentGoalCard 表迁移代码
3. 可选：删除旧表
```

---

## 8. 不做的事情（明确边界）

- ❌ *不* 修改 ADC `users` 表结构（已有的 RBAC 逻辑不动）
- ❌ *不* 重写现有 AgentTeamBoard 页（暂时保留，逐步替换为 Identity 页面）
- ❌ *不* 影响 LLM Todo（Identity 平台和 LLM Todo 职责不同）
- ❌ *不* 引入微服务（统一身份平台作为 ADC 模块运行）

---

## 9. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| 现有 Agent 页面依赖旧模型 | 高 | 双写过渡期，不断旧接口 |
| identity 表与 user 表混淆 | 中 | `type` 字段 + 引用 userId 而非复制 User 数据 |
| 前端架构变动大 | 中 | 渐进式切换，先 Profile 页再替换首页列表 |
| 部署需要 DB migration | 必发生 | 设计文档早出，itops-agent 提前准备 |

---

## 10. 工作量估算

| 模块 | 预估工时 | 说明 |
|------|---------|------|
| Prisma migration (Identity 表) | 0.5h | 简单，itops 操作 |
| 后端 identities.ts 路由 + API | 2h | CRUD + 迁移同步 |
| 前端 IdentityListPage | 2h | 替换 AgentTeamBoard |
| 前端 IdentityProfilePage | 2h | 统一 Profile 组件 |
| 前端 OKR 管理组件 | 1.5h | OKRCard + edit |
| 前端导航+路由调整 | 0.5h | 菜单结构变更 |
| 数据迁移脚本 | 1h | User→Identity + Agent→Identity |
| **总计** | **~9.5h** | 前端 6h + 后端 2.5h + DB 1h |

---

**Mini Design Doc 结束。收到确认后开始开发** 🚀
