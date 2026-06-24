# ADC 平台架构审查报告

> 审查角色：系统架构审查员
> 审查时间：2026-06-13
> 审查范围：Agent Dev Center 后端（`backend/src/`）、Prisma Schema、工作流系统、权限模型、客户端脚本、CTO 工作流 Skill

---

## 摘要

ADC 平台经过近两个月的快速迭代，从 MVP 成长为一个覆盖需求管理、工作流引擎、Agent 调度、报告审批的综合性平台。快速迭代带来了功能性，也留下了**角色系统四体困境、工作流引擎过拟合、权限判断分岔**三类架构债务。

本文档按严重程度排列问题，每项标注 **必须改 / 建议改 / 先扛着**。

---

## 一、角色系统：四套体系并行，没有权威来源

### 问题陈述

当前平台同时运行 **四套角色体系**，彼此之间靠手工映射表转换。任何新增角色逻辑需要同步修改多个文件，极易产生遗漏。

#### 体系 1：`UserRole`（Prisma 原生 enum）

```prisma
enum UserRole {
  admin       // 管理员
  requester   // 需求提出者
  developer   // 开发者(通用)
  agent       // Agent
  cto_agent   // CTO Agent
}
```

位于 `prisma/schema.prisma`。这是 Prisma 原生 enum，存储在 `users.role` 字段。

#### 体系 2：`InternalRole`（Prisma 原生 enum）

```prisma
enum InternalRole {
  cto | pm | developer | backend_developer | frontend_developer
  | mobile_developer | miniapp_developer | game_developer
  | tester | security | ops | qa
}
```

位于 `prisma/schema.prisma`，存储在 `users.internal_role` 字段。共 12 个取值。

#### 体系 3：Platform Roles（运行时解析字符串）

```typescript
// src/lib/platform-roles.ts
// 格式: "{platform}:{role}"，如 adc:admin, adc:developer, adc:tester
// 存储在 users.roles (String[])
```

由 `legacyToPlatformRole()`、`getPlatformRole()`、`hasPlatformRole()`、`isPlatformAdmin()` 四个入口提供查询。维护了三张映射表：

```typescript
// InternalRole → Platform Role
LEGACY_INTERNAL_TO_ADC: { cto: 'adc:admin', developer: 'adc:developer', ... }

// UserRole → Platform Role
LEGACY_USER_ROLE_TO_ADC: { admin: 'adc:admin', developer: 'adc:developer', ... }

// Platform Role → (UserRole, InternalRole) 反向映射
ADC_TO_LEGACY: { 'adc:admin': { role: 'admin', internalRole: 'cto' }, ... }
```

#### 体系 4：`mapUserRole()` 硬编码映射

```typescript
// src/routes/requirements/workflow-helpers.ts
const mapping: Record<string, string[]> = {
  cto: ['cto', 'admin'],
  backend_developer: ['backend_developer'],
  frontend_developer: ['frontend_developer'],
  // ... 每个 internalRole → 可匹配的 workflow step role
};
```

直接查询 `req.user.internalRole`，绕过 platform-roles.ts 体系。

#### 体系 5（额外）：`REPORT_ROLE_MAP` + `WORKFLOW_STEP_PLATFORM_ROLES`

```typescript
// src/routes/reports.ts
const REPORT_ROLE_MAP: Record<string, { mode: 'assignee'|'role'|'any'; platformRoles?: string[] }> = {
  DEV_SELF_CHECK: { mode: 'assignee' },
  TEST_REPORT: { mode: 'role', platformRoles: ['adc:tester'] },
  // ...
};

const WORKFLOW_STEP_PLATFORM_ROLES: Record<string, string[]> = {
  cto: ['adc:admin'],
  developer: ['adc:developer'],
  tester: ['adc:tester'],
  // ...
};
```

又一独立于 `platform-roles.ts` 的映射。

### 影响分析

**这四个体系在 6 个文件中以不同的方式被引用**：

| 文件 | 使用的角色体系 | 与其他体系的关系 |
|------|---------------|-----------------|
| `permission-guard.ts` | 只用 `isPlatformAdmin()`（体系3） | 正确但狭窄 |
| `workflow-advance.ts` | 用 `mapUserRole(internalRole, stepRole)`（体系4） | 绕过了 platform roles |
| `workflow-helpers.ts` | `mapUserRole()` 硬编码（体系4） | 映射不包含体系3 |
| `reports.ts` | 自建 `REPORT_ROLE_MAP` + `WORKFLOW_STEP_PLATFORM_ROLES`（体系5） | 重复体系3 |
| `utils.ts`（core-crud） | 混合查 `internalRole` 和 `role`（体系1+2） | 三者不同路径 |
| `assignee-resolver.ts` | 查 `users.role`（体系1） | 与工作流 role 不连通 |

