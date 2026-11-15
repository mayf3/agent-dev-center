# ADC V2 rewrite baseline 独立审计

## 1. 最终结论

```text
Verdict: PASS
Blocker: 0
High: 0
Medium: 0
Low: 0
Audit target: c2a4564280202499df34395b9d445ed749e98861
Target tree: 359196ca6debb985da11b4ad18677cca13480fe3
Parent: 939a93edfa88d06ba234709284c78070212f7137
Branch: codex/adc-v2-minimal
```

本结论审核的是 Stage 0 基线报告是否忠实、可复算，及其 V2 边界是否保持
`svc-workflow` 唯一权威。报告中已经公开的外部凭据 High、Worklist/Legacy Import
hard stop 和生产数据未知，不是本候选新引入的缺陷，也没有被本审计视为已关闭。

候选提交只新增 `docs/ADC_V2_REWRITE_BASELINE.md`，未修改 V1、V2、backend、frontend、
数据库 schema 或 `svc-workflow` 实现。审计开始时 HEAD、tree、branch 与声明一致，
worktree clean。

## 2. V1 47 文件分类复核

独立反算 `939a93e..0bec8fe` 得到：

- 47 files changed；
- 2,297 insertions；
- 66 deletions；
- 基线分类表恰好 47 行；
- diff 文件集合与表格文件集合一一相等，无漏项、重复项或额外项。

逐类回看后未发现错误分类：

- 本地 Requirement、Run、Outbox、Artifact、projection 和双读合并逻辑均正确归入
  `DISCARD` 或仅供旧行冻结的 `TEMPORARY_BRIDGE`；
- canonical JSON、reconciliation 和 binding upsert 只作为 migration tooling 复用，
  没有进入 V2 正常命令权威；
- `gateway.ts` 的 `REUSE_IN_V2` 必须按报告定义理解为选择性复用接口边界与已审核
  client，而不是复制 V1 的静态 token singleton；基线 Auth 章节已经要求短期 token
  provider，因此不存在身份权威回退；
- V1 独立审计的 High 1 / Medium 1 / Low 1 被准确复述，候选没有把 V1 写成可合并基线。

## 3. 生产 backend 与规模计数

基于 tracked `develop@939a93e`、排除 test、`node_modules`、`dist` 后复算：

| 指标 | 复算结果 | 判定 |
| --- | ---: | --- |
| Prisma models | 32 | 匹配 |
| Auto-mounted route modules | 27 | 匹配 |
| Mounted Express methods | 179 / 57 files | 匹配 |
| Frontend `*Page.tsx` | 25 | 匹配 |
| `App.tsx` path declarations / unique values | 55 / 29 | 匹配 |
| Backend production TS LOC | 19,885 | 匹配 |
| Frontend production TS/TSX LOC | 12,694 | 匹配 |
| Backend route LOC | 12,986 | 匹配 |
| Frontend `pages/` LOC | 8,748 | 匹配 |

路由扫描共识别 193 个 Express method definitions；`services.ts`、
`requirements/core-crud.ts`、`requirements/workflow-submit.ts` 的 14 个定义没有
`mountPath` 或未被 requirements index 注册，扣除后正好为报告所述 179/57。
生产 Dockerfile 构建 `backend/`，未把 deprecated root `src/` 计入生产 backend，口径诚实。

## 4. 本地数据库事实

以 PostgreSQL `BEGIN READ ONLY` 重新读取 loopback `agent_dev_center`：

- 36 public base tables（含 `_prisma_migrations`）；
- Requirement 131，active 35，null `currentStep` 96，completed/abandoned 均为 0；
- 131/131 超过 48 小时和 7 天，0/131 超过 30 天；active 35/35 超过 7 天；
- Reports / WorkflowTransitions / Revisions = 30 / 15 / 5；
- Tasks / Comments / Postmortems = 0 / 0 / 0；WorkflowTemplates = 93；
- step 分布与报告完全一致，全部 `status=pending`；
- 35 个 active 均有 array snapshot 且 `currentStep` 可在 snapshot 中找到；35/35
  `workflowId`、`assigneeId` 为 null，20/35 也没有 assignee display string。

数据库确实缺少 Prisma 已声明的 `requirement_event_ledger`、`root_cause_candidates`，并包含
当前 Prisma 未声明的 identity/domain/service 表。报告正确称其为本地、疑似 synthetic、
存在 schema drift 的快照，并将生产数量保持为 `NOT_VERIFIED`，没有伪称生产事实。

## 5. 外部调用与安全边界

只读核验确认：

- tracked `deploy-agent` simulator 仍调用旧 Requirement create/assign/advance、Report review
  与 patch 路径；
- `svc-okr` weekly report 仍读取旧 Requirement list 并解释 `currentStep`；
- ADC poll/QA scripts 仍消费旧 Task、Report、Requirement API；
- `deploy-agent` tracked 文件内确有非占位账户口令、JWT-like bearer 与 deployment-key
  material；JWT 当前已过期，但 key 撤销状态无法从仓库证明。

基线将其定为 High、要求授权 owner 轮换/撤销且禁止 Stage 0 擅自修改外部仓库，严重度与
处置边界正确。报告未复印秘密值，也未错误宣称旧调用方已经退役。

## 6. `svc-workflow` capability 与 hard stops

基线矩阵与 local `svc-workflow@4a7b3a3` 一致：Create、known-ID Detail、SVC Timeline、
Transition 有 HTTP；Worklist、DRAFT combined action、Legacy Import 仅有 Rust application
service 或 query service，没有对应网络入口。Legacy Import 只生成 Context/Visit/Event #1
和 SVC version 1，不保存旧历史、事件时间或版本连续性。

远端 `svc-workflow main` 与 Legacy feature 仍缺少本地完整修复/审计对象，因此报告正确保留：

- Stage 1 Worklist hard stop；
- Stage 4 Legacy Import hard stop；
- production auth/provisioning、credential rotation、生产 denominator 后续 gate。

这些能力没有被扩大解释，也没有用本地数据库直读或 ADC projection 伪造缺失 Worklist。

## 7. V2 唯一权威审计

建议的 `backend/src/v2`、`frontend/src/v2` 尚未创建。文档限定 V2 为零本地业务表、零后台
job、独立入口和纯 SVC proxy；binding 仅是 immutable scenario-to-definition config，不保存
workflow current state。Create/Detail/Timeline/Transition DTO 均不接受 actor、assignee 或
next-node，前端只显示 SVC 返回的 executable transition。

HS-1 中两条 Worklist route 是显式的“待讨论最小 HTTP adapter”草案，复用现有 query
service，并明确禁止 schema、kernel、event、receipt、command、storage 变化。它不是隐藏的
ADC 内核，也未在本候选中实现 `svc-workflow` 扩展。Stage 1 在正式同意该 adapter 前仍被
报告明确阻断。

## 8. 审计判定

未发现候选报告中的事实错误、遗漏文件、计数漂移、生产数据冒认、外部安全淡化、双权威
设计或隐蔽工作流内核扩展。故 Stage 0 baseline 文档审计为 `PASS`；这一 PASS 不解除文档
已经列出的 Stage 1/4/production hard stops。

本审计未修改实现、未访问生产、未变更外部仓库、未 push。
