# ADC × LLM Todo 合并架构合同 v1

**版本**: 1.1（审计修订）
**状态**: 冻结（产品决策已通过，合同修订已完成）
**日期**: 2026-06-29
**声明**: 本文档是实施合同。DOCUMENT_ONLY_CHANGE。NO_CODE_CHANGES_PERFORMED。

---

## 1. 核心定义

### 1.1 统一实体

| 概念 | 命名规则 |
|------|---------|
| **Requirement = Task = Todo** | 三者在合并后是同一实体的不同称呼 |
| **数据真源** | `requirements` 表是唯一任务事实源 |
| **Folder V1** | 后端实体 = `BusinessDomain`；数据库及内部字段 = `domainKey`；公共 API V1 同样使用 `domainKey`；用户界面展示名称 = "Folder" |
| **Todo vs Folder** | Todo 不是独立 Folder，而是每个 Folder 内置的任务能力 |

### 1.2 UI 与 API 命名

| 层 | 命名 |
|----|------|
| 数据库 | `domainKey` |
| 后端代码 | `BusinessDomain` / `domainKey` |
| API V1 | `domainKey`（不引入 `folderKey` 别名） |
| UI 展示 | "Folder" |

未来版本化 API 可基于 `accept` header 或版本路径引入别名，不在 V1 做双命名。

### 1.3 Folder 层级

**V1 仅支持一级工作空间。** 不实现嵌套树结构。每个 Requirement 恰好归属一个 Folder（`domainKey`）。嵌套层级留待 V2。

---

## 2. 统一状态模型

### 2.1 当前真实状态

`status` 字段当前是 `String @default("pending")`，**不受 Enum 约束**。`RequirementStatus` enum 定义在设计层面已存在但未用于 schema 约束。

代码中实际出现的状态（查 `schema.prisma` `RequirementStatus` enum + 工作流步骤）：

```
draft, pending, approved, in_progress, review, testing,
deploying, rejected, clarifying, done, abandoned, archived
```

### 2.2 目标顶层生命周期

统一后只持久化以下 6 值：

```
draft → pending → in_progress → done
                                    ↓
                          cancelled / archived
```

### 2.3 现有状态 → 目标状态迁移表

| 现有状态 | 目标状态 | 规则 |
|---------|---------|------|
| `draft` | `draft` | 保留 |
| `pending` | `pending` | 保留 |
| `approved` | `pending` | 在审批流程中，`approved` 是 `pending` 的子阶段；按 `currentStep` 判断：若关联 `pm_review` 或 `cto_review` 步骤则保留 `in_progress` |
| `in_progress` | `in_progress` | 保留 |
| `review` | `in_progress` | 阶段由 `currentStep` 表达（如 `qa_review`, `cto_review`） |
| `testing` | `in_progress` | 阶段由 `currentStep` 表达 |
| `deploying` | `in_progress` | 阶段由 `currentStep` 表达 |
| `rejected` | `pending` | 驳回后回到待处理 |
| `clarifying` | `pending` | 需要澄清时视为等待发起者，归入 `pending` |
| `done` | `done` | 保留 |
| `abandoned` | `cancelled` | 等同取消 |
| `archived` | `archived` | 保留 |

**`approved` 细节决策表**（结合 `currentStep`）：

| `status` = | `currentStep` = | 目标 | 理由 |
|------------|-----------------|------|------|
| `approved` | `null` 或 `draft` | `pending` | 已批准但未开工 |
| `approved` | `pm_review` | `in_progress` | 审批步骤进行中 |
| `approved` | `qa_review` | `in_progress` | 审查步骤进行中 |
| `approved` | `cto_review` | `in_progress` | CTO 审查步骤进行中 |
| `approved` | `dev_self_check` 等开发步骤 | `in_progress` | 开发进行中 |
| `approved` | `deploying` | `in_progress` | 部署进行中 |
| `approved` | 其他已定义工作流步骤 | `in_progress` | 由 `currentStep` 表达阶段 |

### 2.4 状态收敛契约

