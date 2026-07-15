# ADC Workflow 与业务对象所有权调查

## 0. 阶段元数据

| 字段 | 值 |
|---|---|
| 调查编号 | `ADC_WORKFLOW_AND_BUSINESS_OWNERSHIP_INVESTIGATION` |
| 状态 | `COMPLETE`（只读调查完成，尚未实施迁移） |
| 日期 | 2026-07-15（Asia/Shanghai） |
| ADC 基线 | `develop@343afa49475e6504b61e0b6510bfae372c65027f` |
| 调查分支 | `codex/adc-workflow-ownership-investigation` |
| 权威代码路径 | `backend/prisma/schema.prisma`、`backend/src/`、`backend/prisma/migrations/` |
| 非权威路径 | 根目录 `src/`、`prisma/`（见 `backend/README.md:1-21`） |
| 工作区保护 | 预先存在 `?? .zcode/`，调查未读取、修改或提交 |
| 当前总阶段 | Stage 0 `LOCAL_IMPORT_READY` 已完成；Stage 1A `SVC_WORKFLOW_API_SMOKE_READY` 未完成 |
| 下一实施项 | `SVC_WORKFLOW_INTERNAL_API_V0`，不得据本报告宣称 ADC 已完成集成 |
| 独立审计 | Blocker 0；High 2（数据库真源身份、Report/Review 映射） |

本报告只冻结 ADC 侧对象、表、文件和写路径的目标所有权。对 canonical 中实际存在的对象，分类必须唯一；canonical 完全不存在的 Space/Folder 明确记为 `N/A`，不是待猜测的 legacy 实体：

- `ABSORB_INTO_WORKFLOW`
- `CONVERT_TO_WORKFLOW_ADAPTER`
- `CONVERT_TO_WORKFLOW_PROJECTION`
- `RETAIN_AS_ADC_BUSINESS`
- `RETAIN_AS_EXTERNAL_ARTIFACT_SERVICE`
- `DELETE_AFTER_CUTOVER`
- `LEGACY_UNKNOWN`

## 1. 总结性结论

`Requirement` 不应整体吸收到 `svc-workflow`。实际代码证明它能在没有 workflow 时创建，并拥有 Project、依赖、Revision、Task、Comment、Postmortem 和 ServiceLink 等独立业务关系；它应保留为瘦的 ADC 需求对象。

但下列字段不是 Requirement 业务权威，应迁入 workflow 或降级为投影：

```text
workflowId / workflowSnapshot / currentStep / stateVersion / status
assignee / assigneeId（当前节点负责人及其兼容字符串语义）
pmApprovedAt / pmApprovedBy / rejectReason
gitHash / branch / repoPath / deployVersion（执行或交付上下文）
```

`WorkflowTemplate`、实例状态机、Report/Review/Approval、Transition、Submission 和流程审计不得在 ADC 保留第二套权威实现。

## 2. 对象所有权表

