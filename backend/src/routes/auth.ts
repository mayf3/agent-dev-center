import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, authRequired } from '../middleware/auth.js';
import { loginSchema, registerSchema, changePasswordSchema } from '../schemas/auth.js';
import { env } from '../config/env.js';
import { UserRole, InternalRole } from '@prisma/client';

export const authRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSafeUser(user: any): Express.AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    internalRole: user.internalRole,
    okrRole: user.okrRole ?? undefined,
  };
}

// GET /auth/me - Token 验证，返回当前用户信息
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const authorization = req.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

    if (!token) {
      throw new HttpError(401, '请先登录');
    }

    let payload: { sub: string };
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    } catch {
      throw new HttpError(401, 'Token 已失效，请重新登录');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true }
    });

    if (!user) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }

    res.json(toSafeUser(user));
  })
);

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { body } = registerSchema.parse({ body: req.body });

    // 邀请码校验：如果配置了 REGISTER_INVITE_CODE，则必须匹配
    if (env.REGISTER_INVITE_CODE) {
      if (body.inviteCode !== env.REGISTER_INVITE_CODE) {
        throw new HttpError(403, '邀请码无效，无法注册');
      }
    }
    const password = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password,
        role: body.role
      },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true }
    });

    const accessToken = signAccessToken(user as Express.AuthUser);
    const refreshToken = signRefreshToken(user as Express.AuthUser);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: toSafeUser(user)
    });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { body } = loginSchema.parse({ body: req.body });
    const user = await prisma.user.findUnique({
      where: { email: body.email }
    });

    if (!user) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const passwordMatches = await bcrypt.compare(body.password, user.password);
    if (!passwordMatches) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const safeUser = toSafeUser({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      internalRole: user.internalRole,
      okrRole: user.okrRole
    });

    const accessToken = signAccessToken(safeUser);
    const refreshToken = signRefreshToken(safeUser);

    res.json({
      accessToken,
      refreshToken,
      user: safeUser
    });
  })
);

authRouter.post(
  '/change-password',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = changePasswordSchema.parse({ body: req.body });
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new HttpError(401, '用户不存在');
    }

    const passwordMatches = await bcrypt.compare(body.oldPassword, user.password);
    if (!passwordMatches) {
      throw new HttpError(401, '当前密码不正确');
    }

    const hashedPassword = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.json({ message: '密码修改成功' });
  })
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken) {
      throw new HttpError(401, '缺少 refreshToken');
    }

    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, 'Refresh token 已失效，请重新登录');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true }
    });

    if (!user) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }

    const accessToken = signAccessToken(user as Express.AuthUser);
    const newRefreshToken = signRefreshToken(user as Express.AuthUser);

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
      user: toSafeUser(user)
    });
  })
);