- **兼容期**：API 写入仍接受旧状态值，但内部映射为目标 6 值之一
- **收敛时机**：Batch 2 完成后，schema 将 `status` 从 `String` 改为受控 Enum
- **拒绝策略**：Enum 化后新写入旧状态值返回 400
- **Migration 前后 API 行为**：
  - 迁移前：API 返回原始 `status` 值
  - 迁移后：API 返回派生 6 值（查询为向后兼容可加 `?raw_status=true` 参数）
- **不引入第三套持久化状态**：6 值唯一真源，派生视图不持久化

### 2.5 派生视图（不持久化）

| 派生视图 | 查询条件 |
|---------|---------|
| `waiting` | `status = 'in_progress' AND currentStep IN ('qa_review', 'cto_review', 'pm_review')` |
| `blocked` | `status = 'in_progress' AND blockedReason IS NOT NULL` |
| `review` | `status = 'in_progress' AND currentStep LIKE '%review%'` |
| `overdue` | `dueDate < NOW() AND status NOT IN ('done', 'cancelled', 'archived')` |

派生视图通过 API query parameter 实现（如 `?view=overdue`）。

---

## 3. 字段决策

### 3.1 后续新增字段（Batch 2 实施）

| 字段 | 类型 | 用途 |
|------|------|------|
| `nextAction` | String? | 当前步骤的下一步动作提示（已在 /mine 实现） |
| `scheduledAt` | DateTime? | 任务计划开始时间 |
| `snoozedUntil` | DateTime? | 暂时从工作视图隐藏到指定时间 |
| `blockedReason` | String? | 阻塞原因 |
| `completedAt` | DateTime? | 实际完成时间 |
| `parentId` | String? @db.Uuid | 父任务 ID（V1 单层父子） |
| `legacySource` | String? | 数据迁移来源（如 `'todo-sqlite'`） |
| `legacyId` | String? | 原系统中的 ID |

### 3.2 保留现有字段

| 字段 | 说明 |
|------|------|
| `dueDate` | 截止日期 |
| `priority` | P0/P1/P2/P3 |
| `type` | FEATURE/BUGFIX/POSTMORTEM/INFRA/SECURITY |
| `tags` | String[] |
| `assigneeId` | 负责人 |
| `requesterId` | 创建者 |
| `currentStep` | 工作流步骤 |
| `status` | 生命周期（6 值目标） |
| `stateVersion` | CAS 版本 |
| `dependsOnIds` / `blockedBy` | 依赖关系（第一阶段保留现有字段） |

### 3.3 不新增字段

| 旧 Todo 字段 | 决策 | 理由 |
|-------------|------|------|
| `targetDate` | ❌ 丢弃 | 用 `dueDate` 替代 |
| `horizon` | ❌ 丢弃 | 用 `priority` + `dueDate` 表达 |
| `layer` | ❌ 丢弃 | 无实际消费方 |
| `llmAnalyzed` | ❌ 丢弃 | 不持久化分析标记 |
| `deliveryPath` | ❌ 丢弃 | 用 `currentStep` + 派生视图替代 |
| `assignmentState` | ❌ 丢弃 | 用派生视图计算 |
| `personalType` | ❌ 丢弃 | 用 `type` + `tags` 替代 |
| `tier1/tier2` | ❌ 丢弃 | 映射到 WorkflowStep |

---

## 4. 字段生命周期规则

### 4.1 `completedAt`

- 状态**首次**进入 `done` 时自动设置 `completedAt = NOW()`
- 从 `done` 重新打开（回退到 `in_progress` 或 `pending`）时清空 `completedAt`
- `archive` 操作不修改 `completedAt`
- `cancelled` 默认不设置 `completedAt`（已放弃而非完成）

### 4.2 `parentId`

- V1 只支持单层父子任务，**不支持任意 Folder 嵌套**
- 父任务删除 → 子任务 `parentId = NULL`（`ON DELETE SET NULL`）
- 父任务归档 → 子任务不变（`parentId` 保留）
- 禁止形成自引用（`parentId = id`）和循环关系（A→B→A）
- API 创建/更新时服务端校验合法性