| 对象 | 唯一分类 | 生命周期、无实例存在、复用、ACL、高频查询和重复投影结论 |
|---|---|---|
| Requirement | `RETAIN_AS_ADC_BUSINESS` | 可无 Workflow 创建（`core-create.ts:83-97`）；有 Project、依赖图、Revision、Task 等独立生命周期和复用关系。Requester/平台角色形成业务 ACL。标题、优先级、类型、标签、项目、依赖、日期和搜索字段需高频查询。仅保留业务字段。 |
| WorkflowTemplate | `ABSORB_INTO_WORKFLOW` | 可无实例存在并被多个 Requirement 复用，有 admin ACL；这些正是 Definition/DefinitionVersion 权责。ADC 的 steps/role map/WIP 是重复权威。 |
| WorkflowInstance | `ABSORB_INTO_WORKFLOW` | ADC 无独立 model；由 Requirement 上多个字段隐式模拟且最多一份。实例生命周期、状态版本和终态全部归 svc-workflow。 |
| currentStep | `CONVERT_TO_WORKFLOW_PROJECTION` | 无独立生命周期；被 list/kanban/mine/WIP/ACL 高频读取且有索引，但等价于 current NodeVisit。只允许可重建只读投影。 |
| assigneeId | `CONVERT_TO_WORKFLOW_PROJECTION` | 当前混合了创建时人工分派、当前节点 assignee 和 ACL。NodeVisit assignee 为权威；若需要业务 owner，必须另建语义明确的 `businessOwnerId`。 |
| Report | `ABSORB_INTO_WORKFLOW` | `RequirementReport` 只绑定 Requirement/reportType/workflowStep，无跨实例复用；提交与审核 ACL 来自节点角色/assignee。每次提交/重提、QA/CTO review 必须拆成不同的不可变 Submission/Event，不能一旧行映射一个 Submission。 |
| Evidence | `RETAIN_AS_EXTERNAL_ARTIFACT_SERVICE` | ADC 无 Evidence model；只有小型 Ledger JSON 和本地文件目录。文件 bytes、预览、归档和扫描外置；提交事实及 URI/digest 绑定仍由 WorkflowSubmission 权威。 |
| Review | `ABSORB_INTO_WORKFLOW` | 无独立 model；表现为 Report 状态、QA/PM 字段并直接驱动 currentStep。Approve/Reject/Rework 映射 ADVANCE/RETURN，表单映射 Submission。 |
| Audit（平台） | `RETAIN_AS_ADC_BUSINESS` | `AuditLog` 记录用户、密码、平台配置等非实例治理行为，可无 Workflow 存在且有平台管理员 ACL。流程审计不得混入。 |
| DeliveryResult | `ABSORB_INTO_WORKFLOW` | ADC 无此 model；当前语义散在终态、部署字段和报告中。映射最终 Context/Submission/Event。`MarketplaceDeliverable` 是另一业务对象。 |
| Task | `RETAIN_AS_ADC_BUSINESS` | 一 Requirement 可有多个 Task，拥有独立 CRUD、状态、agentType、归档和 ACL，不是一对一 NodeVisit 包装；必须删除其直接 workflow 回写。 |
| ExecutionLease | `DELETE_AFTER_CUTOVER` | 只有 schema/migration，无 canonical runtime Service/Route/Job 使用，本地配置 DB 为 0 行；还硬绑 Requirement/workflowStep/stateVersion，lease owner 随表删除。 |
| Space | `N/A（canonical 不存在）` | ADC 无 model、table、route 或 ACL，因此没有实体或数据需要迁移；不得凭名称把 Project 当 Space。 |
| Folder | `N/A（canonical 不存在）` | ADC 无 model、table、route 或 ACL，因此没有实体或数据需要迁移；不得把 Folder 设计成 Domain 权限边界。 |
| Role | `CONVERT_TO_WORKFLOW_ADAPTER` | User 的 role/internalRole/roles/okrRole/permissions 服务整个 ADC，可无 Workflow 且被多业务复用；工作流侧通过稳定 Principal/DomainRoleBinding 映射消费。 |
| Domain | `ABSORB_INTO_WORKFLOW` | ADC 无 Domain model/ACL，仅有未调用的 `DOMAIN_CHANGED/DOMAIN_MOVE` 常量。Domain 和 DomainRoleBinding 由 svc-workflow 权威。 |
| Owner | `RETAIN_AS_ADC_BUSINESS` | 无统一 Owner model；Project、MarketplaceAgent、Service、Identity 的 owner 分别保留为各自业务所有权，不能合成一个 Owner。Requirement 的 assignee 字符串/ID 均剥离，ExecutionLease owner 随表删除。 |
| RequirementEventLedger | `CONVERT_TO_WORKFLOW_PROJECTION` | 混合业务和流程事件，并被 timeline/audit-summary/root-cause 消费。流程事件来自 svc，ADC 业务事件另源合成，只保留可重建投影。 |
| ApprovalLedger | `ABSORB_INTO_WORKFLOW` | 无表；事实散在 pmApproved 字段、Report 状态和 Ledger。迁入 Submission + Transition + WorkflowEvent。 |
| Transition | `ABSORB_INTO_WORKFLOW` | `WorkflowTransition` 是纯流程事实，无独立生命周期，完整重复 WorkflowTransition/Event。 |
| Submission | `ABSORB_INTO_WORKFLOW` | ADC 无 model；`RequirementReport` 是可变兼容替身。不可变性、NodeVisit/ContextRevision 绑定和唯一性由 svc-workflow 负责。 |
| Agent Tool | `CONVERT_TO_WORKFLOW_ADAPTER` | Agent-facing create/patch/mine/task API 保留产品形态，所有流程命令通过 ADC client + outbox 调 svc-workflow。 |
| Scheduler | `CONVERT_TO_WORKFLOW_ADAPTER` | 唯一实际后台 workflow 写是 `autoAdvanceTestEnvQueue`；改为 system principal 发幂等 ADVANCE outbox。 |
| Background Job | `CONVERT_TO_WORKFLOW_PROJECTION` | Root-cause 聚合只消费事件；切换为消费 WorkflowEvent/ADC business event projection，不拥有流程状态。 |

