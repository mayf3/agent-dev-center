import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

interface TokenPayload {
  sub: string;
}

export function signAccessToken(user: Express.AuthUser): string {
  return jwt.sign({ sub: user.id }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn']
  });
}

export function signRefreshToken(user: Express.AuthUser): string {
  return jwt.sign({ sub: user.id }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn']
  });
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
}

export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const authorization = req.header('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  // 尝试用户 JWT（JWT_SECRET）
  let payload: TokenPayload;
  let isAgentToken = false;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    // 尝试 Agent SSO JWT（JWT_SECRET_SSO）
    try {
      payload = jwt.verify(token, env.JWT_SECRET_SSO) as TokenPayload & { type?: string };
      isAgentToken = true;
    } catch {
      throw new HttpError(401, '登录状态已失效');
    }
  }

  if (isAgentToken) {
    // Agent JWT: sub 是 agentId，查 User 表 by agentId
    const user = await prisma.user.findFirst({
      where: { agentId: payload.sub },
      select: { id: true, name: true, email: true, role: true }
    });
    if (!user) {
      throw new HttpError(401, 'Agent 不存在或已被禁用');
    }
    req.user = user;
  } else {
    // 用户 JWT: sub 是 UUID
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true }
    });
    if (!user) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }
    req.user = user;
  }

  next();
});

export function requireRoles(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new HttpError(401, '请先登录'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, '当前角色无权执行此操作'));
    }

    return next();
  };
}