### 4.3 `scheduledAt` vs `snoozedUntil`

| 字段 | 含义 | 影响视图 |
|------|------|---------|
| `scheduledAt` | 任务计划**开始**时间 | 到时间后出现在默认工作视图 |
| `snoozedUntil` | 暂时从工作视图**隐藏**到指定时间 | 在 `snoozedUntil` 之前不显示在默认视图，出现在 `waiting` 派生视图 |

- `snoozedUntil` 优先影响 `waiting` 派生视图的排除逻辑
- 两者均不直接改变顶层 `status`
- 同时设置时 `snoozedUntil` 优先（在 `snoozedUntil` 之前隐藏，`scheduledAt` 在隐藏期内不生效）

---

## 5. Folder 映射

### 5.1 Todo "area" → Folder/Domain

| Todo area | `domainKey` | 说明 |
|-----------|-------------|------|
| `dev` | `engineering` | 开发 |
| `ops` | `operations` | 运维 |
| `life` | `personal` 或 `family` | 根据任务内容拆分 |
| `health` | `health` | 健康 |
| `learning` | `learning` | 学习 |
| `content` | `content` | 内容创作 |
| `finance` | `finance` | 财务 |
| *(无法明确映射)* | `legacy-todo` | 临时迁移 Folder |

### 5.2 迁移规则

- 每个 Todo 记录的 `area` 字段值直接映射到 `domainKey`
- 无法匹配的历史任务统一放入 `legacy-todo` Folder
- 迁移后用户可手动调整 Folder 归属
- `legacy-todo` 在迁移完成且无任务后可删除

---

## 6. 功能归属

| Todo 功能 | ADC 对应 | 处理方式 |
|-----------|---------|---------|
| tier1/tier2 审查 | `WorkflowStep` + `RequirementReport` + `WorkflowTransition` | 工作流引擎已有 |
| reminders | `RequirementReminder`（新表，Batch 2） | 独立提醒表 |
| deliverables | `RequirementReport`（第一阶段） | 作为报告内容存储 |
| comments | **`RequirementComment`**（**已存在**，复用） | 复用现有模型：`id`, `requirementId`, `parentId`, `authorId`, `content`, `type`, `status`, `mentions`；迁移旧 Todo comments 进入此表；保留现有 `parentId/type/status/mentions` 能力 |
| dependencies | `dependsOnIds` / `blockedBy`（现有字段，第一阶段） | 后续评估是否关联表化 |
| goal_cards | OKR 服务 | **不进入** Todo 合并范围 |
| capabilities/webhook/chat/compile | 各自服务 | **不进入** Todo 合并范围 |
| users | ADC `users` 表 | **唯一身份源** |

### 6.1 旧 Todo Comment 字段映射

| 旧字段 | 映射 | 说明 |
|--------|------|------|
| `id` | `legacySource + legacyId` | 写入 `RequirementComment` 记录（通过批处理脚本） |
| `content` | `content` | 直接映射 |
| `author` | `authorId` | 通过 email/name 匹配到 ADC user，无法匹配的写入 `legacy-todo` 用户 |
| `created_at` | `createdAt` | 保留原始时间 |
| `parent_id` | `parentId` | 支持嵌套回复 |
| 未知字段 | ❌ 丢弃 | 不持久化 |

---

## 7. 切换策略

### 7.1 禁止双写

正式策略为**单向迁移 + 旧系统只读**：

```
1. ADC 兼容 API 上线 (Batch 3)
2. 新写入只写 requirements 表
3. 旧 Todo 服务切换为只读模式（写请求返回 HTTP 410 "Service deprecated, use /api/requirements"）
4. 历史数据一次性迁移 (Batch 4)
5. SQLite 数据库转为只读归档
6. 所有调用方验证完成
7. 旧 Todo 服务下线 (Batch 5)
```

### 7.2 兼容 API

兼容 API 通过 `legacySource` + `legacyId` 映射：

