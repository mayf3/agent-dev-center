# 事后验尸报告：Token 登录后白屏 Bug

**日期**：2026-05-12  
**严重程度**：P0（影响所有外网用户）  
**发现者**：老板（用户711897）  
**修复者**：CTO  
**状态**：已修复并验证

---

## 1. 事件概要

| 项目 | 详情 |
|------|------|
| **影响** | 所有通过 Token 登录的外网用户，登录成功后首页空白 |
| **持续时间** | 2026-05-09 至 2026-05-12（约 3 天） |
| **发现时间** | 2026-05-12 21:00（老板反馈） |
| **修复时间** | 2026-05-12 21:20 |

## 2. 根因分析（Root Cause）

### Bug 现象
- 用户在 http://{your-server-ip} 上输入 JWT Token 登录
- 登录 API 调用成功（`GET /auth/me` 返回 200 + 用户信息）
- 页面跳转到 `/`，但显示白屏（空白页）

### 技术根因
前端代码中存在 **路由冲突 + 错误的空渲染逻辑**：

**App.tsx 路由配置**（`VITE_IS_PUBLIC_MODE=true` 时）：
```
路由 1: /login → LoginPage
路由 2: / → PublicLayout (未登录用户，只读模式)
路由 3: ProtectedRoute → AppLayout (已登录用户)
```

**PublicLayout.tsx 中的致命 Bug**：
```tsx
// 已登录用户走 ProtectedRoute，这里不渲染
if (isAuthenticated) {
  return null;  // ← BUG！返回 null = 白屏！
}
```

**完整触发链条**：
1. 用户 Token 登录成功 → `isAuthenticated` 变为 `true`
2. 页面导航到 `/`
3. React Router 按路由表顺序匹配，**PublicLayout（路由 2）先匹配**
4. PublicLayout 检测到 `isAuthenticated=true`，执行 `return null`
5. **白屏** — ProtectedRoute（路由 3）根本没有机会渲染

### 为什么之前没发现
1. **从未用真实浏览器验证** — CTO 多次"纸上修"（改代码、构建、部署），但没有实际打开浏览器验证
2. **只测了内网模式** — 本地开发时 `VITE_IS_PUBLIC_MODE=false`，走的是邮箱密码登录，完全不同的代码路径
3. **缺少 E2E 测试** — 没有 Playwright/Cypress 等自动化测试覆盖 Token 登录流程
4. **外网构建配置与本地不一致** — `.env.production` 设置了 `VITE_IS_PUBLIC=true`，本地开发没有这个设置

## 3. 修复方案

在 `PublicLayout.tsx` 中，将：
```tsx
if (isAuthenticated) {
  return null;
}
```

改为：
```tsx
if (isAuthenticated) {
  return <AppLayout />;
}
```

这样即使 PublicLayout 路由先匹配到，已登录用户也能看到完整的 AppLayout（带侧边栏、导航、内容）。

## 4. 经验教训

| # | 教训 | 改进措施 |
|---|------|---------|
| 1 | **没有用真实浏览器验证** | 所有前端修改部署后，必须用 Brave/Playwright 打开页面验证 |
| 2 | **缺少 E2E 测试** | 增加 Playwright E2E 测试：Token 登录→首页渲染→数据展示 |
| 3 | **构建配置环境差异** | 本地开发也应测试 `isPublicMode=true` 场景 |
| 4 | **`return null` 是危险模式** | Code Review 清单增加：React 路由组件中不允许 `return null`（除非是明确的 loading 状态） |
| 5 | **老板多次反馈未解决** | "修了 N 次"说明每次都在猜原因，应该第一时间用浏览器复现 |

## 5. 后续行动项

- [ ] **Playwright E2E 测试**：覆盖 Token 登录 → 首页渲染的完整流程
- [ ] **部署后 Smoke Test**：CI/CD 部署后自动访问页面检查非白屏
- [ ] **Code Review 清单更新**：增加 `isPublicMode` 分支检查和 `return null` 审查
- [ ] **本地开发支持 public mode**：添加 `.env.local.public` 方便本地测试外网模式
- [ ] **Bug 复现文档**：记录如何用 Brave CDP 复现和验证前端问题

## 6. 时间线

| 时间 | 事件 |
|------|------|
| 05-09 | 首次部署前端，发现白屏 |
| 05-09 ~ 05-12 | CTO 多次"修复"（改 accessToken 字段名、重建 Docker 镜像等），均未验证 |
| 05-12 21:00 | 老板再次反馈"白屏" |
| 05-12 21:05 | CTO 首次用 Brave 浏览器打开页面验证 |
| 05-12 21:10 | 发现 Token 登录模式下只调了 `/auth/me` 返回 401（先用错了密码当 Token） |
| 05-12 21:12 | 发现根因：PublicLayout `return null` |
| 05-12 21:18 | 修复代码、构建、部署 |
| 05-12 21:20 | 用 Brave 验证 Token 登录→首页完整显示 ✅ |

---

## 7. 测试工程师审查意见

**审查人**：test-engineer
**审查时间**：2026-05-12 21:39

### 7.1 报告质量评价

| 维度 | 评分 | 说明 |
|------|------|------|
| 根因分析 | ⭐⭐⭐⭐⭐ | 清晰还原了完整的触发链条：Token 登录 → isAuthenticated=true → PublicLayout return null → 白屏 |
| 时间线 | ⭐⭐⭐⭐⭐ | 精确到分钟，体现了问题从发现到修复的全过程 |
| 经验教训 | ⭐⭐⭐⭐ | 5 条教训覆盖了核心问题，但建议补充"测试左移"视角 |
| 后续行动 | ⭐⭐⭐⭐ | 行动项具体，但缺少验收标准和负责人 |

### 7.2 补充分析

#### 为什么测试没有拦截这个 Bug

1. **缺少 E2E 测试层**：项目没有任何 Playwright/Cypress 测试，前端完全依赖人工验证
2. **环境配置盲区**：本地开发默认 `VITE_IS_PUBLIC_MODE=false`，与生产环境（`true`）走了完全不同的代码路径，且没有机制确保两条路径都被测试
3. **Code Review 缺少 Checklist**：`return null` 在路由组件中是高风险模式，但没有明确的审查规则

#### 漏洞分类（Flaw Classification）

按 **ORT (Omission, Reliability, Timing)** 分类：
- **Omission（遗漏）**：缺少 E2E 测试覆盖 Token 登录流程
- **Omission（遗漏）**：缺少部署后 Smoke Test
- **Reliability（可靠性）**：`return null` 模式未经过生产环境配置验证

#### 改进措施补充

| # | 措施 | 负责人 | 验收标准 |
|---|------|--------|----------|
| 6 | Playwright E2E 测试用例 | test-engineer | ✅ 已完成（6 个用例） |
| 7 | 部署后 Smoke Test 脚本 | test-engineer | ✅ 已完成（5 个检查项） |
| 8 | 测试流程文档 | test-engineer | ✅ 已完成（docs/testing-guide.md） |
| 9 | Code Review Checklist 更新 | test-engineer | ✅ 已完成（新增 5 项） |

### 7.3 防止复发的具体措施

```
部署流程（更新后）：
  代码提交 → Code Review → 合并 → 构建 → 部署 → Smoke Test → E2E Test → 通知
                                                           ↑ 新增     ↑ 新增
```

**Smoke Test 门禁**：如果 `smoke.spec.ts` 任一用例失败，自动阻断后续部署。

---

*报告人：CTO | 审核人：test-engineer ✅ 已审核*
