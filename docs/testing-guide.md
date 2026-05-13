# 测试流程文档

> 最后更新：2026-05-12 · 测试工程师

## 1. 测试层级

| 层级 | 工具 | 触发时机 | 覆盖范围 |
|------|------|----------|----------|
| **Smoke Test** | Playwright | 每次部署后 | 页面非白屏、API 健康、资源加载 |
| **E2E 测试** | Playwright | 每次前端代码变更 | Token 登录、路由、权限、数据展示 |
| **API 测试** | curl / Supertest | 每次后端代码变更 | 接口功能、权限、边界条件 |
| **代码审查** | 人工 | 每次提交 | 代码质量、安全、逻辑错误 |

## 2. 部署后 Smoke Test

### 运行命令
```bash
cd /Users/yanfenma/workspace/project/agent-dev-center
npx playwright test e2e/smoke.spec.ts --reporter=line
```

### 检查项
- [x] API `/health` 返回 200 + `{ok:true}`
- [x] 首页 HTTP 200，`#root` 有 DOM 内容
- [x] 登录页 HTTP 200，有表单元素
- [x] 无关键静态资源 404 错误
- [x] 无关键 JS 控制台错误

### 失败处理
1. 检查 Docker 容器状态：`docker-compose -f docker-compose.prod.yml ps`
2. 检查 Nginx 日志：`docker logs agent-dev-center-nginx`
3. 检查前端构建产物：确认 `dist/` 下有 `index.html` 和 JS/CSS 文件

## 3. Token 登录 E2E 测试

### 运行命令
```bash
npx playwright test e2e/token-login.spec.ts --reporter=line
```

### 测试用例 (6 个)

| 用例 | 说明 |
|------|------|
| Token 登录后首页渲染 | 有效 Token → 首页有内容、有导航、有数据 |
| 无效 Token 错误提示 | 错误 Token → 显示错误提示，留在登录页 |
| 已登录刷新保持 | 刷新页面 → 内容保持，不跳转登录页 |
| 未登录只读模式 | 未登录 → 只读提示，非白屏 |
| PublicLayout 回归 | 已登录 → PublicLayout 不 return null |
| 空 Token 表单校验 | 不输入 → 表单校验提示 |

### 环境变量
```bash
E2E_BASE_URL=http://8.163.44.127    # 前端地址
E2E_API_URL=http://8.163.44.127/api # API 地址
E2E_TEST_EMAIL=admin@agent.dev      # 测试账号
E2E_TEST_PASSWORD=PASSWORD_REMOVED_BY_SECURITY_CLEANUP       # 测试密码
```

## 4. 前端部署前必查清单

> 来自 2026-05-12 白屏 Bug 的事后经验

| # | 检查项 | 方法 |
|---|--------|------|
| 1 | 用真实浏览器验证 | Brave/Playwright 打开页面确认渲染 |
| 2 | 测试 `isPublicMode=true` 场景 | 用 `.env.local.public` 或环境变量 |
| 3 | 搜索 `return null` | 路由组件中不允许无条件的 `return null` |
| 4 | 检查路由优先级 | `createBrowserRouter` 中子路由匹配顺序 |
| 5 | 验证 localStorage 持久化 | 刷新页面后状态是否保持 |
| 6 | 外网构建配置一致性 | `.env.production` 与本地开发配置差异 |

## 5. Code Review 清单（新增）

以下项目由白屏 Bug 事件新增：

- [ ] React 路由组件中是否有 `return null`（除非是明确的 loading 状态）
- [ ] `isPublicMode` 分支是否正确处理已登录用户
- [ ] 登录后页面跳转目标是否正确渲染
- [ ] Token 字段名是否与 API 返回一致（`accessToken` vs `token`）
- [ ] 外网模式（`VITE_IS_PUBLIC_MODE=true`）下是否有未覆盖的代码路径

## 6. Bug 严重级别定义

| 级别 | 定义 | 示例 | 响应时间 |
|------|------|------|----------|
| **P0** | 全部用户无法使用核心功能 | 白屏、登录失败、数据丢失 | 立即修复 |
| **P1** | 大部分用户受影响，但有临时方案 | 列表无法加载、表单无法提交 | 4 小时内 |
| **P2** | 小部分用户或非核心功能 | 筛选不精确、样式错位 | 24 小时内 |
| **P3** | 体验优化 | 文案、动画、提示信息 | 下个迭代 |

## 7. 已知问题追踪

| 日期 | 问题 | 状态 | 关联 |
|------|------|------|------|
| 2026-05-12 | Token 登录白屏 | ✅ 已修复 | 需求 287a97a9 |
| 2026-05-12 | 小程序 login token 字段名 | 🔲 待修 | 需求 49fcae34 BUG-001 |
| 2026-05-12 | 小程序 WXML 函数调用 | 🔲 待修 | 需求 49fcae34 BUG-002 |
| 2026-05-12 | 文章 slug 格式校验缺失 | 📝 已记录 | 需求 b4f26295 |