- **请求**: 兼容 API 接受旧 Todo 整数 ID（`GET /api/todo/42`）
- **查找**: `WHERE legacySource = 'todo-sqlite' AND legacyId = '42'`
- **响应**: 同时返回 `id`（新 Requirement UUID）和 `legacyId`（旧 Todo 整数 ID）
- **字段类型**：`legacySource = String?`（来源名），`legacyId = String?`（原 ID 转字符串存储）
- **唯一约束**：`@@unique([legacySource, legacyId])`

### 7.3 幂等迁移

- `(legacySource, legacyId)` 建立唯一约束（Batch 2 attachment）
- 迁移脚本使用 `INSERT ... ON CONFLICT (legacySource, legacyId) DO NOTHING`
- 重复运行迁移脚本不会产生重复记录

### 7.4 迁移失败回滚

- 迁移脚本在事务中执行
- 失败时整个 batch 回滚
- 迁移进度记录在 `_migration_progress` 表中（记录最后处理的 legacyId）
- 回滚不删除已迁移的 Requirement（旧系统仍可重新迁移）

### 7.5 SQLite 只读归档

- 原始 SQLite 文件只读归档，按最小保留原则（保留原始数据作为最终回退）
- 不修改、不压缩、不删除原始 SQLite
- 在 Batch 5 完成且验证通过后才可归档至冷存储

### 7.6 确认无旧 API 写调用方

- Batch 3 上线后通过日志监控旧 Todo API 的写端点
- 确认连续 7 天无写请求后进入 Batch 5
- 下线前最终通过日志聚合确认
- 不得引入双写

---

## 8. 调用方迁移清单

| 调用方 | 旧 endpoint | 新 endpoint | 认证 | 验证 | 回滚 |
|--------|------------|------------|------|------|------|
| **todo-client skill** | SQLite 直接读写 | `GET/POST /api/requirements` | ADC JWT | 功能测试 + 数据对比 | 恢复 SQLite 读写 |
| **efficiency-agent reminder cron** | Todo API + reminder 字段 | `GET /api/requirements/:id/reminders` + `POST /api/requirements/:id/reminders` | ADC JWT | 提醒按时触发 | 恢复旧 cron 配置 |
| **agent-task-dispatcher** | Todo API 任务领取 | `GET /api/requirements/mine` + `POST /api/requirements/:id/workflow/advance` | ADC JWT | 任务正确分配 | 恢复旧 dispatcher |
| **submit-review.sh** | Todo API + tier1/tier2 字段 | `POST /api/requirements/:id/reports` | ADC JWT | 报告提交成功 | 恢复旧脚本 |
| **public/index.html** | Todo API 渲染 | `GET /api/requirements` + Folder 视图 | ADC JWT | 页面正常显示 | 恢复旧前端 |
| **agent.html** | Todo API 渲染 | `GET /api/requirements` + Folder 视图 | ADC JWT | 页面正常显示 | 恢复旧前端 |

---

## 9. 六阶段实施计划

### Batch 0: Migration Architecture 与 Fresh Bootstrap

| 维度 | 内容 |
|------|------|
| **schema** | `TestEnvLock.lockToken UUID NULL` expansion migration；canonical Prisma 收敛（删除根 `prisma/` 副本，统一 `--schema` 路径） |
| **API** | 无 |
| **frontend** | 无 |
| **callers** | 无 |
| **tests** | Fresh DB bootstrap 脚本验证；existing DB 升级测试；canonical gate test |
| **rollback** | 不需要（基础设施） |
| **审计门** | `MIGRATION_ARCHITECTURE_READY_FOR_AUDIT` |
| **现存阻塞** | migration chain 因 `add_git_hash` 早于 `service_requirements` 创建而阻塞。`bootstrap-fresh-db.sh` 已创建但需完善多层迁移修复。Production 数据库不受影响（已有完整 history） |

**状态**: `bootstrap-fresh-db.sh` 已创建。CAS 分支锁代际 token 待接入。

### Batch 1: BusinessDomain/Folder 与服务端硬隔离