## 3. Prisma 表分类

| Model / table | 唯一分类 | 目标处置 |
|---|---|---|
| `Requirement` / `requirements` | `RETAIN_AS_ADC_BUSINESS` | 保留瘦业务字段；删除或停止写入 workflow/approval/delivery 字段。 |
| `RequirementRevision` | `RETAIN_AS_ADC_BUSINESS` | 保留内容版本；移除僵尸流程 status 语义。 |
| `Project` | `RETAIN_AS_ADC_BUSINESS` | 保留；如映射 Domain，必须用稳定 ID mapping。 |
| `Task` | `RETAIN_AS_ADC_BUSINESS` | 保留执行/拆解生命周期；去掉 currentStep/assignee 副作用。 |
| `WorkflowTemplate` | `ABSORB_INTO_WORKFLOW` | 导入 DefinitionVersion 后删除 ADC 表。 |
| `RequirementReport` | `ABSORB_INTO_WORKFLOW` | 按提交、重提、QA review、CTO review 拆分 immutable Submission/Event 后删除；禁止一行一 Submission 的机械导入。 |
| `WorkflowTransition` | `ABSORB_INTO_WORKFLOW` | 导入或对账 WorkflowEvent 后删除。 |
| `RequirementAuditLog` | `DELETE_AFTER_CUTOVER` | 保留期导出完成后删除。 |
| `FeedbackEvent` | `DELETE_AFTER_CUTOVER` | RETURN/Event 覆盖后删除。 |
| `RequirementEventLedger` | `CONVERT_TO_WORKFLOW_PROJECTION` | 禁止继续作为流程写入真源；重建为合成投影。 |
| `AuditLog` | `RETAIN_AS_ADC_BUSINESS` | 仅保留平台治理审计。 |
| `ExecutionLease` | `DELETE_AFTER_CUTOVER` | 确认所有环境零行且无外部客户端后删除。 |
| `ExecutionLeaseEvent` | `DELETE_AFTER_CUTOVER` | 随 ExecutionLease 删除。 |
| `TestEnvLock` | `RETAIN_AS_ADC_BUSINESS` | 保留 ADC 执行资源锁；通过 adapter 响应节点变化。 |
| `MarketplaceDeliverable` | `RETAIN_AS_ADC_BUSINESS` | Marketplace task 产物，不等同 Requirement DeliveryResult。 |

## 4. 文件分类