**典型后果**：

一个用户如果 `{ role: "developer", internalRole: "backend_developer", roles: ["adc:developer"] }`：

- `permission-guard.ts` → `hasPlatformRole()` → 匹配 `adc:developer` ✅
- `workflow-advance.ts` → `mapUserRole("backend_developer", "backend_developer")` → 匹配 ✅
- `reports.ts` → `WORKFLOW_STEP_PLATFORM_ROLES["developer"]` → 但它的 internalRole 是 `backend_developer`，不走体系1的 `role: "developer"` → 可能不匹配 ❌
- `utils.ts` 的 `canReadRequirement` → 检查 `user.internalRole === 'developer'` → 实际值是 `'backend_developer'` → 不匹配，走默认按 assignee 判断，但 `roleAwareRequirementWhere` 的 `DEVELOPER_INTERNAL_ROLES` Set 包含 `'backend_developer'` → 结果返回值不同 ⚠️

**四个角色体系的维护成本**：新增一个角色（如 `data-engineer`）需要：
1. 在 InternalRole enum 加值
2. 在 LEGACY_INTERNAL_TO_ADC 加映射
3. 在 LEGACY_USER_ROLE_TO_ADC 考虑是否加
4. 在 ADC_TO_LEGACY 加反向映射
5. 在 mapUserRole() 加映射
6. 在 WORKFLOW_STEP_PLATFORM_ROLES 加映射
7. 在 roleAwareRequirementWhere() 的 DEVELOPER_INTERNAL_ROLES Set 加
8. 在 workflow-templates.ts 加新模板
9. 更新 role-boundaries.md 文档

9 处修改，任何一个遗漏都会导致该角色在某些路径下"隐形"。

### 根因分析

```
历史演进路径：
第1层：UserRole（MVP 初始，只有 admin/requester/developer）
第2层：InternalRole（需要区分开发子类型：后端、前端、移动端...）
第3层：Platform Roles（需要支持多平台角色隔离，如 adc: vs svc:）
第4层：mapUserRole + REPORT_ROLE_MAP（各模块发现前3层不够用，自建映射）
```

每层都是对上一层"不够用"的补充，但**没有一层被废弃**，最终四层共存。

### 建议

🚨 **必须改**：砍掉 InternalRole 和 UserRole 这两个 enum，只保留 `roles: String[]` 作为权威来源。

具体方案：

1. **数据迁移**：将 `users.internal_role` 和 `users.role` 合并写入 `users.roles`
   - `internalRole: "backend_developer"` + `role: "developer"` → `roles: ["adc:developer", "adc:team:backend"]`
   - 所有角色以 `{platform}:{role}[:{subtype}]` 格式表达

2. **删除 InternalRole enum、UserRole 的冗余值**：Prisma migrate 移除字段

3. **统一查询入口**：所有角色判断走 `hasPlatformRole(user, "adc:developer")`，删除 `mapUserRole()`、`REPORT_ROLE_MAP`、`WORKFLOW_STEP_PLATFORM_ROLES`

4. **删除 `platform-roles.ts` 的三张映射表**：不再需要映射，因为 `roles` 已经是权威来源

---

## 二、工作流引擎：状态机复杂度过高，逻辑散落

### 问题 1：工作流定义三处不同步

工作流模板保存在三个地方：

| 位置 | 内容 | 与实际代码的关系 |
|------|------|-----------------|
| `backend/src/lib/workflow-templates.ts` | 代码中硬编码的 8 个模板定义 | **代码真实来源** |
| `skils/adc-workflow/SKILL.md` | 文档化的流程说明（v4） | 描述落后于代码 |
| `docs/workflow-rules.md` | 工作流规则文档 | 描述落后于代码 |

`SKILL.md` v4 宣称的流程是 13 步：
```
pending → pm_review → dev_self_check → qa_review → test_env_deploy
→ testing → qa_review_test → security_review → qa_review_security
→ cto_review → merge_to_main → deploying → qa_review_deploy → done
```