| 维度 | 内容 |
|------|------|
| **schema** | `BusinessDomain` model（id, domainKey, displayName, description, ownerId, createdAt）；`Requirement.domainKey` 字段 |
| **API** | `GET/POST/PUT/DELETE /api/folders`；`roleAwareRequirementWhere` 增加 domain 过滤；未知 `domainKey` fail-closed 返回空集 |
| **frontend** | 无（V1 后端先行） |
| **callers** | 无 |
| **tests** | Folder CRUD；domain 隔离；未知 domainKey fail-closed |
| **rollback** | `domainKey` nullable；旧代码不受影响 |
| **审计门** | `FOLDER_ISOLATION_READY_FOR_AUDIT` |

### Batch 1.5: Agent Task Claim/Lease Reliability

> 不阻塞 BusinessDomain 表和 domain 隔离实现，因此不要求 Batch 1 之前完成。但必须在 **Batch 3**（兼容 API 上线和新写入切换）之前审计通过。

| 维度 | 内容 |
|------|------|
| **schema** | 现有 `ExecutionLease` + `ExecutionLeaseEvent` |
| **API** | 原子 claim、lease token、heartbeat、expiry、crash recovery |
| **callers** | agent-task-dispatcher |
| **tests** | 原子 claim 竞争；lease 过期；重复领取保护；crash recovery |
| **rollback** | 恢复旧 dispatcher 逻辑 |
| **审计门** | `CLAIM_LEASE_READY_FOR_AUDIT` |

### Batch 2: Requirement 核心 Todo 字段、Reminder 及派生视图

| 维度 | 内容 |
|------|------|
| **schema** | `scheduledAt`, `snoozedUntil`, `blockedReason`, `completedAt`, `parentId`, `legacySource`, `legacyId`；`RequirementReminder` model；`(legacySource, legacyId)` 唯一约束；`status` 从 String 收敛为受控 Enum |
| **API** | `GET /api/requirements?view=overdue|blocked|review|waiting`；reminder CRUD；comment 迁移端点 |
| **frontend** | 无 |
| **callers** | efficiency-agent 开始对接 reminder API |
| **tests** | 派生视图查询正确性；reminder CRUD；comment 迁移；legacyId 唯一性；旧状态拒绝(400) |
| **rollback** | 所有新字段 nullable；旧代码不受影响；`Enum` 前保留 `raw_status` 逃生口 |
| **审计门** | `TODO_FIELDS_AND_VIEWS_READY_FOR_AUDIT` |

### Batch 3: Todo 兼容 API 与新写入切换到 ADC

| 维度 | 内容 |
|------|------|
| **schema** | 无新表 |
| **API** | Todo 兼容端点（`GET /api/todo/:legacyId` 映射到 Requirement）；旧 Todo 写端点返回 410 Gone |
| **frontend** | 无 |
| **callers** | todo-client skill、submit-review.sh、agent-task-dispatcher 切换到 ADC API |
| **tests** | 兼容 API 双向映射；旧 ID 查找；新写入只进 requirements |
| **rollback** | 旧 Todo 服务恢复写权限（兼容 API 保留） |
| **审计门** | `COMPAT_API_READY_FOR_AUDIT` |

### Batch 4: SQLite 历史数据迁移与旧系统只读

| 维度 | 内容 |
|------|------|
| **schema** | 无新表 |
| **API** | 无 |
| **frontend** | 无 |
| **callers** | 旧 Todo 服务切换为只读 |
| **tests** | 数据迁移幂等性；area → domainKey 映射正确；记录数一致；旧 API 只读验证（410） |
| **rollback** | 旧系统恢复写权限；已迁移数据保留（`legacySource` 标记）；SQLite 归档保留 |
| **审计门** | `DATA_MIGRATION_READY_FOR_AUDIT` |

### Batch 5: ADC Folder 前端视图和旧 Todo 服务下线

| 维度 | 内容 |
|------|------|
| **schema** | 无新表 |
| **API** | 旧 Todo API 端点完全移除 |
| **frontend** | public/index.html 和 agent.html 使用 Folder 视图 |
| **callers** | 所有调用方确认已迁移 |
| **tests** | 旧 API 返回 404；前端 Folder 视图正常；7 天无旧 API 写请求日志 |
| **rollback** | 旧 Todo 服务重新上线（最后手段） |
| **审计门** | `TODO_SERVICE_DECOMMISSIONED` |

