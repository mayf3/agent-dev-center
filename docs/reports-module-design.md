# 需求平台 Reports 模块设计文档

## 需求背景

为了支持标准化的交付验收流程（5 阶段），需求平台需要增加"验收报告"功能，让各工程师提交报告并可视化展示。

## 功能目标

1. **报告提交**：各工程师通过 API 提交验收报告
2. **报告查询**：CTO 查看某个需求的所有报告
3. **报告可视化**：需求详情页展示报告时间线
4. **报告模板**：每种报告类型有标准化的 JSON 结构

## 数据库设计

### 新增表：`requirement_reports`

```prisma
model RequirementReport {
  id              String            @id @default(uuid()) @db.Uuid
  requirementId   String            @db.Uuid
  requirement     Requirement       @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  
  // 报告类型（对应 5 个验收阶段）
  reportType      ReportType
  
  // 报告内容（JSON 格式，存储不同的报告结构）
  content         Json              // 具体结构见下方
  
  // 提交者信息
  submittedBy     String            // Agent ID 或 Agent 名称
  submittedById   String?           @db.Uuid // 关联 User.id（如果是注册用户）
  submittedByUser User?             @relation("ReportSubmitter", fields: [submittedById], references: [id])
  
  // 审核状态
  status          ReportStatus      @default.pending
  
  // CTO 审核意见
  reviewComment   String?           @db.Text
  reviewedAt      DateTime?
  
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([requirementId])
  @@index([reportType])
  @@index([submittedBy])
  @@index([status])
  @@map("requirement_reports")
}

enum ReportType {
  DEV_SELF_CHECK      // 开发自检报告
  SECURITY_REVIEW     // 安全检查报告
  TEST_REPORT         // 测试报告
  CTO_REVIEW          // CTO 验收报告
  DEPLOY_CONFIRM      // 发布确认报告
}

enum ReportStatus {
  pending      // 待审核
  approved     // 已通过
  rejected     // 已驳回
  changes_requested  // 需要修改
}
```

### 修改 Requirement 模型

```prisma
model Requirement {
  // ... 现有字段
  
  reports RequirementReport[] // 新增关联
}
```

## API 设计

### 1. 提交报告

**Endpoint**: `POST /api/requirements/:id/reports`

**权限**：需要认证（JWT）

**请求体**：
```json
{
  "reportType": "DEV_SELF_CHECK",
  "content": {
    "checklist": [
      {"item": "代码已提交到 Git", "status": "pass", "note": ""},
      {"item": "本地运行无错误", "status": "pass", "note": ""}
    ],
    "bugsFixed": 2,
    "unitTestsAdded": 5,
    "summary": "功能已完成，自检通过"
  }
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "reportType": "DEV_SELF_CHECK",
    "status": "pending",
    "createdAt": "2026-05-10T15:30:00Z"
  }
}
```

### 2. 查询某个需求的所有报告

**Endpoint**: `GET /api/requirements/:id/reports`

**权限**：需要认证