| 文件或文件组 | 唯一分类 | 处置 |
|---|---|---|
| `core-create.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | 业务创建保留；事务提交 outbox 创建 WorkflowInstance。 |
| `core-put.ts`、`core-patch.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | 业务字段保留；Context patch/ADVANCE/RETURN 走 client；禁止直改 assignee/currentStep。 |
| `core-lifecycle.ts`、`review.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | archive/abandon/review 映射 TERMINATE/ADVANCE/RETURN。 |
| `workflow-assign.ts`、`workflow-advance.ts`、`workflow-reject.ts`、`workflow-lifecycle.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | 路由兼容可暂留，旧状态机实现删除。 |
| `workflow-helpers.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | 只保留 DTO/兼容映射；图、角色、报告门禁逻辑由 svc 权威。 |
| `reports.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | API 表面可留；内部改 Submission/Transition 命令。 |
| `workflow-templates-list.ts`、`workflow-step-config.ts`、`workflow-wip.ts` | `CONVERT_TO_WORKFLOW_ADAPTER` | DefinitionVersion 查询/发布/配置 client。 |
| `tasks.ts`、`decompose.ts` | `RETAIN_AS_ADC_BUSINESS` | 保留 Task；workflow 副作用拆成稳定幂等 outbox。 |
| `workflow-advance-helpers.ts` | `RETAIN_AS_ADC_BUSINESS` | 保留 TestEnvLock；`autoAdvanceTestEnvQueue` 的裸写改 adapter。 |
| `server.ts` | `RETAIN_AS_ADC_BUSINESS` | 保留启动；删除 `ensureWorkflowTemplates()` 启动覆盖。 |
| `marketplace-deliverables.ts` | `RETAIN_AS_ADC_BUSINESS` | 保留，与 workflow DeliveryResult 分界。 |
| `attachments.ts`、multer requirement upload 部分 | `RETAIN_AS_EXTERNAL_ARTIFACT_SERVICE` | 迁至 artifact service；ADC 留 client/UI。 |
| `transitions.ts`、`events.ts`、`audit-summary.ts` | `CONVERT_TO_WORKFLOW_PROJECTION` | 查询 svc timeline 或本地可重建投影。 |
| `admin-audit.ts` 流程部分、root-cause 聚合 | `CONVERT_TO_WORKFLOW_PROJECTION` | 改读 WorkflowEvent 投影；平台审计部分保留。 |
| `core-crud.ts` | `DELETE_AFTER_CUTOVER` | 当前已无 runtime 挂载，可在独立 cleanup 删除。 |
| `workflow-submit.ts` | `DELETE_AFTER_CUTOVER` | 当前未注册，属于 dead runtime。 |
| `workflow-assign-service.ts` | `DELETE_AFTER_CUTOVER` | 仅遗留测试引用，无 active route。 |
| `workflow-cas-helper.ts` | `DELETE_AFTER_CUTOVER` | 当前仍被 active routes 使用；必须等 adapter cutover，不能提前删。 |
| `lib/workflow-templates.ts` | `DELETE_AFTER_CUTOVER` | DefinitionVersion 导入并停止启动 upsert 后删除。 |
| `requirement-event-ledger-service.ts` | `DELETE_AFTER_CUTOVER` | 业务事件改 outbox、流程事件由 svc 产生后删除 writer。 |
| `feedback-events.ts` | `DELETE_AFTER_CUTOVER` | RETURN/Event 投影替代。 |
| workflow/assignee/template 修复脚本（约 1,084 LOC） | `DELETE_AFTER_CUTOVER` | cutover 后冻结执行、归档历史、删除旧修复入口。 |

## 5. 完整 workflow 写路径表