但代码中 `STANDARD_DEV_MIDDLE` 的实际流程是 11 步（少了 `pending` 和 `merge_to_main` 后的 `qa_review_deploy` — 仔细看其实都有，但命名不一致）。

此外，`docs/workflow-rules.md` 描述的 `standard-dev` 模板只有 9 步（没有 `qa_review_test`、`qa_review_security`、`qa_review_deploy`、`merge_to_main`，且 `dev_self_check` 的 `autoAdvance=true`）。

**结论**：文档误导性严重，新成员按文档开发一定会出错。

### 问题 2：advance handler 单一职责过载

`workflow-advance.ts` 的 POST handler 承担了至少 6 个职责：

1. 参数校验
2. 角色校验（查询数据库 + IR 映射）
3. 报告校验（检查 requiredReports 状态）
4. 步骤跳过逻辑（autoAdvance + 安全步骤跳过 + 非 SECURITY 类型跳过）
5. WIP 上限检查
6. 测试环境互斥锁（加锁 / 解锁 / 自动推进队列）

建议拆分为：

```
WorkflowOperation (入口路由)
→ StepResolver (确定目标步骤，处理跳过逻辑)
→ StepValidator (角色校验 + 报告校验 + WIP检查)
→ LockManager (测试环境锁)
→ TransitionExecutor (执行状态变更 + 日志)
→ LockRelease (异步解锁 + 队列推进)
```

### 问题 3：QA 作为全链路门禁导致瓶颈

当前设计 QA 需要审查 4 个环节：

| 步骤 | QA 审查内容 |
|------|------------|
| qa_review | 开发自检报告 |
| qa_review_test | 测试报告 |
| qa_review_security | 安全报告 |
| qa_review_deploy | 部署确认 |

这是一种**串行门禁模型**：QA 不是放在流水线末尾总检，而是插在每两个环节之间。好处是质量高，坏处是 QA 一旦忙不过来，整条流水线停顿。

考虑是否改为：
- **抽样审查**：低优先级（P2/P3）仅抽样审查
- **并行审查**：`qa_review_test` 和 `qa_review_security` 可以并行（非 SECURITY 类型只有一个）
- **简化审查点**：只在 cto_review 前做一次 QA 汇总审查，不分散到 4 个点

### 问题 4：步骤命名模式混乱

qa 相关步骤有 4 个变体：

```
qa_review        — QA 审查开发自检
qa_review_test   — QA 审查测试报告
qa_review_security — QA 审查安全报告
qa_review_deploy — QA 验证部署
```

deploy 相关步骤有 2 个：

```
test_env_deploy  — 部署到测试环境
deploying        — 部署到生产环境
```

这种命名模式的问题在于**步骤名同时编码了角色和阶段**，导致新增一个审查类型就需要添加一个新步骤。如果改为 `{phase}:{role}` 结构：

```
review:qa          — QA 审查（当前阶段的报告）
deploy:test        — 部署测试环境
deploy:production  — 部署生产环境
```

这样新增角色不需要新增步骤名，只需在工作流模板中配置步骤的角色。

### 问题 5：security_review 依赖测试完成，形成串行瓶颈

在标准工作流中：

```
testing → qa_review_test → security_review → qa_review_security → cto_review
                               ↑
              security_review.requiredReports = ['TEST_REPORT']
```

security 需要等待 TEST_REPORT 被 QA approved 后才能开始。但安全审查完全可以与测试并行进行——安全审代码，测试测功能，互不依赖。

建议将安全审查移到 parallel track：

```
dev_self_check → QA审查 → 部署测试环境 ─┬─→ testing → QA审测试 → CTO
                                        └─→ security → QA审安全 → CTO
```

### 问题 6：autoAdvance 与 requiredReports 的交互缺陷

`docs/workflow-rules.md` 已经记录了此问题（P2）：

> autoAdvance + requiredReports 交互复杂。当前 pm_review → dev_self_check (autoAdvance) → qa_review (required=['DEV_SELF_CHECK']) 的交互：advance pm_review → 目标 dev_self_check (autoAdvance) → 再跳到 qa_review → 检查 qa_review.requiredReports → DEV_SELF_CHECK 还没提交 → 失败

这个 bug 在 2026-06-06 发现后一直通过 PATCH API 绕过。

### 建议

🚨 **必须改**：工作流模板定义放在唯一位置（代码或数据库），SKILL.md 和 workflow-rules.md 只做索引引用

