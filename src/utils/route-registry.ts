/**
 * route-registry.ts — 约定优于配置的路由自动注册器
 * 
 * 扫描 backend/src/routes/ 目录，自动加载所有路由模块。
 * 每个路由文件需导出：
 *   - router: Express Router（路由处理器）
 *   - mountPath: string（挂载路径，如 '/api/auth'）
 * 
 * 用法（在 app.ts 中）：
 *   import { autoRegisterRoutes } from './utils/route-registry.js';
 *   await autoRegisterRoutes(app);
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, Router } from 'express';

interface RouteModule {
  router: Router;
  mountPath: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = path.resolve(__dirname, '..', 'routes');

/**
 * 扫描 routes/ 目录并自动注册所有路由模块。
 * 仅加载有 mountPath 导出的模块 — 工具函数文件（如 core-crud.ts，utils.ts）被跳过。
 */
export async function autoRegisterRoutes(app: Express): Promise<void> {
  if (!fs.existsSync(ROUTES_DIR)) {
    console.warn(`[route-registry] Routes directory not found: ${ROUTES_DIR}`);
    return;
  }

  const entries = fs.readdirSync(ROUTES_DIR, { withFileTypes: true });
  const loaded: string[] = [];

  // 1. 扫描子目录（如 marketplace/、requirements/、goals/ 等）
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const subDir = path.resolve(ROUTES_DIR, entry.name);
    const subEntries = fs.readdirSync(subDir);

    for (const file of subEntries) {
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
      // 跳过 __tests__ 和内部工具文件
      if (entry.name === '__tests__') continue;

      const filePath = path.resolve(subDir, file);
      const mod = await tryImport(filePath);
      if (mod && 'mountPath' in mod && 'router' in mod) {
        const { mountPath, router } = mod as unknown as RouteModule;
        app.use(mountPath, router);
        loaded.push(`${mountPath} <- ${entry.name}/${file}`);
      }
    }
  }

  // 2. 扫描 routes/ 下直接的文件
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue;

    const filePath = path.resolve(ROUTES_DIR, entry.name);
    const mod = await tryImport(filePath);
    if (mod && 'mountPath' in mod && 'router' in mod) {
      const { mountPath, router } = mod as unknown as RouteModule;
      app.use(mountPath, router);
      loaded.push(`${mountPath} <- ${entry.name}`);
    }
  }

  console.log(`[route-registry] ✓ 自动加载 ${loaded.length} 个路由模块:`);
  for (const r of loaded.sort()) {
    console.log(`  ${r}`);
  }
}

async function tryImport(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    // 转换为 file:// URL（ESM 需要完整路径）
    const fileUrl = pathToFileURL(filePath);
    const mod = await import(fileUrl.href);
    return mod;
  } catch (err: unknown) {
    // 仅警告非致命错误，不阻止启动
    const fileName = path.basename(filePath);
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('Cannot find module') && !msg.includes('ERR_MODULE_NOT_FOUND')) {
      // 只有真正有 mountPath 的文件报错才警告
      console.warn(`[route-registry] ⚠ 加载 ${fileName} 失败: ${msg}`);
    }
    return null;
  }
}

/**
 * 将文件系统路径转换为 file:// URL
 * 兼容跨平台（macOS/Linux/Windows）
 */
function pathToFileURL(filePath: string): URL {
  const resolved = path.resolve(filePath);
  // Node.js v20.11+ 有内置 pathToFileURL，但这里手动处理确保兼容
  const url = new URL('file://');
  // macOS/Linux: /Users/xxx -> file:///Users/xxx
  if (resolved.startsWith('/')) {
    url.pathname = resolved;
  } else {
    url.pathname = `/${resolved.replace(/\\/g, '/')}`;
  }
  return url;
}