| 入口 | 当前写入/副作用 | 目标命令与所有权 |
|---|---|---|
| `POST /api/requirements` (`core-create`) | 创建 Requirement + Ledger；可写初始 assignee | ADC 保留业务创建；outbox `CreateWorkflowInstance`。 |
| `PUT /api/requirements/:id` (`core-put`) | 业务字段、assigneeId、Revision | 业务字段/Revision 留 ADC；Context patch 走 adapter；禁止直写节点 assignee。 |
| `PATCH /api/requirements/:id` (`core-patch`) | status/currentStep 合流、assignee、git/deploy、Ledger | Context patch + ADVANCE/RETURN adapter；投影异步更新。 |
| `POST /api/tasks` | 创建 Task 并回写 Requirement assignee | Task 留 ADC；去掉 Requirement 回写。 |
| `PATCH /api/tasks/:id` | Task status；in-progress/done 直接改 currentStep/assignee | Task status 留 ADC；全部完成时以稳定 key 发 ADVANCE outbox。 |
| `POST /:id/workflow/assign` | workflowId/snapshot/currentStep/assignee + Transition + Ledger | `CreateWorkflowInstance`；保存 requirement-instance mapping。 |
| `POST /:id/workflow/advance` | 门禁、角色、报告、WIP、锁、CAS、Transition、Ledger | 必要 ADC context/artifact 校验后，组合 Context/Submission + `ADVANCE`。 |
| `POST /:id/workflow/reject` | 解析目标步、assignee、CAS、Transition、Feedback、Ledger | `RETURN`；target transition 由定义决定。 |
| `POST /:id/workflow/abandon` | currentStep=abandoned、清 assignee、Transition、Ledger | `TERMINATE`。 |
| `POST /:id/workflow/to-draft` | abandoned 重新写 draft | 禁止复活同一终态实例；创建新实例或受控 admin repair。 |
| `POST /:id/abandon` / `reactivate` | 直接改 currentStep + Ledger | abandon=`TERMINATE`；reactivate=新实例或 admin repair。 |
| `POST /:id/lifecycle` / batch | archive + stateVersion + RequirementAuditLog + Ledger | `TERMINATE`/业务 archive adapter；批量逐实例幂等。 |
| `POST /:id/pm-approve` | pmApproved 字段或 currentStep=rejected | approve=`ADVANCE`；reject=`RETURN` 或明确 `TERMINATE`。 |
| `POST /:id/reports` | mutable upsert Report + Ledger | 每次提交/重提生成独立 immutable Report Submission；不得覆盖旧提交。 |
| `PATCH /:reportId/qa-review` | Report status/QA 字段；reject 自动回退 workflow | 独立 QA Review Submission 或 transition-bound submission，决定 `ADVANCE`/`RETURN`。 |
| `PATCH /:reportId/qa-review-findings` | 自动审批/驳回并可能回退 | findings/bypass 写入 Review Submission/Event；结果执行 `ADVANCE`/`RETURN`。 |
| `PATCH /:reportId` | CTO/general review；直接回退 currentStep | 独立 CTO/general Review Submission + `ADVANCE`/`RETURN`；self-review/bypass 由 policy/command guard。 |
| `DELETE /:reportId` | 归档后物理删除 pending/changes_requested Report | 不删除不可变 Submission；发 correction/revoke 事件。 |
| template activate | 全量停用后激活一个模板 + AuditLog | 发布/选择 DefinitionVersion；不得改历史版本。 |
| template step-mode / role-map / WIP | 原地修改 steps JSON | 创建新 DefinitionVersion；角色绑定走 DomainRoleBinding。 |
| `server.ts` 启动 | `ensureWorkflowTemplates()` 每次 upsert/覆盖 catalog | 删除启动写；Definition 发布必须显式、可审计。 |
| `autoAdvanceTestEnvQueue` | fire-and-forget 直接写 currentStep + TestEnvLock | TestEnvLock 留 ADC；system principal + idempotency key 发 ADVANCE outbox。 |
| workflow/assignee/template 修复脚本 | 绕过 API 直接修表 | shadow 前冻结清单；cutover 后禁用并删除。 |
| `core-crud.ts`（未挂载） | 重复 create/list/put/patch，可直写流程字段 | 无 runtime 迁移；删除 dead code。 |
| `workflow-submit.ts`（未注册） | 若被调用会直写 currentStep/assignee + Transition/Ledger | 无 runtime 迁移；删除 dead code。 |
| `workflow-assign-service.ts`（仅测试） | CAS 写 workflowId/snapshot/currentStep/assignee/stateVersion | 无 active route；测试迁移后删除。 |

除 `autoAdvanceTestEnvQueue` 外，未发现常驻后台 Job 直接写 workflow 状态；root-cause aggregator 是事件消费者，不是状态写者。

### 5.1 关键代码证据锚点

- canonical 路径：`backend/README.md:1-21`；route 挂载：`backend/src/routes/requirements/index.ts:37-71`。
- Requirement/关联模型/索引：`backend/prisma/schema.prisma:84-215`；无 workflow 创建：`core-create.ts:83-119`。
- Requirement 业务更新、依赖和 Revision：`core-put.ts:76-117`；ACL：`utils.ts:13-148`。
- WorkflowTemplate/Transition：`schema.prisma:516-549`；启动覆盖：`server.ts:11-16`、`lib/workflow-templates.ts:403-442`。
- assign 双写：`workflow-assign.ts:53-123`；advance CAS/Transition/Ledger：`workflow-advance.ts:267-295`。
- reject 写路径：`workflow-reject.ts:150-280`；CAS helper 当前 active：`workflow-cas-helper.ts:15-40`。
- Report mutable upsert：`reports.ts:208-300`；QA 回退：`reports.ts:393-546`；CTO/general 回退：`reports.ts:726-973`。
- Task 直写 workflow：`tasks.ts:132-217`；多 Task 拆解：`decompose.ts:67-119`。
- ExecutionLease 仅 schema/migration：`schema.prisma:793-843`、`migrations/20260619000001_add_execution_lease/migration.sql:1-70`。
- 实际执行资源锁和后台裸写：`workflow-advance-helpers.ts:85-222`。
- Ledger writer/consumer：`requirement-event-ledger-service.ts:66-143`、`events.ts:27-55`、`aggregate-root-cause-candidates.ts:43-162`。
- 平台审计：`admin-users.ts:105-143`；流程统计重复读取：`admin-audit.ts:18-208`。