⚠️ **建议改**：将测试环境锁逻辑从 advance handler 抽离为 LockManager

🟡 **先扛着**：步骤命名优化、并行安全审查、缩减QA审查点。这些改动面大，需要业务方共识

---

## 三、过滤与查询：缺乏统一抽象，权限与查询耦合

### 问题 1：`canReadRequirement` 与 `roleAwareRequirementWhere` 不同步

`utils.ts` 中两个函数分别定义了"谁能看到什么需求"：

**`canReadRequirement()`（逐条检查）**：

```typescript
function canReadRequirement(user, requirement) {
  if (admin/cto_agent) return true;  // ✅
  if (qa/tester/security/ops) return true;  // ✅
  if (developer) return assignee match;  // ⚠️ 只检查 developer，不含 backend_developer
  if (requester) return requester match;
  return assignee match;  // 兜底
}
```

**`roleAwareRequirementWhere()`（批量过滤）**：

```typescript
function roleAwareRequirementWhere(user) {
  if (admin/cto_agent/pm/cto) return {};  // ✅
  if (qa/tester/security/ops) return {};  // ✅
  DEVELOPER_INTERNAL_ROLES = new Set(['developer', 'backend_developer', 'frontend_developer', ...]);
  if (DEVELOPER_INTERNAL_ROLES.has(internalRole)) return assignee match;  // ✅ 包括了所有子类型
  if (requester) return requester match;
  return requester match;  // 兜底
}
```

**差异**：
- `canReadRequirement` 的 developer 路径只检查 `internalRole === 'developer'`，不含子类型
- `roleAwareRequirementWhere` 用 Set 包含了所有子类型
- `canReadRequirement` 的特殊角色（QA/tester/security/ops）在 detail 页面能看到所有，但列表 API 用 `roleAwareRequirementWhere` 构建 where 条件 → 列表能看到 detail 但可能翻页到下一个用户看不到的条目

两个函数通过不同的路径判断同一权限，逻辑不一致，**这是一个 bug**。

### 问题 2：列表 API 缺乏活跃需求过滤

`GET /api/requirements` 没有 `activeOnly` 参数。所有客户端都要自己过滤 done/rejected/abandoned 的需求。

`adc.py`：
```python
active = [r for r in reqs if r.get("currentStep") not in ("done", "rejected", None)]
```

`cto-patrol` 脚本也各写各的过滤逻辑。如果后端统一加 `?activeOnly=true` 参数，可以减少大量重复代码和传输带宽。

### 问题 3：`RequirementReport` 的唯一约束异常处理不当

```prisma
@@unique([requirementId, reportType, workflowStep])
```

唯一约束阻止了同一需求同一步骤提交两份同类型报告。但 `reports.ts` 提交代码中没有预先检查此约束：

```typescript
const report = await prisma.requirementReport.create({ data: { ... } });
```

如果用户重复提交，Prisma 会抛出 `P2002` 唯一约束冲突。错误信息包含 Prisma 内部详情（服务器路径、字段组合等），既不友好也不安全。

### 建议

⚠️ **必须改**：修复 `canReadRequirement` 和 `roleAwareRequirementWhere` 的逻辑不一致（Developer 子类型检查）

🟡 **先扛着**：给 GET API 加 `activeOnly=true` 参数

🟡 **先扛着**：在 `reports.ts` 的 submit 钩子中显式检查重复报告，返回友好错误信息

---

## 四、其他架构问题

### 4.1 hotfix 工作流的安全隐患

hotfix 流程：
```
dev_self_check → deploying → qa_review_deploy → done
```

跳过 PM 审批、测试、安全审查、CTO 验收。从写代码到生产的路径只有：
1. 开发者自己说"我检查过了"（DEV_SELF_CHECK）
2. 运维部署
3. QA 确认部署没问题

没有对代码变更本身的任何外部审查。如果 hotfix 被误用（如把普通功能需求标为 hotfix 来 bypass 流程），则整个质量保障体系被绕过。

### 4.2 测试环境锁（mutex）的性能瓶颈

测试环境锁确保同时只有一个需求可以部署到测试环境。当需求队列较长时（当前 `queueLength: 35`），后面需求等待时间随队列线性增长。

当前设计是**全局单锁**，没有分环境/分服务部署的能力。

### 4.3 ``reports.ts` 的 QA bypass 机制

