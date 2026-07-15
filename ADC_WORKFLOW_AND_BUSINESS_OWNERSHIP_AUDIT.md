# ADC Workflow 与业务对象所有权独立审计

## 0. 审计元数据

| 字段 | 值 |
|---|---|
| 审计对象 | `ADC_WORKFLOW_AND_BUSINESS_OWNERSHIP_INVESTIGATION` |
| 审计模式 | 独立、只读源码与数据入口交叉验证 |
| 日期 | 2026-07-15（Asia/Shanghai） |
| 基线 | `develop@343afa49475e6504b61e0b6510bfae372c65027f` |
| 候选 | `codex/adc-workflow-ownership-investigation@4130b2e078a5d58a4e2e3d9173b2c786e7f65949` |
| canonical 范围 | `backend/src/`、`backend/prisma/schema.prisma`、`backend/prisma/migrations/`、`frontend/src/` 调用者 |
| 非权威范围 | 根 `src/`、根 `prisma/` |
| 工作区保护 | 预先存在 `?? .zcode/`；未读取、修改或提交 |

## 1. 最终评级

```text
Blocker  0
High     2（均已被候选调查报告完整吸收并转化为后续硬门禁）
Medium   0（必须修订项已吸收）
Low      0
```

两个 High 是：

1. ADC 数据库真源身份冲突；
2. Report/Review 不能机械地一旧行映射一个不可变 Submission。

本审计确认候选报告可以作为“对象所有权调查冻结版”。这不等于 API、Shadow、Cutover 或旧代码清理已经完成。

## 2. 源码分类复审

### 2.1 Requirement 必须保留，但只能保留业务权威

结论 `RETAIN_AS_ADC_BUSINESS` 正确。

源码证明 Requirement：

- 可在没有 `workflowId/currentStep` 时由 `core-create.ts` 创建；
- 关联 Project、Service、依赖图、Revision、Task、Comment 和 Postmortem；
- 被需求池、列表、搜索、看板、项目和服务页面独立查询；
- 具有 requester/平台角色形成的 ADC 业务 ACL。

因此不能把 Requirement 整体降为 WorkflowInstance 投影。

候选报告也正确剥离了以下重复权威：

```text
workflowId / workflowSnapshot / currentStep / stateVersion / status
assignee / assigneeId
pmApprovedAt / pmApprovedBy / rejectReason
gitHash / branch / repoPath / deployVersion
```

其中 `currentStep/assignee` 可在迁移期保留为可重建 Projection，但不得继续参与权威写入或授权判断。删除 `workflowId` 前必须先冻结 `requirementId ↔ workflowInstanceId` 稳定映射。

### 2.2 不存在的概念不得伪装成待迁移实体

canonical ADC 中不存在独立的：

```text
WorkflowInstance / DeliveryResult / ApprovalLedger / Submission / Evidence
Space / Folder / Domain
```

候选报告把 Space/Folder 标为 `N/A`，而不是模糊的 `LEGACY_UNKNOWN`，处理正确。Domain 是目标侧 svc-workflow 权威，并非 ADC 旧 Domain 表的迁移。

Owner 也不是统一实体：Project、MarketplaceAgent、Service、Identity 的 owner 必须按各自业务关系保留；ExecutionLease owner 随 Lease 删除。

## 3. Report / Review 拆分复审

`RequirementReport` 当前混合了：

- 可覆盖的报告提交与重提；
- pending/approved/rejected 状态；
- QA findings、bypass、review comment；
- QA/CTO 待审队列；
- 审核驳回后对 `currentStep` 的直接回写。

svc-workflow 的 Submission 是不可变事实，因此唯一正确的导入模型是：

1. 每次报告提交和重提分别生成不可变 Report Submission；
2. QA review、CTO/general review 分别生成 Review Submission，或明确绑定 Transition 的 submission；
3. review 决定映射 `ADVANCE` 或 `RETURN`；
4. findings、bypass、reviewer、reviewedAt 和 comment 进入 Review Submission/Event；
5. pending-review 留作 ADC Projection；
6. 旧删除操作映射 correction/revoke event，不物理删除 workflow 事实。