## 6. 当前本地 DB 漂移（非生产）

以下仅是 `backend/.env` 当前指向的本地数据库快照，不代表生产：

- Requirements 131 条，`workflowId IS NULL` 为 131 条。
- `currentStep IS NULL` 96 条；其余为 `cto_review/dev_self_check/qa_pre_release` 各 10 条、`testing` 5 条。
- `workflow_snapshot` 非空 35 条。
- `assigneeId` 非空 0 条。
- `state_version` 非 0 为 131 条，min=1、max=21。
- `Requirement.status` 全部为 `pending`，证明它是僵尸重复列。
- RequirementReport 30 条且状态全为 pending；其中 20 条所属 Requirement 没有 Transition。
- WorkflowTransition 15 条；Task 0；ExecutionLease 0；TestEnvLock 0。
- schema 已声明 `RequirementEventLedger`，该本地 DB 尚未部署此表。

这些数据证明 `workflowId/snapshot/currentStep/stateVersion/status` 已互相漂移，不能继续作为共同权威。Legacy Initial Import 必须按行分类，不能仅用 `workflowId IS NULL` 判断“无流程”。

## 7. 独立数据库真源风险（High）

`backend/.env` 使用 host `localhost`，实际连接 `::1:5432` 上的 Homebrew PostgreSQL 16.14，数据库名为 `agent_dev_center`，即本报告统计的 131 条 Requirement。与此同时，Docker 声称 `agent-dev-center-postgres` 映射 `0.0.0.0/[::]:5432`，但容器默认 DB 是另一份 1 条 Requirement 的 baseline；容器内部名为 `agent_dev_center` 的 DB 又是 0 条/缺表。root `.env` 还指向不存在的 test 数据库。

因此仅凭 `localhost:5432` 或数据库名无法确定 ADC 真源；当前所有行数只能作为漂移旁证。独立审计将此项定级为 High，不是 Blocker，但在 Shadow/删表前必须清零。

进入 Shadow 前必须：

1. 冻结唯一 `DATABASE_URL`、数据库名、schema、环境标识和 owner；
2. 对 API、migration、脚本、测试、cron、备份逐项证明连接同一真源；
3. 记录只读 row counts/checksum，并让导入、shadow、rollback 使用同一已签名 manifest；
4. 未完成前，Stage 2 `SHADOW_READY` 保持条件性阻塞，不得开始对账或删表。

## 8. Report/Review 映射风险（High）

`RequirementReport` 的产品名称可以消失，但历史事实不能压扁：

1. 每次报告提交和重提都是独立 immutable Report Submission；
2. QA review 与 CTO/general review 是独立 Review Submission，或明确绑定 Transition 的 submission；
3. review 结果决定 `ADVANCE` 或 `RETURN`，不能只迁移最终 `status`；
4. findings、bypass、reviewComment、reviewer、reviewedAt 进入 Review Submission/Event；
5. `pending-review` 队列是 ADC projection，不是第二套审批状态机；
6. 删除旧报告映射 correction/revoke event，不物理删除 workflow 事实。

在 legacy report 展开算法、顺序和 digest 对账冻结前，不得删除 `RequirementReport`。

## 9. 测试与遗留债务

- backend typecheck：PASS。
- Vitest baseline：317 passed、27 skipped、15 failed，另有 1 failed suite。
- `kernel-snapshot-helpers.test.ts` 与当前 `workflow-helpers` API 不一致。
- `reports-self-approval.test.ts` 导入不存在的 `reports-approval.js`；仓库仅有 `reports-approval.ts.bak`。
- 这些失败集中在即将被替换的旧内核/报告审核路径；不能忽略，应在 adapter contract tests 建立后删除或重写。
- 当前失败不是本报告引入；本阶段不修代码。

## 10. 删除与保留 LOC 估算

LOC 基线：`backend/src/**/*.ts` 26,371，其中测试 7,755、runtime 18,616；frontend runtime 12,694；canonical Prisma schema 929 行。本估算不包含已废弃根 `src/`，也不删除历史 migrations。

