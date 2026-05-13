# 状态机改进方案（2026-05-12）

## 当前问题

1. **testing 和 review 状态无人使用** — 所有任务直接从 in-progress 到 done
2. **部署环节缺失** — 只有 DEPLOY_CONFIRM 报告，无对应状态
3. **状态流转不清晰** — 工程师一次性提交所有报告，跳过中间状态

## 建议的新状态机

```
pending → approved → in-progress → testing → review → deploying → done
                                 ↓           ↓         ↓
                            开发自检    测试报告   部署确认
                                        安全审查
```

### 各状态定义

| 状态 | 含义 | 谁负责 | 必需的报告 | 说明 |
|---|---|---|---|---|
| **pending** | 待审核 | CTO | 无 | 需求刚提交，CTO 审核中 |
| **approved** | 已批准 | CTO | 无 | CTO 批准，等待分配 |
| **in-progress** | 开发中 | 开发工程师 | DEV_SELF_CHECK（approved） | 工程师正在开发 |
| **testing** | 测试中 | 测试工程师 | DEV_SELF_CHECK + TEST_REPORT（approved） | 开发完成，测试工程师测试 |
| **review** | 待验收 | CTO | DEV_SELF_CHECK + SECURITY_REVIEW + TEST_REPORT（approved） | 测试通过，等待 CTO 验收 |
| **deploying** | 部署中 | 运维工程师 | 全部 4 个报告 + CTO_REVIEW（approved） | CTO 验收通过，正在部署 |
| **done** | 已完成 | - | 全部 4 个报告 + CTO_REVIEW + DEPLOY_CONFIRM（approved） | 部署成功，线上可用 |
| **rejected** | 已拒绝 | CTO | - | 需求被拒绝 |

### 状态流转硬规则（后端 API 强制执行）

| 目标状态 | 前置条件 | 必需的报告 |
|---|---|---|
| `in-progress` | 已分配（assignee 不为空） | 无 |
| `testing` | 开发完成 | DEV_SELF_CHECK（approved） |
| `review` | 测试完成 | DEV_SELF_CHECK + TEST_REPORT（approved） |
| `deploying` | CTO 验收通过 | DEV_SELF_CHECK + SECURITY_REVIEW + TEST_REPORT + CTO_REVIEW（approved） |
| `done` | 部署成功 | 全部 5 个报告（approved） |

## 执行要点

### 1. 状态流转必须逐步进行
- ❌ 不允许：in-progress → done
- ✅ 必须：in-progress → testing → review → deploying → done
- 后端 API 强制拦截，任何角色（包括 admin）都无法绕过

### 2. 各角色职责

**开发工程师**：
- 完成开发 → 提交 DEV_SELF_CHECK 报告 → 状态改为 `testing`

**测试工程师**：
- 收到 `testing` 任务 → 执行测试 → 提交 TEST_REPORT → 状态改为 `review`
- 如发现 bug → 退回 `in-progress`

**CTO**：
- 收到 `review` 任务 → 审核报告 → 提交 CTO_REVIEW → 状态改为 `deploying`
- 如不通过 → 退回 `testing` 或 `in-progress`

**运维工程师**：
- 收到 `deploying` 任务 → 执行部署 → 提交 DEPLOY_CONFIRM → 状态改为 `done`
- 如部署失败 → 退回 `review`

### 3. 报告提交与状态流转解耦

当前问题：工程师一次性提交所有报告（DEV_SELF_CHECK + TEST_REPORT + SECURITY_REVIEW），然后直接改状态到 done。

**改进**：
- 每个角色只能提交自己负责的报告
- 状态流转必须等待对应的报告审批通过
- 测试工程师不能提交 DEV_SELF_CHECK，开发工程师不能提交 TEST_REPORT

### 4. 部署失败处理

新增 `deploying` 状态后：
- 部署失败时，状态退回到 `review`（保留已通过的报告）
- 运维工程师在 DEPLOY_CONFIRM 报告中说明失败原因
- CTO 决定是否继续部署或放弃

## 实施步骤

1. **更新后端代码**：
   - 新增 `deploying` 状态
   - 更新状态流转校验逻辑
   - 增加报告提交权限控制（每个角色只能提交特定类型报告）

2. **更新前端代码**：
   - 侧边栏状态筛选增加 `deploying`
   - 状态流转按钮按角色显示
   - 部署中状态的特殊提示

3. **更新 Skills**：
   - `dev-self-check`：开发完成后，只能改为 `testing` 状态
   - `test-report`：测试完成后，只能改为 `review` 状态
   - `delivery-acceptance`：验收通过后，只能改为 `deploying` 状态
   - `deploy-confirm`：部署成功后，改为 `done` 状态

4. **数据迁移**：
   - 已完成的 38 个任务保持 `done` 状态不变
   - 新任务严格按新状态流转

## 收益

- ✅ 流程清晰：每个环节都有明确的状态和负责人
- ✅ 责任到人：开发、测试、CTO、运维各司其职
- ✅ 部署可见：部署过程有独立状态，失败可追踪
- ✅ 防止跳步：后端 API 强制逐步流转