因此：

- `RequirementReport` 表：`ABSORB_INTO_WORKFLOW`；
- `reports.ts` 与产品表单：`CONVERT_TO_WORKFLOW_ADAPTER`；
- 待审列表、timeline 和展示：`CONVERT_TO_WORKFLOW_PROJECTION`。

候选报告已完整吸收此 High，未再把 Report 当成一行一 Submission 的机械导入。

## 4. 数据库真源冲突（High）

独立检查确认同一工作区存在互相冲突的数据入口：

- root `.env` 指向不存在的 `test` 数据库；
- `backend/.env` 指向 Homebrew PostgreSQL 的 `agent_dev_center`，调查快照有 131 条 Requirement；
- 当前 Compose 解析出的数据库名同为 `agent_dev_center`；
- 已运行 Docker PostgreSQL 容器的初始化数据库却是 baseline；该 baseline 有 1 条 Requirement，而容器内另一个 `agent_dev_center` 为 0 条且缺表。

这不会推翻源码所有权分类，但会使以下结论失效：

```text
表为空 / 功能未使用 / 可直接删除
迁移总行数 / orphan 数量 / Shadow 差异
备份与回滚是否覆盖生产真源
```

候选报告已将该问题定为 High，并要求在 Shadow 前冻结唯一 `DATABASE_URL`、database、schema、环境标识、owner 和带 checksum 的 manifest。评级与停止条件正确。

## 5. ExecutionLease 唯一裁定

```text
ExecutionLease      DELETE_AFTER_CUTOVER
ExecutionLeaseEvent DELETE_AFTER_CUTOVER
```

理由：除 Prisma schema 和 migration 外，canonical runtime 中没有 acquire、heartbeat、release、scheduler、route、service 或 frontend caller。它不是当前 ADC 执行系统，只是未接通且硬绑定 Requirement/workflowStep/stateVersion 的遗留设计。

删除条件仍然是：在唯一权威数据库及所有环境确认零行，并排除外部直连客户端。不得以某一份本地快照的零行为直接删表依据。

## 6. Task、TestEnvLock 与执行边界

### Task

`RETAIN_AS_ADC_BUSINESS` 正确。一个 Requirement 可拆成多个 Task；Task 有独立 CRUD、状态、agentType、归档、列表和 Kanban，不是一对一 NodeVisit。

但它当前不是完整的队列/重试/Lease 执行系统。`tasks.ts` 在 Task 进入 in-progress/done 时直接写 Requirement `currentStep/assignee`，该副作用必须改为稳定幂等的 Workflow outbox 命令。

### TestEnvLock

`RETAIN_AS_ADC_BUSINESS` 正确，但只保留测试环境资源互斥语义。`autoAdvanceTestEnvQueue` 的 fire-and-forget `currentStep` 写入必须拆出，由 system principal 通过 adapter/outbox 发 `ADVANCE`。

推荐边界：

```text
svc-workflow      决定当前节点、assignee 和合法 Transition
ADC Task          管理业务拆解与子任务状态
ADC TestEnvLock   管理测试环境资源互斥
```

## 7. Audit / Event 边界

- `AuditLog`：`RETAIN_AS_ADC_BUSINESS`，只承载用户、权限和平台配置等治理审计；
- `WorkflowTransition`：`ABSORB_INTO_WORKFLOW`；
- `RequirementAuditLog`、`FeedbackEvent`：`DELETE_AFTER_CUTOVER`；
- `RequirementEventLedger`：`CONVERT_TO_WORKFLOW_PROJECTION`；
- admin transition stats、audit summary、timeline、root-cause aggregator：改读 WorkflowEvent 与 ADC business event 的合成投影。

