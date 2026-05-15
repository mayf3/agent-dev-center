import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';

/**
 * SSO 认证中间件
 *
 * 支持 Authorization header 和 cookie 传 token。
 * Query param (?token=xxx) 仅在开发环境启用（生产环境禁止，避免 token 暴露在日志/浏览器历史中）。
 */
export async function ssoAuth(req: Request, _res: Response, next: NextFunction) {
  const token =
    req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.cookies?.sso_token ??
    (env.NODE_ENV === 'development' ? (req.query.token as string | undefined) : undefined);

  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  let payload: { sub: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, '登录已过期，请重新登录');
    }
    throw new HttpError(401, 'Token 无效');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    throw new HttpError(401, '用户不存在或已被禁用');
  }

  req.user = user;
  next();
}

/**
 * SSO Token 提取中间件（非阻塞）
 *
 * 尝试从请求中提取 SSO token，如果有效则注入 req.user。
 * 如果无效或缺失，不报错，继续执行（用于公开页面也能识别已登录用户）。
 * Query param 仅开发环境启用。
 */
export async function ssoOptional(req: Request, _res: Response, next: NextFunction) {
  const token =
    req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.cookies?.sso_token ??
    (env.NODE_ENV === 'development' ? (req.query.token as string | undefined) : undefined);

  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true },
    });
    if (user) {
      req.user = user;
    }
  } catch {
    // token 无效，忽略
  }

  next();
}
