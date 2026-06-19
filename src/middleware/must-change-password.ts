import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';

/**
 * mustChangePassword 拦截中间件
 *
 * 当用户 mustChangePassword=true 时，只允许访问改密码相关接口，其他所有 API 返回 403。
 * 放行的路径：
 *   - POST /api/auth/change-password
 *   - POST /api/auth/force-change-password
 *   - POST /api/auth/login（登录本身不需要 token，不需要拦截）
 *   - POST /api/auth/register
 *   - POST /api/auth/refresh
 *   - GET  /api/health
 *
 * 使用方式：在 authRequired 之后全局挂载
 */

// 允许 mustChangePassword=true 用户访问的路径
const ALLOWED_PATHS: Set<string> = new Set([
  '/api/auth/change-password',
  '/api/auth/force-change-password',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/reset-password',
  '/api/health',
]);

export function mustChangePasswordGuard(req: Request, _res: Response, next: NextFunction): void {
  // 未认证用户跳过（由 authRequired 处理）
  if (!req.user) {
    return next();
  }

  // 检查路径是否在白名单中
  const path = req.path;
  if (ALLOWED_PATHS.has(path)) {
    return next();
  }

  // 检查用户是否需要强制改密码
  // req.user 由 authRequired 中间件注入，但 Express 类型定义中 may not have mustChangePassword
  const user = req.user as Express.AuthUser & { mustChangePassword?: boolean };
  if (user.mustChangePassword) {
    return next(new HttpError(403, '账号需要强制修改密码后才能使用，请先调用 POST /api/auth/force-change-password'));
  }

  next();
}