**Query 参数**：
- `reportType`（可选）：过滤报告类型
- `status`（可选）：过滤状态

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "reportType": "DEV_SELF_CHECK",
      "status": "approved",
      "content": {...},
      "submittedBy": "agent-dev-engineer",
      "createdAt": "2026-05-10T15:30:00Z",
      "reviewComment": "自检通过，可以进入安全检查",
      "reviewedAt": "2026-05-10T15:35:00Z"
    }
  ]
}
```

### 3. CTO 审核报告

**Endpoint**: `PATCH /api/requirements/:id/reports/:reportId`

**权限**：仅 CTO（admin 角色）

**请求体**：
```json
{
  "status": "approved",
  "reviewComment": "测试覆盖全面，通过"
}
```

### 4. 删除报告（仅草稿/驳回状态）

**Endpoint**: `DELETE /api/requirements/:id/reports/:reportId`

**权限**：仅提交者本人或 CTO

## 报告内容结构（JSON Schema）

### 1. 开发自检报告（DEV_SELF_CHECK）

```json
{
  "checklist": [
    {"item": "检查项名称", "status": "pass|fail|warning", "note": "备注"}
  ],
  "bugsFixed": 0,
  "unitTestsAdded": 0,
  "codeQualityNote": "",
  "summary": ""
}
```

### 2. 安全检查报告（SECURITY_REVIEW）

```json
{
  "checklist": [
    {"item": "SQL 注入检查", "status": "pass|fail|warning", "note": ""},
    {"item": "XSS 检查", "status": "pass|fail|warning", "note": ""},
    {"item": "权限检查", "status": "pass|fail|warning", "note": ""}
  ],
  "vulnerabilities": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "summary": ""
}
```

### 3. 测试报告（TEST_REPORT）

```json
{
  "testCases": {
    "total": 50,
    "passed": 48,
    "failed": 2,
    "skipped": 0
  },
  "bugs": [
    {"id": "BUG-001", "severity": "high", "description": "...", "fixed": false}
  ],
  "coverage": {
    "lines": "85%",
    "branches": "80%",
    "functions": "90%"
  },
  "summary": ""
}
```

### 4. CTO 验收报告（CTO_REVIEW）

```json
{
  "codeReview": "通过/有风险",
  "functionalityCheck": "符合需求/有偏差",
  "documentation": "完整/缺失",
  "deploymentRisk": "低/中/高",
  "summary": "",
  "decision": "approved|changes_requested|rejected"
}
```

### 5. 发布确认报告（DEPLOY_CONFIRM）

```json
{
  "deploymentChecklist": [
    {"item": "生产环境备份", "status": "pass|fail", "note": ""},
    {"item": "服务健康检查", "status": "pass|fail", "note": ""},
    {"item": "回滚方案准备", "status": "pass|fail", "note": ""}
  ],
  "deployedAt": "2026-05-10T16:00:00Z",
  "rollbackPlan": "...",
  "summary": ""
}
```

## 前端设计

### 需求详情页增加"验收报告"Tab

**路由**：`/requirements/:id?tab=reports`

**UI 结构**：
```
┌─────────────────────────────────────────┐
│ 需求详情                                  │
├─────────────────────────────────────────┤
│ [基本信息] [任务列表] [修订历史] [验收报告] │  ← Tab 切换
├─────────────────────────────────────────┤
│                                          │
│  📋 验收报告时间线                        │
│                                          │
│  ┌─────────────────────────────────┐   │
│  │ ✅ 开发自检报告                  │   │
│  │    提交者: agent-dev-engineer    │   │
│  │    状态: 已通过                  │   │
│  │    时间: 2026-05-10 15:30       │   │
│  │    [查看详情]                    │   │
│  └─────────────────────────────────┘   │
│           ↓                              │
│  ┌─────────────────────────────────┐   │
│  │ ✅ 安全检查报告                  │   │
│  │    提交者: security-agent        │   │
│  │    状态: 已通过                  │   │
│  │    时间: 2026-05-10 15:45       │   │
│  │    [查看详情]                    │   │
│  └─────────────────────────────────┘   │
│           ↓                              │
│  ...                                     │
│                                          │
│  [+ 提交新报告]（仅 CTO 和当前阶段负责人） │
└─────────────────────────────────────────┘
```

### 报告详情 Modal

点击"查看详情"弹出 Modal，展示完整报告内容。

## 任务分配

| 任务 | 负责人 | 预计工时 |
|------|--------|----------|
| 后端：数据库模型 + API 开发 | 后端开发工程师（agent-dev-engineer） | 2-3 小时 |
| 前端：需求详情页报告时间线 | Web 前端开发工程师（devtools-agent） | 2-3 小时 |
| 测试：编写测试用例 | 测试工程师（test-engineer） | 1-2 小时 |
| 验收：测试流程走一遍 | CTO（我） | 1 小时 |

## 技术要点

1. **JSON 存储**：PostgreSQL 的 JSONB 类型，支持高效查询
2. **权限控制**：
   - 提交报告：需要认证
   - 审核报告：仅 CTO（admin 角色）
   - 删除报告：仅提交者本人或 CTO
3. **状态流转**：pending → approved/rejected/changes_requested
4. **级联删除**：需求被删除时，关联的报告也要删除

## 依赖

- Prisma ORM：已有，需升级 schema
- JWT 认证：已有，复用现有中间件
- React Ant Design：已有，使用 Timeline 组件

## 发布计划

1. **Phase 1**（后端优先）：数据库 + API
2. **Phase 2**（前端跟进）：UI 展示
3. **Phase 3**（测试验证）：test-engineer 验证
4. **Phase 4**（CTO 验收）：走完整流程

---

**文档创建时间**：2026-05-10 16:00
**创建人**：CTO Agent