现有 Ledger 混有 `REQUIREMENT_CREATED/PATCH_UPDATED` 等业务事件和流程事件，不能把整张表简单替换成远程 timeline。目标 Projection 必须有 source event ID、幂等键、增量 cursor/high-water mark 和全量 rebuild 能力。

## 8. Evidence、附件与 Marketplace 边界

Requirement 附件拥有独立上传、下载、归档和 Requirement ACL；文件 bytes 不应进入 workflow 数据库。当前实现缺少稳定 artifact ID、digest 和数据库 metadata，因此应：

```text
文件 bytes / 预览 / 归档 / 扫描  RETAIN_AS_EXTERNAL_ARTIFACT_SERVICE
提交者、NodeVisit、Context、URI/digest  WorkflowSubmission 权威
```

`MarketplaceDeliverable` 绑定独立 `MarketplaceTask`，可由 Agent callback 批量产生，并有任务完成后的产品约束。它不是 Requirement DeliveryResult，应 `RETAIN_AS_ADC_BUSINESS`。

## 9. LOC 唯一口径

冻结以下口径：

| 指标 | 行数 | 解释 |
|---|---:|---|
| `backend/src` 全部 TS | 26,371 | 包含测试，不等于全 canonical |
| backend tests | 7,755 | 不计 runtime |
| backend runtime | 18,616 | 生产 TypeScript 基线 |
| frontend runtime | 12,694 | 产品调用和展示基线 |
| canonical Prisma schema | 929 | 不含历史 migration |
| 已确认 runtime dead | 837 | `core-crud` 543 + `workflow-submit` 135 + `workflow-assign-service` 159 |
| Stage 4 backend 删除/整体替换 | 4.4k–5.2k | 唯一规划范围，不是当前净删除量 |

`6,843 LOC` 只能代表调查文件 footprint；`5.0k–5.6k` 只能代表扩大后的 touched surface。两者均不得写成“可删除 LOC”。最终净删除量以实施后的 diff 为准。

`workflow-cas-helper.ts` 41 LOC 仍被 active routes 使用，不属于 837 LOC runtime dead，只能在 adapter cutover 后删除。

## 10. 删除前置条件复审

旧内核、重复表和字段只能在以下条件全部成立后删除：

1. 数据库真源、schema、环境身份和 signed manifest 唯一化；
2. Requirement/Instance、Template/DefinitionVersion、User/Agent/Principal、产品容器/Domain 映射冻结；
3. 历史 workflowSnapshot、Report/Review、Transition/Audit/Event 按不可变事实完成导入与 digest 对账；
4. ADC Client + transactional outbox 具备稳定 idempotency key、重试、补偿和死信处理；
5. Task、Report、PM review、TestEnvLock 和修复脚本不再直写流程状态；
6. currentStep/assignee/timeline/mine/kanban/pending-review/admin stats 投影支持 rebuild、cursor 和延迟告警；
7. Artifact 已具备稳定 URI、digest、ACL、归档和扫描清单；
8. Shadow 达到冻结阈值，Canary、全量 Cutover 与 rollback 演练通过；
9. 所有环境 ExecutionLease 为零、无外部客户端、无旧 cron/repair writer；
10. 回滚观察窗口关闭后，先删调用和写入，再删投影、表和字段；历史 migration 保留。

## 11. 复审结论

候选调查报告已吸收独立审计发现的全部 Blocker/High：

- Blocker 为 0；
- 数据库真源 High 已转化为 Shadow 前硬门禁；
- Report/Review High 已转化为不可变展开、digest 对账和删除前置条件；
- ExecutionLease、Task、TestEnvLock、Audit/Event、Evidence/Marketplace 和 LOC 分类均已唯一化。

结论：`ADC_WORKFLOW_AND_BUSINESS_OWNERSHIP_INVESTIGATION` 可标记为调查冻结通过。Stage 1A 之后的 API、Client、身份、Outbox、Shadow、Cutover 和 cleanup 仍需分别实施、独立审计和验收；本报告不为后续阶段提前背书。
