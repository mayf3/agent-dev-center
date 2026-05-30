import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions, JwtPayload } from 'jsonwebtoken';
import type { UserRole, InternalRole } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

interface TokenPayload extends JwtPayload {
  sub: string;
  type?: 'access' | 'refresh';
  iss?: string;
  aud?: string;
  jti?: string;
}

// JWT 配置常量
const JWT_ISSUER = 'agent-dev-center';
const JWT_AUDIENCE = 'adc-api';
const JWT_VERSION = 'v1';

/**
 * 生成访问令牌 (87c0d549 - JWT加固)
 * 包含: sub(用户ID), iss(签发者), aud(受众), jti(令牌ID), type(令牌类型)
 */
export function signAccessToken(user: Express.AuthUser): string {
  const now = Math.floor(Date.now() / 1000);
  const jti = `${user.id}-${now}-${Math.random().toString(36).slice(2)}`;
  
  return jwt.sign(
    {
      sub: user.id,
      name: user.name,
      role: user.role,
      okrRole: user.okrRole,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      jti,
      type: 'access',
      version: JWT_VERSION
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn']
    } as SignOptions
  );
}

/**
 * 生成刷新令牌
 */
export function signRefreshToken(user: Express.AuthUser): string {
  const now = Math.floor(Date.now() / 1000);
  const jti = `${user.id}-${now}-refresh-${Math.random().toString(36).slice(2)}`;
  
  return jwt.sign(
    {
      sub: user.id,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      jti,
      type: 'refresh',
      version: JWT_VERSION
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn']
    } as SignOptions
  );
}

/**
 * 验证刷新令牌
 */
export function verifyRefreshToken(token: string): TokenPayload {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
  
  // 验证令牌类型
  if (payload.type !== 'refresh') {
    throw new HttpError(401, '令牌类型错误');
  }
  
  return payload;
}

/**
 * 统一 JWT 验证中间件 (87c0d549 - 全平台统一JWT鉴权加固)
 *
 * 支持四种令牌来源：
 * 1. auth-service JWT (AUTH_JWT_SECRET - 统一鉴权服务)
 * 2. 用户访问令牌 (JWT_SECRET - ADC 自签)
 * 3. Agent SSO令牌 (JWT_SECRET_SSO - 应与JWT_SECRET保持一致)
 * 4. 管理员令牌 (特殊权限)
 *
 * 安全增强：
 * - 验证 issuer (签发者)
 * - 验证 audience (受众)
 * - 验证令牌类型
 * - 记录令牌版本 (用于批量失效)
 * - 详细的错误信息
 */
export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const authorization = req.header('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  let payload: TokenPayload & { source?: string; permissions?: string[]; okrRole?: string };
  let isAgentToken = false;
  let isAuthServiceToken = false;
  let verificationError: Error | null = null;

  // 第一优先级: 尝试 auth-service JWT (AUTH_JWT_SECRET)
  try {
    payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE
    }) as TokenPayload & { source?: string; permissions?: string[] };
    isAuthServiceToken = true;
  } catch (err) {
    verificationError = err as Error;

    // 第二优先级: 尝试用户JWT (JWT_SECRET)
    try {
      payload = jwt.verify(token, env.JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE
      }) as TokenPayload;
    } catch (err2) {
      // 第三优先级: 尝试 Agent SSO JWT (JWT_SECRET_SSO)
      try {
        payload = jwt.verify(token, env.JWT_SECRET_SSO, {
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          // 允许SSO令牌跳过issuer/audience检查以兼容旧版本
          ignoreExpiration: false
        }) as TokenPayload & { type?: string };
        isAgentToken = true;
      } catch {
        throw new HttpError(401, `登录状态已失效: ${verificationError?.message || '无效令牌'}`);
      }
    }
  }

  // 验证令牌类型（如果不是SSO或auth-service令牌）
  if (!isAgentToken && !isAuthServiceToken && payload.type !== 'access' && payload.type !== undefined) {
    throw new HttpError(401, '令牌类型错误，请使用访问令牌');
  }

  // 检查令牌版本 (用于未来批量失效)
  if (payload.version && payload.version !== JWT_VERSION) {
    throw new HttpError(401, '令牌版本已过期，请重新登录');
  }

  if (isAgentToken) {
    // Agent JWT: sub 是 agentId，查 User 表 by agentId
    const user = await prisma.user.findFirst({
      where: { agentId: payload.sub },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true, permissions: true, mustChangePassword: true }
    });
    if (!user) {
      throw new HttpError(401, 'Agent 不存在或已被禁用');
    }
    req.user = user as Express.AuthUser;
  } else if (isAuthServiceToken) {
    // auth-service JWT: sub 是 UUID, source 可能是 'email' 或 'agent-token'
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true, permissions: true, mustChangePassword: true }
    });
    if (!user) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }
    req.user = user as Express.AuthUser;
  } else {
    // 用户 JWT: sub 是 UUID
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true, permissions: true, mustChangePassword: true }
    });
    if (!user) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }
    req.user = user as Express.AuthUser;
  }

  next();
});

export function requireRoles(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new HttpError(401, '请先登录'));
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return next(new HttpError(403, '当前角色无权执行此操作'));
    }

    return next();
  };
}