```typescript
const QA_BYPASS_MIN_WAIT_MS = 2 * 60 * 60 * 1000; // 2 小时
```

当报告等待超过 2 小时，CTO 可以绕过 QA 直接审批。这是一个合理的"逃生舱"，但：
- 2 小时阈值是写死的常量，不能分优先级调整
- 没有通知机制，CTO 需要手动巡检才发现有卡住的报告
- 符合条件的 await 报告应该在 CTO 登录时主动提示，而不是被动等待巡检

---

## 五、架构健康度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 职责分离 | ⭐⭐⭐ | 路由/中间件/工具函数分离清晰，但 advance handler 过载 |
| 可测试性 | ⭐⭐⭐ | 有少量测试文件，但核心逻辑（advance/报告审批）缺少单元测试 |
| 可扩展性 | ⭐⭐ | 新增角色需要改 9 个地方，新增步骤需要同步3份文档 |
| 安全性 | ⭐⭐⭐ | JWT + 角色校验 + SSO 三层，但角色校验自身混乱削弱了有效性 |
| 文档同步 | ⭐ | SKILL.md、workflow-rules.md、代码三者严重不同步 |
| 抽象一致性 | ⭐ | 四套角色体系 + 多份权限映射 + 两份过滤逻辑 |

---

## 六、优先级行动清单

### P0 — 必须改（有直接 bug 或安全隐患）

| 序号 | 问题 | 涉及文件 | 修复方案 |
|------|------|---------|---------|
| 1 | `canReadRequirement` 不含 developer 子类型 | `utils.ts:34-38` | 加入 DEVELOPER_INTERNAL_ROLES Set 检查 |
| 2 | `roleAwareRequirementWhere` 的 PM 检查通过 role 但 PM 可能没有 role=pm | `utils.ts:80` | 增加 internalRole 检查 |

### P1 — 必须改（架构债务，不改后续成本指数增长）

| 序号 | 问题 | 涉及文件 | 修复方案 |
|------|------|---------|---------|
| 3 | 四套角色体系并行 | 全局 | 合为 roles[]，删 InternalRole/UserRole |
| 4 | 工作流定义三处不同步 | 全局 | 集中到 workflow-templates.ts，文档只引用 |
| 5 | advance handler 过载 | `workflow-advance.ts` | 拆为 StepResolver + StepValidator + LockManager |

### P2 — 建议改

| 序号 | 问题 | 建议方案 |
|------|------|---------|
| 6 | 步骤命名模式混乱 | 引入 `{phase}:{role}` 命名 |
| 7 | QA 全链路门禁瓶颈 | 合并 qa_review* 步骤，只在 cto_review 前汇总审查 |
| 8 | security_review 串行 | 改为 parallel track |
| 9 | hotfix 绕过全量审查 | 限制 hotfix 使用条件（如必须 CTO 授权） |

### P3 — 先扛着但记着

| 序号 | 问题 | 备注 |
|------|------|------|
| 10 | 测试环境单锁瓶颈 | 等队列更长时改为分环境锁 |
| 11 | QA bypass 无通知 | 等 CTO 巡检自动化成熟后加入主动通知 |
| 12 | unique 约束异常不友好 | 低优先级 |

---

## 附录：关键文件索引

| 文件 | 作用 | 行数 |
|------|------|------|
| `backend/src/lib/platform-roles.ts` | 角色映射引擎 | ~120 |
| `backend/src/lib/workflow-templates.ts` | 工作流模板定义 | ~200 |
| `backend/src/middleware/permission-guard.ts` | 权限守卫中间件 | ~60 |
| `backend/src/routes/reports.ts` | 报告提交/审批 | ~650 |
| `backend/src/routes/requirements/workflow-advance.ts` | 工作流推进 | ~250 |
| `backend/src/routes/requirements/workflow-helpers.ts` | 工作流工具函数 | ~140 |
| `backend/src/routes/requirements/utils.ts` | 需求权限工具 | ~120 |
| `backend/prisma/schema.prisma` | 数据模型 | ~900 |
| `skills/adc-workflow/scripts/adc.py` | ADC CLI 工具 | ~260 |
| `docs/workflow-rules.md` | 工作流规则文档 | ~240 |
| `docs/role-boundaries.md` | 角色边界定义 | ~150 |
| `skils/adc-workflow/SKILL.md` | 工作流 Skill 说明 | ~120 |
