/**
 * 路由自动注册器
 *
 * 扫描 routes/ 目录，按文件路径推断挂载路径，自动注册到 Express app。
 *
 * 约定：
 *   routes/auth.ts               → /api/auth
 *   routes/requirements/index.ts  → /api/requirements
 *   routes/marketplace/foo.ts     → /api/marketplace/foo
 *   routes/agent-sso/index.ts     → /api/agent-sso
 *
 * 特殊路由（手动例外）：
 *   reportsRouter 挂载到 /api/requirements/:id/reports 和 /api/reports
 *   authRouter    需要 authLimiter
 *   ssoRouter     需要 authLimiter
 *   marketplace/* 各自有特定路径前缀
 */

import { readdirSync } from 'node:fs';
import { join, relative as pathRelative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, RequestHandler, Router } from 'express';
import rateLimit from 'express-rate-limit';

// ─── 路径常量 ────────────────────────────────────────────────

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)));

// ─── 路由元数据 ──────────────────────────────────────────────

interface RouteModule {
  /** Express Router 实例 */
  router: Router;
  /** 挂载路径（覆盖自动推断） */
  mountPath?: string;
  /** 可选中间件 */
  middleware?: RequestHandler[];
}

// ─── 手动例外路由（因为这些路由的挂载路径与文件名推断不一致） ──

interface ManualRoute {
  file: string;           // 相对于 routes/ 的路径，不含扩展名
  mountPaths: string[];   // 要挂载的路径
  middleware?: RequestHandler[];
  /** true = 文件不直接导出 router，由 register.ts 特殊处理 */
  custom?: boolean;
}

// 登录/注册速率限制：15分钟内最多50次请求
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: '请求过于频繁，请稍后再试'
});

const MANUAL_ROUTES: ManualRoute[] = [
  // authRouter → /api/auth（带 authLimiter）
  { file: 'auth', mountPaths: ['/api/auth'], middleware: [authLimiter] },
  // ssoRouter → /api/auth/sso（带 authLimiter）
  { file: 'sso', mountPaths: ['/api/auth/sso'], middleware: [authLimiter] },
  // reportsRouter → 双挂载
  { file: 'reports', mountPaths: ['/api/requirements/:id/reports', '/api/reports'] },
  // agent-sso/index → /api/auth/agent
  { file: 'agent-sso/index', mountPaths: ['/api/auth/agent'] },
  // marketplace 各路由有独立路径前缀
  { file: 'marketplace/marketplace-agents', mountPaths: ['/api/marketplace/agents'] },
  { file: 'marketplace/marketplace-tasks', mountPaths: ['/api/marketplace/tasks'] },
  { file: 'marketplace/marketplace-deliverables', mountPaths: ['/api/marketplace/deliverables'] },
  { file: 'marketplace/marketplace-uploads', mountPaths: ['/api/marketplace/uploads'] },
  { file: 'marketplace/marketplace-automation', mountPaths: ['/api/marketplace'] },
  // comments → 挂载到 /api/requirements 下一层
  { file: 'comments', mountPaths: ['/api/requirements'] },
];

// ─── 子模块黑名单（这些文件不直接导出路由，而是被 index.ts 组装） ──
const SKIP_FILES = new Set([
  'marketplace/index.ts',
  'goals/core.ts',
  'goals/lifecycle.ts',
  'goals/permissions.ts',
  'requirements/core.ts',
  'requirements/attachments.ts',
  'requirements/decompose.ts',
  'requirements/dependency-graph.ts',
  'requirements/pipeline.ts',
  'requirements/review.ts',
  'requirements/status.ts',
  'requirements/workflow.ts',
  'requirements/utils.ts',
  'agents/core.ts',
  'agents/reports.ts',
  'agents/okr.ts',
  'agent-sso/auth.ts',
  'agent-sso/admin.ts',
]);

// ─── 文件路径 → API 路径推断 ─────────────────────────────────

function inferMountPath(relativePath: string): string | null {
  // 去掉 .ts / .js 扩展名
  let name = relativePath.replace(/\.(ts|js)$/, '');

  // 跳过 index 文件本身（但保留目录路径）
  // e.g. routes/foo/index.ts → /api/foo
  if (name.endsWith('/index')) {
    name = name.slice(0, -6); // 去掉 '/index'
  }

  // 空路径 = 根 routes/ 目录本身（跳过）
  if (!name) return null;

  // 黑名单中的文件跳过
  if (SKIP_FILES.has(relativePath)) return null;

  // 转换成 kebab-case API 路径
  return `/api/${name}`;
}

// ─── 扫描并注册 ──────────────────────────────────────────────

export async function registerRoutes(app: Express): Promise<void> {
  const imported = new Set<string>();

  // 1. 处理手动例外路由
  for (const route of MANUAL_ROUTES) {
    if (imported.has(route.file)) continue;
    imported.add(route.file);

    const modPath = `./${route.file}.js`;
    try {
      const mod = await import(modPath) as Record<string, unknown>;
      // 查找 router 导出（支持命名导出和默认导出）
      const router = findRouterExport(mod);
      if (!router) {
        console.warn(`[register] 未找到 router 导出: ${route.file}`);
        continue;
      }
      for (const mountPath of route.mountPaths) {
        if (route.middleware) {
          app.use(mountPath, ...route.middleware, router);
        } else {
          app.use(mountPath, router);
        }
      }
    } catch (err) {
      console.error(`[register] 加载失败: ${route.file}`, err);
    }
  }

  // 2. 扫描 routes 目录自动注册剩余路由
  const files = scanRouteFiles(ROUTES_DIR);
  for (const file of files) {
    if (imported.has(file.relative)) continue;
    imported.add(file.relative);

    const mountPath = inferMountPath(file.relative);
    if (!mountPath) continue;

    const modPath = `./${file.relative.replace(/\.ts$/, '.js')}`;
    try {
      const mod = await import(modPath) as Record<string, unknown>;
      const router = findRouterExport(mod);
      if (!router) continue;
      app.use(mountPath, router);
    } catch (err) {
      console.error(`[register] 加载失败: ${file.relative}`, err);
    }
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────

function findRouterExport(mod: Record<string, unknown>): Router | null {
  // 优先查找命名导出（xxxRouter 模式）
  for (const [key, value] of Object.entries(mod)) {
    if (key.endsWith('Router') && isRouter(value)) {
      return value as Router;
    }
  }
  // 默认导出
  if (mod.default && isRouter(mod.default)) {
    return mod.default as Router;
  }
  return null;
}

function isRouter(val: unknown): val is Router {
  return (
    typeof val === 'function' &&
    'use' in (val as object) &&
    'get' in (val as object) &&
    'post' in (val as object)
  );
}

interface ScannedFile {
  relative: string;
  fullPath: string;
}

function scanRouteFiles(dir: string, baseDir = dir): ScannedFile[] {
  const results: ScannedFile[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = pathRelative(baseDir, fullPath);

      if (entry.isDirectory()) {
        results.push(...scanRouteFiles(fullPath, baseDir));
      } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
        results.push({ relative: relPath, fullPath });
      }
    }
  } catch {
    // 目录不存在时静默跳过
  }

  return results;
}
