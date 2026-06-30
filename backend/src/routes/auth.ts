import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, authRequired } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { loginSchema, registerSchema, changePasswordSchema, adminResetPasswordSchema, batchRegisterSchema, forceChangePasswordSchema } from '../schemas/auth.js';
import { UserRole, InternalRole } from '@prisma/client';

// SSO 用户密码占位符 — 非真实密码，仅供标识 SSO 托管用户
const SSO_MANAGED_PASSWORD = 'sso-managed';

// 登录/注册速率限制：15分钟内最多50次请求
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: '请求过于频繁，请稍后再试'
});

export const authRouter = Router();
authRouter.use(authLimiter);

// ---------------------------------------------------------------------------
// Password generation utility — 24-char hex (12 random bytes)
// ---------------------------------------------------------------------------
function generatePassword(): string {
  return crypto.randomBytes(12).toString('hex');
}

// ---------------------------------------------------------------------------
// IP-based login anomaly detection (in-memory, 10-min sliding window)
// ---------------------------------------------------------------------------
const ipLoginWindow = new Map<string, { emails: Set<string>; firstAt: number }>();
const IP_LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const IP_LOGIN_ALERT_THRESHOLD = 3;

function recordIpLogin(ip: string, email: string): void {
  const now = Date.now();
  let entry = ipLoginWindow.get(ip);
  if (!entry || now - entry.firstAt > IP_LOGIN_WINDOW_MS) {
    entry = { emails: new Set(), firstAt: now };
    ipLoginWindow.set(ip, entry);
  }
  entry.emails.add(email);
  if (entry.emails.size >= IP_LOGIN_ALERT_THRESHOLD) {
    console.warn(
      `[SECURITY-ALERT] IP ${ip} logged in with ${entry.emails.size} different accounts within 10 min: ${[...entry.emails].join(', ')}`
    );
  }
}

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
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true, mustChangePassword: true, enabled: true }
    });

    if (!user || !user.enabled) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }

    const { mustChangePassword, enabled: _enabled, ...safeUser } = user;
    res.json({ ...toSafeUser(safeUser), mustChangePassword });
  })
);

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { body } = registerSchema.parse({ body: req.body });

    // e03c7b39: 邀请码校验 — 必须配置 REGISTER_INVITE_CODE 且匹配才能注册
    // 如果未配置 REGISTER_INVITE_CODE，禁止注册（防止开放注册漏洞）
    if (!env.REGISTER_INVITE_CODE) {
      throw new HttpError(403, '注册已关闭，请联系管理员创建账号');
    }
    if (body.inviteCode !== env.REGISTER_INVITE_CODE) {
      throw new HttpError(403, '邀请码无效，无法注册');
    }
    // Auto-generate random 24-char password only if not provided
    // bf651cbc: Respect caller-provided password (e.g. agent .env)
    const plainPassword = body.password || generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password: hashedPassword,
        role: body.role,
        mustChangePassword: body.password ? false : true  // 自选密码不需要强制改密
      },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true, mustChangePassword: true }
    });

    const { mustChangePassword, ...safeUser } = user;
    const accessToken = signAccessToken(safeUser as Express.AuthUser);
    const refreshToken = signRefreshToken(safeUser as Express.AuthUser);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: { ...toSafeUser(safeUser), mustChangePassword },
      generatedPassword: body.password ? undefined : plainPassword  // 自选密码不返回
    });
  })
);

// POST /auth/sso-login — 906e46ab: 统一走 auth-service SSO 验证
authRouter.post(
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
        signal: AbortSignal.timeout(5000), // 5s 超时
      });

      if (response.ok) {
        const data = await response.json() as { accessToken?: string; user?: { id: string; name: string; email: string; role: string } };

        // auth-service 验证成功，同步/查找本地用户
        let localUser = await prisma.user.findUnique({ where: { email } });
        if (!localUser) {
          // 自动创建本地用户记录（不含密码）
          localUser = await prisma.user.create({
            data: {
              name: data.user?.name || email.split('@')[0],
              email,
              password: SSO_MANAGED_PASSWORD,
              role: (data.user?.role as any) || 'developer',
              mustChangePassword: false,
            },
          });
        }

        // 用 auth-service 返回的 token 或签发 ADC 自己的 token
        const safeUser = {
          id: localUser.id,
          name: localUser.name,
          email: localUser.email,
          role: localUser.role,
          internalRole: localUser.internalRole,
          okrRole: localUser.okrRole,
        };

        const accessToken = signAccessToken(safeUser as any);
        const refreshToken = signRefreshToken(safeUser as any);

        // 更新最后登录时间
        prisma.user.update({ where: { id: localUser.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

        return res.json({
          accessToken,
          refreshToken,
          user: { ...safeUser, mustChangePassword: false },
          source: 'auth-service',
        });
      }
    } catch (err) {
      // auth-service 不可用，fallback 到本地验证
      console.warn('[SSO] auth-service unavailable, falling back to local auth:', (err as Error).message);
    }

    // Fallback: 本地验证
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(401, '邮箱或密码不正确');
    }
    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      throw new HttpError(401, '邮箱或密码不正确');
    }
    if (!user.enabled) {
      throw new HttpError(401, '用户不存在或已被禁用');
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

    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

    res.json({
      accessToken,
      refreshToken,
      user: { ...safeUser, mustChangePassword: user.mustChangePassword },
      source: 'local',
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
    if (!user.enabled) {
      throw new HttpError(401, '用户不存在或已被禁用');
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

    // IP-based login anomaly detection (d3ae001f)
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    recordIpLogin(clientIp, body.email);

    // Check password expiry from policy
    let mustChangePassword = user.mustChangePassword;
    const policy = await prisma.passwordPolicy.findFirst({ where: { isDefault: true } });
    if (policy?.expiresInDays && user.passwordChangedAt) {
      const daysSinceChange = (Date.now() - user.passwordChangedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceChange > policy.expiresInDays) {
        mustChangePassword = true;
        await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      }
    }

    // Update lastLoginAt (non-blocking)
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

    // 71252d4b: 返回 mustChangePassword 标记，前端据此强制跳转改密码页
    res.json({
      accessToken,
      refreshToken,
      user: { ...safeUser, mustChangePassword }
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
      data: { password: hashedPassword, passwordChangedAt: new Date() }
    });

    res.json({ message: '密码修改成功' });
  })
);

// POST /auth/force-change-password — 71252d4b: 首次登录强制改密码
authRouter.post(
  '/force-change-password',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = forceChangePasswordSchema.parse({ body: req.body });
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpError(401, '用户不存在');
    }

    // Only allow if mustChangePassword is true
    if (!user.mustChangePassword) {
      throw new HttpError(400, '当前无需强制修改密码');
    }

    const hashedPassword = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      }
    });

    res.json({ message: '密码修改成功，可以正常使用' });
  })
);

