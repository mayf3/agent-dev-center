/**
 * SSO 统一认证中间件模板
 *
 * 使用方法：
 * 1. 将此文件复制到你的项目 src/middleware/sso-auth.ts
 * 2. npm install jsonwebtoken @types/jsonwebtoken
 * 3. 在 Express app 中: app.use(ssoAuth)
 *
 * 配置环境变量:
 * SSO_JWT_SECRET = (ADC 的 JWT_SECRET_SSO 值)
 *
 * 详见: docs/sso-integration-guide.md
 */

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

// ─── 类型定义 ────────────────────────────────────────────────

export interface SsoUser {
  id: string;
  agentId?: string;
  name?: string;
  role?: string;
  permissions?: string[];
}

declare global {
  namespace Express {
    interface Request {
      ssoUser?: SsoUser;
    }
  }
}

// ─── 配置 ────────────────────────────────────────────────────

/**
 * 从 process.env 中读取 SSO_JWT_SECRET
 * 如果 SSO_JWT_SECRET 未设置，中间件直接跳过（不阻塞服务启动）
 */
const SSO_JWT_SECRET = process.env.SSO_JWT_SECRET || '';

// ─── 辅助函数 ────────────────────────────────────────────────

function extractToken(req: Request): string | undefined {
  return req.header('authorization')?.replace(/^Bearer\s+/i, '');
}

function verifySsoToken(token: string): SsoUser | null {
  try {
    const payload = jwt.verify(token, SSO_JWT_SECRET) as {
      sub: string;
      name?: string;
      role?: string;
      permissions?: string[];
    };
    return {
      id: payload.sub,
      agentId: payload.sub,
      name: payload.name,
      role: payload.role,
      permissions: payload.permissions,
    };
  } catch {
    return null;
  }
}

// ─── 中间件 ──────────────────────────────────────────────────

/**
 * 非阻塞 SSO 认证
 *
 * 有 token 则注入 req.ssoUser，无 token 或无效时不报错。
 * 适合公开页面也能识别已登录用户。
 *
 * 用法:
 *   app.use(ssoAuth);
 */
export function ssoAuth(req: Request, _res: Response, next: NextFunction) {
  if (!SSO_JWT_SECRET) return next();

  const token = extractToken(req);
  if (!token) return next();

  const user = verifySsoToken(token);
  if (user) req.ssoUser = user;

  next();
}

/**
 * 阻塞 SSO 认证
 *
 * 无有效 token 直接返回 401。
 * 适合纯 API 服务。
 *
 * 用法:
 *   app.use('/api', ssoRequired);
 */
export function ssoRequired(req: Request, res: Response, next: NextFunction) {
  if (!SSO_JWT_SECRET) return next();

  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: '请先通过 SSO 登录' });

  const user = verifySsoToken(token);
  if (!user) return res.status(401).json({ error: 'SSO Token 无效或已过期' });

  req.ssoUser = user;
  next();
}

/**
 * 权限守卫
 *
 * 检查当前用户是否有指定权限（返回 403）。
 * admin 权限自动通过。
 *
 * 用法:
 *   router.delete('/items/:id', ssoRequirePermission('todo:write'), handler);
 */
export function ssoRequirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.ssoUser) {
      return res.status(401).json({ error: '请先通过 SSO 登录' });
    }

    const perms = req.ssoUser.permissions ?? [];
    if (perms.includes('admin') || perms.includes(permission)) {
      return next();
    }

    return res.status(403).json({ error: `权限不足: 需要 ${permission}` });
  };
}

/**
 * SSO 状态端点
 *
 * 返回当前认证状态。可直接注册到 Express app。
 *
 * 用法:
 *   app.get('/api/auth/sso/status', ssoStatusHandler);
 */
export function ssoStatusHandler(req: Request, res: Response) {
  if (req.ssoUser) {
    res.json({
      authenticated: true,
      userId: req.ssoUser.id,
      name: req.ssoUser.name,
      permissions: req.ssoUser.permissions,
    });
  } else {
    res.json({ authenticated: false });
  }
}