- `workflow-*.ts` 共 2,366 LOC；扣除应保留并改造的 TestEnvLock 相关约 278 LOC，直接内核替换面约 2,088 LOC。
- 模板 catalog、Ledger writer、Review、Transition route 约 682 LOC。
- Reports 1,057 LOC 中约 800–950 LOC 会被 Submission/Transition 吸收。
- assignee resolver 与 internal-workflow 中约 250–330 LOC 的工作流判权可删。
- 审计/timeline/root-cause 改 projection 后预计净删或替换 500–800 LOC。
- Task workflow 副作用约 50–70 LOC，schema 重复模型/字段约 100–160 LOC。
- 综合：cutover 后可删除或整体替换 **4.4k–5.2k canonical TS LOC**。
- 调查范围内约 **2.0k–2.5k LOC** 的 Requirement/Project/Task/artifact/平台治理代码应保留，并新增约 0.6k–1.0k adapter/projection。

Runtime dead code 单列，不与上面重复计数：

```text
core-crud.ts                543 LOC
workflow-submit.ts          135 LOC
workflow-assign-service.ts  159 LOC
合计                        837 LOC
```

`workflow-cas-helper.ts` 41 LOC 当前仍被 active workflow routes 使用，只能 cutover 后删除，不属于当前 runtime dead 837 LOC。

旧 workflow/assignee/template 修复脚本约 1,084 LOC，分类为 `DELETE_AFTER_CUTOVER`；历史 migration 保留用于可追溯安装/升级。

## 11. 删除前置条件

1. 冻结 `requirementId ↔ workflowInstanceId`、User/Agent ↔ Principal、产品容器 ↔ Domain、旧模板 ↔ DefinitionVersion 的稳定映射，禁止名称匹配。
2. 每份 `workflowSnapshot` 生成精确 DefinitionVersion；不得用当前热模板覆盖历史实例。
3. 为所有漂移 Requirement 建立 legacy 分类、导入和 orphan policy，并保存可重复校验的 manifest。
4. 将每次 Report 提交/重提展开为独立 Report Submission，将 QA/CTO review 展开为独立 Review Submission/Event，保留 legacy id、顺序、content digest、提交者、workflowStep、review/bypass/findings 和 correction 链。
5. 导入/导出 WorkflowTransition、RequirementAuditLog、FeedbackEvent 和 Ledger；区分 WorkflowEvent 与 ADC business event。
6. currentStep/assignee/timeline/mine/kanban projection 支持全量 rebuild、增量 cursor、延迟告警；所有授权路径停止把投影当权威。
7. 建立 transactional outbox；Requirement/Task 本地事务与 workflow 命令之间有稳定 idempotency key、重试和补偿规则。
8. Task 完成路径不再直写 Requirement；TestEnvLock queue 以 system principal 发 ADVANCE。
9. 文件迁移 artifact service，建立 URI/digest/ACL/归档/扫描后再删除本地 uploads。
10. Definition、RoleBinding、Submission、Transition、Event 的 shadow 对账达到冻结阈值并通过 canary/rollback 演练。
11. 确认所有环境 ExecutionLease 行数为零且无外部客户端；确认旧表无写入、无 cron、无修复脚本后再 drop。
12. 先删调用和写入，再删投影/表/字段；不得删除历史 migration，不得把 rollback 建立在旧双写恢复上。

## 12. 下一阶段

调查完成后的执行顺序固定为：

1. 完成 `SVC_WORKFLOW_INTERNAL_API_V0`，达到 `SVC_WORKFLOW_API_SMOKE_READY`；
2. 冻结 ADC Client、错误映射、超时/重试/idempotency 和 transactional outbox contract；
3. 冻结身份与稳定映射，清零数据库真源身份 High；
4. 先接 Definition/Domain/Principal，再接 CreateInstance/Context/Submission/Transition/Event 查询；
5. 将上述写路径逐条改为 adapter，禁止新增 ADC workflow 写入口；
6. 建 projection 与 Shadow 对账，随后 canary、全量 cutover；
7. 观察窗口通过后删除 837 LOC runtime dead、旧内核、重复表/字段和约 1,084 LOC 修复脚本；
8. 最终验收标准：ADC 无第二套 currentStep、assignee、stateVersion、Submission、Transition、WorkflowEvent 或 workflow ACL 权威。

在 Stage 1A API smoke、ADC client/outbox、唯一数据库真源和稳定 identity mapping 未完成前，Stage 2 `SHADOW_READY`、Stage 3 `CUTOVER_READY`、Stage 4 `LEGACY_CODE_CLEANUP_READY` 均保持 BLOCKED。