---

## 10. 尚未解决但不阻塞设计的问题

| 问题 | 说明 | 处理时机 |
|------|------|---------|
| Reminder 通知渠道（推送/邮件/Webhook） | 需要产品确认优先渠道 | Batch 2 实施前 |
| Comment @mention 实时通知 | 是否需要解析 @username 并发送通知 | Batch 2 实施前 |
| Folder 共享与权限 | V1 是否支持多用户共享同一 Folder | Batch 1 实施前 |
| 嵌套 Folder | V2 需求，V1 不实现 | V2 设计阶段 |
| Todo 标签与 ADC `tags` 合并 | Todo 可能有 ADC 不支持的标签格式 | Batch 4 迁移时处理 |
| 旧 Todo 附件迁移 | 附件是否迁移到 ADC 或保留在 SQLite 归档 | Batch 4 实施前 |
| `legacy-todo` Folder 清理策略 | 何时删除以及是否通知用户 | Batch 5 后 |

---

## 附录 A: 数据模型预览（不实施，仅合同）

### BusinessDomain (Folder V1)

```prisma
model BusinessDomain {
  id          String   @id @default(uuid()) @db.Uuid
  domainKey   String   @unique
  displayName String
  description String?
  ownerId     String   @db.Uuid
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  requirements Requirement[]
  @@map("business_domains")
}
```

### Requirement 新增字段（Batch 2）

```prisma
// 在现有 Requirement model 中新增：
domainKey     String?
scheduledAt   DateTime?
snoozedUntil  DateTime?
blockedReason String?
completedAt   DateTime?
parentId      String?  @db.Uuid
legacySource  String?
legacyId      String?
@@unique([legacySource, legacyId])
```

### RequirementReminder（Batch 2 新建）

```prisma
model RequirementReminder {
  id            String   @id @default(uuid()) @db.Uuid
  requirementId String   @db.Uuid
  remindAt      DateTime
  channel       String   @default("web")
  message       String?
  sentAt        DateTime?
  createdAt     DateTime @default(now())
  requirement   Requirement @relation(fields: [requirementId], references: [id])
  @@map("requirement_reminders")
}
```

### RequirementComment（已存在，复用于 Batch 2）

当前 `backend/prisma/schema.prisma` 已有完整模型：

```prisma
model RequirementComment {
  id            String   @id @default(uuid()) @db.Uuid
  requirementId String   @db.Uuid
  parentId      String?  @db.Uuid
  content       String
  authorId      String   @db.Uuid
  type          String   @default("discussion")
  status        String   @default("open")
  mentions      String[] @default([])
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  // 关联、索引、maps 略
}
```

Batch 2 不新建 `RequirementComment`，仅复用并迁移旧数据。

---

## 附录 B: 术语对照表

| Todo 术语 | ADC 术语 | 统一后 |
|-----------|---------|--------|
| Todo | Requirement | Requirement（后端）/ Todo（用户口语） |
| Area | Domain/Folder | Folder（用户）/ `domainKey`（API） |
| tier1 | QA Review | WorkflowStep: qa_review |
| tier2 | CTO Review | WorkflowStep: cto_review |
| Status (todo) | Status (requirement) | 统一 6 值 status |
| assignee | assigneeId | assigneeId |
| due_date | dueDate | dueDate |
| created_at | createdAt | createdAt |

---

## 附录 C: 冻结的核心产品决策

以下决策已在产品层面确认，本文档不得修改：

1. **Requirement = Task = Todo** — 同一实体
2. **BusinessDomain = Folder V1** — 后端实体命名
3. **`requirements` 是唯一任务事实源** — 不存在第二条任务记录系统
4. **Todo 不是独立 Folder** — Todo 能力内置于所有 Folder
5. **V1 Folder 不嵌套** — 单级工作空间
6. **禁止双写** — 单向迁移策略

---

**文档结束。版本 1.1，已根据独立审计要求修订。**