// POST /auth/batch-register — 71252d4b: 批量注册 Agent 账号 (admin only)
authRouter.post(
  '/batch-register',
  authRequired,
  asyncHandler(async (req, res) => {
    // Only admin can batch register
    if (req.user!.role !== 'admin' && req.user!.internalRole !== 'cto') {
      throw new HttpError(403, '只有管理员可以批量注册 Agent');
    }

    const { body } = batchRegisterSchema.parse({ body: req.body });
    const { agents } = body;

    const results: Array<{ name: string; email: string; password: string }> = [];
    const errors: Array<{ email: string; error: string }> = [];

    for (const agent of agents) {
      try {
        // bf651cbc: Respect caller-provided password (e.g. agent .env)
        const plainPassword = agent.password || generatePassword();
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        await prisma.user.create({
          data: {
            name: agent.name,
            email: agent.email,
            password: hashedPassword,
            role: agent.role,
            mustChangePassword: agent.password ? false : true,  // 自选密码不强制改密
            ...(agent.internalRole ? { internalRole: agent.internalRole } : {})
          }
        });
        results.push({ name: agent.name, email: agent.email, password: plainPassword });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误';
        // Handle duplicate email etc.
        if (msg.includes('Unique')) {
          errors.push({ email: agent.email, error: '邮箱已存在' });
        } else {
          errors.push({ email: agent.email, error: msg });
        }
      }
    }

    res.status(201).json({
      message: `成功注册 ${results.length} 个 Agent${errors.length > 0 ? `，${errors.length} 个失败` : ''}`,
      registered: results,
      errors: errors.length > 0 ? errors : undefined
    });
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
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true, mustChangePassword: true, enabled: true }
    });

    if (!user || !user.enabled) {
      throw new HttpError(401, '用户不存在或已被禁用');
    }

    const { mustChangePassword, enabled: _enabled, ...safeUser } = user;
    const accessToken = signAccessToken(safeUser as Express.AuthUser);
    const newRefreshToken = signRefreshToken(safeUser as Express.AuthUser);

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
      user: { ...toSafeUser(safeUser), mustChangePassword }
    });
  })
);

// POST /auth/admin-reset-password — Admin generates random password for user
authRouter.post(
  '/admin-reset-password',
  authRequired,
  asyncHandler(async (req, res) => {
    // c6c66d14: 铁律 #17 — 账号密码归口 admin（HR 系统），CTO 不再持有重置权限
    if (req.user!.role !== 'admin') {
      throw new HttpError(403, '只有管理员可以重置密码');
    }

    const { body } = adminResetPasswordSchema.parse({ body: req.body });
    const { email } = body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(404, `用户 ${email} 不存在`);
    }

    // Auto-generate random password (d3ae001f: admin cannot set/view custom passwords)
    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          mustChangePassword: true  // 71252d4b: admin 重置后强制改密码
        }
      }),
      prisma.auditLog.create({
        data: {
          action: 'PASSWORD_RESET',
          targetType: 'user',
          targetId: user.id,
          actorId: req.user!.id,
          actorName: req.user!.name,
          details: {
            targetEmail: user.email,
            targetName: user.name,
            source: 'auth-admin-reset-password'
          }
        }
      })
    ]);

    res.json({ email, generatedPassword: plainPassword, message: `${email} 密码已重置，请妥善保管` });
  })
);

// POST /auth/reset-password — User resets own password, gets random new one
authRouter.post(
  '/reset-password',
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpError(401, '用户不存在');
    }

    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      }),
      prisma.auditLog.create({
        data: {
          action: 'PASSWORD_RESET',
          targetType: 'user',
          targetId: user.id,
          actorId: user.id,
          actorName: user.name,
          details: {
            targetEmail: user.email,
            targetName: user.name,
            selfService: true,
            source: 'auth-reset-password'
          }
        }
      })
    ]);

    res.json({ generatedPassword: plainPassword, message: '新密码已生成，请妥善保管' });
  })
);
export const router = authRouter;
export const mountPath = '/api/auth';
