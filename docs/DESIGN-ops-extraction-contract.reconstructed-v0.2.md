# Ops 抽离契约 (Design Document) v0.2

> ⚠️ **RECONSTRUCTED — PENDING OWNER VERIFICATION**
>
> 本文件是从会话记忆和老板决策中重建的 v0.2 版本。
> 原始 untracked 文件 `docs/DESIGN-ops-extraction-contract.md` 已在 2026-06-21 的事故中被误删。
> **在原始作者 mayf3 逐节确认前，不得改回正式文件名。**
>
> 事故记录: 见 `memory/2026-06-21.md` (22:15 更新)

## 状态

- 状态: **DRAFT** (重建中，待验证)
- 最后更新: 2026-06-21
- 依赖于: ADC Kernel Phase 1+2 验收完成

## 1. 背景与动机

Agent Dev Center (ADC) 承担了需求平台职能，同时也内嵌了部署运维能力。
随着团队规模增长和部署复杂度提升，需要将运维能力抽离为独立职责域：

- **ADC 的职责**: 需求发布 + 开发管理 + 交付验收
- **Ops 的职责**: 构建 + 部署 + 环境管理 + 回滚

两者通过契约化的 API / Callback / Event 通信，不共享数据库与业务 service。

## 2. 架构原则

### 2.1 仓库结构

- `ops/` 与 ADC 同仓库，但按**随时可拆仓**设计
- 同仓库便于共享类型定义和 CI 配置，独立目录保证边界清晰
- 数据存储完全隔离（独立 database / schema）

### 2.2 通信边界

ADC 与 Ops 之间**只通过以下方式通信**：

1. **API** — ADC 调用 Ops 发起部署
2. **Callback** — Ops 部署完成后回调 ADC
3. **Event** — (远期) 通过事件总线异步通知

不共享数据库，不共享业务 service，不直接调用内部函数。

## 3. 核心数据类型

### 3.1 serviceId

- **类型**: opaque external string
- **生成**: Ops 颁发，ADC 不建 FK（不创建数据库外键约束）
- **存储**: ADC 的 Requirement 表中以字符串记录

### 3.2 environmentKey

- **开放字段** — ADC 不解析其内部结构
- **用途**: Ops 内部区分环境（staging / production / canary 等）
- **ADC 只存储透传**: 需求创建时指定，Ops 部署时读取

### 3.3 isProduction

- ADC 唯一解析的环境相关字段
- 决定是否需要在部署前执行额外的安全审批和生产就绪检查
- **ADC 只看 isProduction**，不解析 environmentKey

### 3.4 deploymentRef

- 当前最新成功部署的投影（非完整历史）
- 包含: serviceId, version, deployedAt, environmentKey, isProduction
- **非 append-only** — 每次成功部署覆盖前值
- 完整审计链由 `DeploymentCallbackReceipt` 保证

### 3.5 DeploymentCallbackReceipt

- **append-only** — 每次部署回调追加一条记录，永不覆盖或删除
- 是 Ops 部署的审计底线
- 字段: callbackEventId, serviceId, requirementId, status, timestamp, rawPayload

## 4. 回调端点

```
POST /api/requirements/:id/deployment-callback
```

### 4.1 安全

- **HMAC 验签** — Ops 使用共享 secret 对 payload 签名
- ADC 验证签名后才处理回调

### 4.2 幂等性

- **callbackEventId** — Ops 在每次回调中生成唯一 ID
- ADC 记录已处理的 callbackEventId，重复回调直接返回 200（已处理）

### 4.3 处理流程

1. HMAC 验签 → 失败则 401
2. 检查 callbackEventId 是否已处理 → 已处理则 200（幂等）
3. 查找对应的 Requirement
4. 记录 DeploymentCallbackReceipt（append-only）
5. 更新 deploymentRef（投影覆盖）
6. 根据 status 推进工作流（成功 → 继续，失败 → 通知 / 回滚决策）

## 5. 实施阶段

### 5.1 Ops 单 1 — 基础部署

- ADC 调用 Ops API 触发部署
- Ops 部署后回调通知结果
- 基本的成功/失败处理

### 5.2 Ops 单 2 — 加固与完整契约

- HMAC 验签
- 幂等 callback
- append-only Receipt
- 回滚协调
- 部署状态实时查询

### 5.3 依赖关系

- Ops 单 1 和单 2 分离实施
- 单 2 在单 1 验收通过后开始
- **Phase 2A 不等于整个 Phase 2 完成** — 单 2 仍属于 Phase 2

## 6. 实施前提

- ADC Kernel Phase 1+2 验收完成（含 snapshot、CAS、execution lease）
- Ops 的基础设施就绪（服务器、Docker registry、数据库）

## 7. 开放问题

（待原文作者补充）

- 回滚策略: 自动回滚 vs 人工决策
- 部署超时处理
- 多环境并行部署的锁机制
- 审计日志的保留策略

---

## 附录 A: 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-06-21 | 外部 AI | 原始版本（已丢失） |
| v0.2 | 2026-06-21 | CTO (重建) | 从会议纪要重建，PENDING VERIFICATION |
