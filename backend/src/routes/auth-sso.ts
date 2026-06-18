/**
 * POST /api/auth/sso-login — SSO 统一登录
 *
 * 验证用户凭证，优先通过 auth-service 统一签发 JWT（iss=auth-service, aud=unified-platform）。
 * auth-service 不可用时 fallback 到本地签发。
 * 
 * Extracted from auth.ts (18e9c0d2: 拆分 auth.ts <500 行限制)
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { signAccessToken, signRefreshToken } from '../middleware/auth.js';

export const router = Router();
export const mountPath = '/api/auth';

router.post(
  '/sso-login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new HttpError(400, 'email 和 password 必填');
    }

    // 尝试调用 auth-service 验证
    try {
      const authServiceUrl = env.AUTH_SERVICE_URL;
      const response = await fetch(`${authServiceUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json() as { accessToken?: string; user?: { id: string; name: string; email: string; role: string } };

        // auth-service 验证成功，同步/查找本地用户
        let localUser = await prisma.user.findUnique({ where: { email } });
        if (!localUser) {
          localUser = await prisma.user.create({
            data: {
              name: data.user?.name || email.split('@')[0],
              email,
              password: 'sso-managed',
              role: (data.user?.role as any) || 'developer',
              mustChangePassword: false,
            },
          });
        }

        // 18e9c0d2 fix: 优先使用 auth-service 签发的 JWT（iss=auth-service, aud=unified-platform）
        // 确保下游服务（todo/OKR）能正确验证
        const safeUser = {
          id: localUser.id,
          name: localUser.name,
          email: localUser.email,
          role: localUser.role,
          internalRole: localUser.internalRole,
          okrRole: localUser.okrRole,
        };

        const accessToken = data.accessToken ?? signAccessToken(safeUser as any);
        const refreshToken = signRefreshToken(safeUser as any);

        prisma.user.update({ where: { id: localUser.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

        return res.json({
          accessToken,
          refreshToken,
          user: { ...safeUser, mustChangePassword: false },
          source: 'auth-service',
        });
      }
    } catch (err) {
      console.warn('[SSO] auth-service unavailable, falling back to local auth:', (err as Error).message);
    }

    // Fallback: 本地验证
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(401, '邮箱或密码不正确');
    }
    if (user.password !== password) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      internalRole: user.internalRole,
      okrRole: user.okrRole,
    };

    const accessToken = signAccessToken(safeUser as any);
    const refreshToken = signRefreshToken(safeUser as any);

    res.json({ accessToken, refreshToken, user: safeUser, source: 'local-fallback' });
  })
);
