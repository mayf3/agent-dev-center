/**
 * E2E 测试：Token 登录流程 + 白屏回归测试
 *
 * 覆盖场景：
 *   1. Token 登录 → 首页渲染（确认非白屏）
 *   2. Token 无效 → 错误提示
 *   3. 已登录用户刷新页面 → 仍然显示内容
 *   4. 未登录用户访问 → 只读模式（非白屏）
 *   5. Token 过期 → 自动跳转登录
 *
 * 运行方式：
 *   npx playwright test e2e/token-login.spec.ts
 *
 * 关联需求：287a97a9（前端登录白屏 Bug 事后验尸）
 * 关联 Bug：PublicLayout `return null` 导致白屏（已修复）
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://8.163.44.127';
const API_URL = process.env.E2E_API_URL || `${BASE_URL}/api`;
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'admin@agent.dev';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'PASSWORD_REMOVED_BY_SECURITY_CLEANUP';

/**
 * 辅助函数：通过 API 获取有效 Token
 */
async function getValidToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login API failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.accessToken || data.token;
}

/**
 * 辅助函数：检查页面非白屏
 * 白屏特征：<body> 内无可见文本内容，或 body.innerHTML 仅包含空白
 */
async function assertNotBlank(page: Page, description: string) {
  const bodyText = await page.locator('body').innerText({ timeout: 5000 });
  // 白屏时 bodyText 通常为空或只有极少量空白字符
  expect(bodyText.trim().length, `${description} - 页面不应白屏`).toBeGreaterThan(10);
}

// ============================================================
// 测试 1: Token 登录 → 首页渲染（确认非白屏）
// ============================================================
test('Token 登录后首页正常渲染（非白屏）', async ({ page }) => {
  // 1. 获取有效 Token
  const token = await getValidToken();
  expect(token).toBeTruthy();

  // 2. 访问登录页
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');

  // 3. 在 Token 输入框中输入 Token
  const tokenInput = page.locator('input[type="password"]').first();
  await tokenInput.fill(token);

  // 4. 点击登录按钮
  const loginButton = page.locator('button:has-text("Token 登录"), button:has-text("登录")').first();
  await loginButton.click();

  // 5. 等待页面跳转和内容渲染
  await page.waitForURL(BASE_URL + '/', { timeout: 10000 });

  // 6. 关键断言：页面非白屏
  await assertNotBlank(page, 'Token 登录后首页');

  // 7. 验证关键元素存在（侧边栏或导航）
  const hasSidebar = await page.locator('.ant-layout-sider, [class*="sider"], [class*="sidebar"]').count();
  const hasHeader = await page.locator('.ant-layout-header, [class*="header"]').count();
  expect(hasSidebar + hasHeader, '应存在导航元素（侧边栏或顶部栏）').toBeGreaterThan(0);

  // 8. 验证有可见的业务内容（仪表盘数据或需求列表）
  const contentVisible = await page.locator('.ant-card, .ant-table, .ant-statistic, [class*="dashboard"]').count();
  expect(contentVisible, '首页应有数据展示内容').toBeGreaterThan(0);
});

// ============================================================
// 测试 2: Token 无效 → 错误提示
// ============================================================
test('无效 Token 登录显示错误提示', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');

  // 输入无效 Token
  const tokenInput = page.locator('input[type="password"]').first();
  await tokenInput.fill('invalid-token-12345');

  // 点击登录
  const loginButton = page.locator('button:has-text("Token 登录"), button:has-text("登录")').first();
  await loginButton.click();

  // 等待错误提示出现
  const errorToast = page.locator('.ant-message-error, .ant-alert-error, .ant-form-item-explain-error');
  await expect(errorToast, '应显示错误提示').toBeVisible({ timeout: 5000 });

  // 验证仍在登录页
  expect(page.url()).toContain('/login');
});

// ============================================================
// 测试 3: 已登录用户刷新页面 → 仍然显示内容
// ============================================================
test('已登录用户刷新页面后内容保持', async ({ page }) => {
  const token = await getValidToken();

  // 1. 先注入 Token 到 localStorage（模拟已登录状态）
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(({ token, userStr }) => {
    localStorage.setItem('agent-dev-center-token', token);
    localStorage.setItem('agent-dev-center-user', userStr);
  }, {
    token,
    userStr: JSON.stringify({ id: 'test', name: 'CTO', email: 'admin@agent.dev', role: 'admin' }),
  });

  // 2. 导航到首页
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState('networkidle');

  // 3. 首次验证非白屏
  await assertNotBlank(page, '刷新前');

  // 4. 刷新页面（模拟 F5）
  await page.reload({ waitUntil: 'networkidle' });

  // 5. 刷新后验证仍然非白屏
  await assertNotBlank(page, '刷新后');

  // 6. 验证没有跳转到登录页
  expect(page.url(), '刷新后不应跳转到登录页').not.toContain('/login');
});

// ============================================================
// 测试 4: 未登录用户访问 → 只读模式（非白屏）
// ============================================================
test('未登录用户访问首页进入只读模式（非白屏）', async ({ page }) => {
  // 清除所有存储
  await page.goto(`${BASE_URL}/`);
  await page.evaluate(() => {
    localStorage.clear();
  });

  // 重新加载
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState('networkidle');

  // 关键断言：非白屏
  await assertNotBlank(page, '未登录用户访问首页');

  // 验证处于只读模式
  const hasReadonlyHint = await page.locator('text=只读模式, text=登录').count();
  expect(hasReadonlyHint, '应显示只读模式提示或登录按钮').toBeGreaterThan(0);
});

// ============================================================
// 测试 5: PublicLayout 不渲染 null（回归测试）
// ============================================================
test('PublicLayout 在已登录时不渲染空白', async ({ page }) => {
  const token = await getValidToken();

  // 注入已登录状态
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(({ token, userStr }) => {
    localStorage.setItem('agent-dev-center-token', token);
    localStorage.setItem('agent-dev-center-user', userStr);
  }, {
    token,
    userStr: JSON.stringify({ id: 'test', name: 'CTO', email: 'admin@agent.dev', role: 'admin' }),
  });

  // 导航到首页（在 isPublicMode=true 下会匹配 PublicLayout）
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState('networkidle');

  // 回归断言：PublicLayout 不会 return null
  // 如果 PublicLayout return null，body 会是空的
  const bodyHTML = await page.locator('body').innerHTML();
  expect(bodyHTML.trim().length, 'PublicLayout 不应 return null').toBeGreaterThan(100);

  // 验证有实际的 AppLayout 内容
  const hasAppContent = await page.locator('.ant-layout, [class*="app"]').count();
  expect(hasAppContent, '应渲染 AppLayout 内容').toBeGreaterThan(0);
});

// ============================================================
// 测试 6: 空白 Token 输入校验
// ============================================================
test('空 Token 提交时显示表单校验', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');

  // 不输入任何内容直接点登录
  const loginButton = page.locator('button:has-text("Token 登录"), button:has-text("登录")').first();
  await loginButton.click();

  // 应显示表单校验信息
  const validationMsg = page.locator('.ant-form-item-explain-error, text=请输入');
  await expect(validationMsg, '应显示表单校验提示').toBeVisible({ timeout: 3000 });
});
