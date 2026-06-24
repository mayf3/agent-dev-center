/**
 * 部署后 Smoke Test 脚本
 *
 * 用途：CI/CD 部署完成后自动运行，验证前端非白屏
 * 运行方式：npx playwright test e2e/smoke.spec.ts --reporter=line
 *
 * 检查项：
 *   1. 首页可访问，HTTP 200
 *   2. 页面非白屏（有可见内容）
 *   3. JS/CSS 资源加载成功
 *   4. 登录页可访问
 *   5. API 健康检查
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://{your-server-ip}';
const API_URL = process.env.E2E_API_URL || `${BASE_URL}/api`;

test('API 健康检查', async ({ request }) => {
  const res = await request.get(`${API_URL}/health`);
  expect(res.ok(), `API /health 应返回 200，实际: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.ok, 'API 健康检查应返回 ok:true').toBe(true);
});

test('首页返回 200 且非白屏', async ({ page }) => {
  const res = await page.goto(BASE_URL + '/');
  expect(res?.status(), '首页 HTTP 状态应为 200').toBe(200);

  await page.waitForLoadState('networkidle');

  // 检查非白屏：body 内有可见文本
  const bodyText = await page.locator('body').innerText({ timeout: 5000 });
  expect(bodyText.trim().length, '首页不应白屏').toBeGreaterThan(10);

  // 检查 React 挂载点有内容
  const rootContent = await page.locator('#root').innerHTML();
  expect(rootContent.length, '#root 应有 DOM 内容').toBeGreaterThan(100);
});

test('登录页返回 200 且非白屏', async ({ page }) => {
  const res = await page.goto(BASE_URL + '/login');
  expect(res?.status(), '登录页 HTTP 状态应为 200').toBe(200);

  await page.waitForLoadState('networkidle');

  // 应有登录表单
  const hasForm = await page.locator('form, .ant-form').count();
  expect(hasForm, '登录页应有表单').toBeGreaterThan(0);

  // 应有 "Agent开发中心" 标题
  const hasTitle = await page.locator('text=Agent开发中心').count();
  expect(hasTitle, '应显示系统标题').toBeGreaterThan(0);
});

test('静态资源无 404 错误', async ({ page }) => {
  const failedRequests: string[] = [];

  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(BASE_URL + '/');
  await page.waitForLoadState('networkidle');

  // 过滤掉 API 401（正常，未登录）和外部资源
  const criticalFailures = failedRequests.filter(
    (r) => !r.includes('/api/') && !r.includes('analytics')
  );

  expect(
    criticalFailures,
    `关键资源不应有 4xx/5xx 错误: ${criticalFailures.join('; ')}`
  ).toHaveLength(0);
});

test('页面无 JS 控制台错误', async ({ page }) => {
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(BASE_URL + '/');
  await page.waitForLoadState('networkidle');

  // 过滤已知的非关键错误（如第三方库警告）
  const criticalErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('DevTools') &&
      !e.includes('ResizeObserver')
  );

  expect(
    criticalErrors.length,
    `不应有关键 JS 错误: ${criticalErrors.join('; ')}`
  ).toBe(0);
});
