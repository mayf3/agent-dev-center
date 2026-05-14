import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { signAccessToken, signRefreshToken } from '../middleware/auth.js';
import { ssoLoginSchema, ssoVerifySchema, ssoTokenSchema } from '../schemas/sso.js';
import { env } from '../config/env.js';

export const ssoRouter = Router();

interface ServiceInfo {
  name: string;
  displayName: string;
  url: string | null;
  status: string;
}

/**
 * POST /api/auth/sso/login
 *
 * SSO 统一登录。兼容原有 /auth/login，额外返回：
 * - services: 用户可访问的服务列表
 * - redirectUrl: 如果指定了 redirectService，返回带 token 的跳转 URL
 */
ssoRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { body } = ssoLoginSchema.parse({ body: req.body });

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });
    if (!user) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const passwordMatches = await bcrypt.compare(body.password, user.password);
    if (!passwordMatches) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    // 签发 token
    const accessToken = signAccessToken(safeUser);
    const refreshToken = signRefreshToken(safeUser);

    // 获取所有在线服务
    const services = await prisma.service.findMany({
      where: { status: { in: ['online', 'unknown'] } },
      select: { name: true, displayName: true, remoteUrl: true, localUrl: true, status: true },
      orderBy: { displayName: 'asc' },
    });

    const serviceList: ServiceInfo[] = services.map((s) => ({
      name: s.name,
      displayName: s.displayName,
      url: s.remoteUrl ?? s.localUrl ?? null,
      status: s.status,
    }));

    // 构建 redirect URL
    let redirectUrl: string | null = null;
    if (body.redirectService) {
      const target = services.find((s) => s.name === body.redirectService);
      if (target) {
        const baseUrl = target.remoteUrl ?? target.localUrl;
        if (baseUrl) {
          const url = new URL(baseUrl);
          url.searchParams.set('token', accessToken);
          redirectUrl = url.toString();
        }
      }
    }

    res.json({
      accessToken,
      refreshToken,
      user: safeUser,
      services: serviceList,
      redirectUrl,
    });
  })
);

/**
 * GET /api/auth/sso/verify
 *
 * 第三方服务调用此端点验证 token 有效性。
 * 需要 Authorization: Bearer <token> 或 ?token=<token>
 *
 * 返回用户信息 + token 剩余有效期
 */
ssoRouter.get(
  '/verify',
  asyncHandler(async (req, res) => {
    // 支持两种 token 传递方式
    const token =
      req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
      (req.query.token as string | undefined);

    if (!token) {
      throw new HttpError(401, '缺少 token');
    }

    let payload: { sub: string; iat?: number; exp?: number };
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as typeof payload;
    } catch (err) {
      const message = err instanceof jwt.TokenExpiredError ? 'Token 已过期' : 'Token 无效';
      throw new HttpError(401, message);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!user) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }

    // 计算 token 剩余有效期
    const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
    const expiresIn = payload.exp ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000)) : null;

    res.json({
      valid: true,
      user,
      expiresAt,
      expiresIn,
    });
  })
);

/**
 * POST /api/auth/sso/token
 *
 * 为指定服务签发 scoped token。
 * 需要先通过 authRequired 认证。
 */
ssoRouter.post(
  '/token',
  asyncHandler(async (req, res) => {
    // 需要已认证
    if (!req.user) {
      throw new HttpError(401, '请先登录');
    }

    const { body } = ssoTokenSchema.parse({ body: req.body });

    // 验证目标服务已注册
    const service = await prisma.service.findUnique({
      where: { name: body.service },
    });
    if (!service) {
      throw new HttpError(404, `服务 "${body.service}" 未注册`);
    }

    // 签发 scoped token
    const expiresIn = body.expiresIn ?? '24h';
    const scopedToken = jwt.sign(
      { sub: req.user.id, scope: body.service },
      env.JWT_SECRET,
      { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
    );

    res.json({
      token: scopedToken,
      service: body.service,
      expiresIn,
    });
  })
);
