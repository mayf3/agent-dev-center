# DEV_SELF_CHECK — 任务 071c9108

## ADC前端：Agent个人主页+OKR可视化展示

### Summary

为 ADC 前端新增 /agents 路由，集成 svc-okr API 展示 Agent OKR 状态标签（draft/proposed/under_review/approved/active），新增管线分类筛选，增强 Agent 详情页 OKR 信息展示。

### Changes

| # | 文件 | 说明 |
|---|------|------|
| 1 | `src/api/svc-okr.ts` | **新增** — svc-okr API 客户端，独立 baseURL `/okr-api`，支持 `list/get/getByName/getUnassigned`，导出 `OkrStatus` 类型和 `getOkrGoalStats` 工具函数 |
| 2 | `vite.config.ts` | **修改** — 新增 `/okr-api` 代理到 svc-okr:3459 |
| 3 | `src/pages/agents/AgentTeamBoard.tsx` | **增强** — ① 新增管线筛选（pipelineFilter）② 调用 svc-okr API 获取每个 Agent 的 okrStatus ③ 卡片展示 OKR 状态标签（草稿/提案中/审核中/已批准/进行中）④ 路由感知：根据访问路径（`/team` 或 `/agents`）动态生成详情链接 |
| 4 | `src/pages/agents/AgentDetailPage.tsx` | **增强** — ① 并行调用 svc-okr API 获取 OKR 详情 ② OKR 卡片头部显示 okrStatus 状态标签 ③ 返回按钮路由感知 |
| 5 | `src/App.tsx` | **修改** — PublicLayout 和 ProtectedRoute 中新增 `/agents` 和 `/agents/:agentId` 路由 |

### New Feature Details

**Agent 列表页 `/agents` 或 `/team`：**
- 管线分类筛选下拉框（内容生产/育儿/投资/健康/规划/生活/运维/教育/业务/跨层职能）
- 层筛选、搜索框、刷新按钮
- 卡片展示：头像 + 名称 + 状态 + 层标签 + 管线标签 + **OKR 状态标签** + 进度条
- OKR 状态颜色映射：草稿(orange) / 提案中(blue) / 审核中(purple) / 已批准(green) / 进行中(cyan)

**Agent 详情页 `/agents/:agentId` 或 `/team/agents/:agentId`：**
- 基础信息（名称、标识、层、管线、状态、心跳、任务统计）
- OKR 模块：状态标签 + 进度条 + 月度目标列表 + 长期方向
- 变更历史时间线
- 周报提交模态框
- 路由兼容：支持 `/agents` 和 `/team` 双前缀

### Tested

| 场景 | 结果 |
|------|------|
| TypeScript 类型检查 `npx tsc --noEmit` | ✅ 通过，无错误 |
| 生产构建 `npm run build` | ✅ 通过，产物正常 |
| svc-okr API 客户端代理路径 | ✅ 正确配置 `/okr-api` → svc-okr:3459 |
| 路由双前缀兼容 | ✅ `/agents` 和 `/team` 前缀均可访问 |
| 空数据状态 | ✅ 显示"暂无符合条件的 Agent" |
| 无目标卡状态 | ✅ 显示"暂未设定目标" |

### Issues

- 无已知问题

### Deployment

部署需求：
1. Nginx 无需改动（前端 SPA 使用 hash-less 路由，`/agents` 路径由前端 SPA 自身处理）
2. 需要 itops-agent 将 `frontend/dist/` 部署到生产环境
3. 需要确保 svc-okr 服务运行在 port 3459 且可从 nginx 访问

### Conclusion

**通过** — 所有功能开发完成，构建验证通过，可部署测试。
