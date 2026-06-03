import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { Prisma, UserRole, OkrRole, InternalRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';

export const adminUsersRouter = Router();

adminUsersRouter.use(authRequired);

const userListSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  internalRole: true,
  okrRole: true,
  mustChangePassword: true,
  enabled: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  createdAt: true,
} as const;

// Admin guard: only role=admin or internalRole=cto
function assertAdmin(req: Express.Request): void {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  if (req.user.role !== 'admin' && req.user.internalRole !== 'cto') {
    throw new HttpError(403, 'Admin or CTO role required');
  }
}

function generatePassword(): string {
  return crypto.randomBytes(12).toString('hex');
}

function buildUserAuditLogData(
  req: Express.Request,
  action: string,
  targetId: string,
  details?: Prisma.InputJsonValue
): Prisma.AuditLogCreateInput {
  const data: Prisma.AuditLogCreateInput = {
    action,
    targetType: 'user',
    targetId,
    actorId: req.user!.id,
    actorName: req.user!.name,
  };

  if (details !== undefined) {
    data.details = details;
  }

  return data;
}

// GET / - Paginated user list
adminUsersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userListSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      data: users,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

// GET /audit-logs - Paginated audit log list
adminUsersRouter.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const targetId = typeof req.query.targetId === 'string' ? req.query.targetId.trim() : '';
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId.trim() : '';

    const where: Prisma.AuditLogWhereInput = {
      targetType: 'user',
      ...(action ? { action } : {}),
      ...(targetId ? { targetId } : {}),
      ...(actorId ? { actorId } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      data: logs,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

// POST /batch/reset-password - Reset multiple user passwords
adminUsersRouter.post(
  '/batch/reset-password',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const { userIds } = req.body as { userIds?: unknown };
    if (!Array.isArray(userIds)) {
      throw new HttpError(400, 'userIds must be an array');
    }

    const invalidUserId = userIds.find((userId) => typeof userId !== 'string' || userId.trim() === '');
    if (invalidUserId !== undefined) {
      throw new HttpError(400, 'userIds must contain only non-empty strings');
    }

    const uniqueUserIds = Array.from(new Set((userIds as string[]).map((userId) => userId.trim())));
    if (uniqueUserIds.length === 0) {
      throw new HttpError(400, 'userIds cannot be empty');
    }

    const results: Array<{ id: string; name: string; email: string; generatedPassword: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of uniqueUserIds) {
      if (id === req.user!.id) {
        errors.push({ id, error: 'Cannot reset your own password' });
        continue;
      }

      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true },
      });

      if (!user) {
        errors.push({ id, error: 'User not found' });
        continue;
      }

      const generatedPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);

      await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: {
            password: hashedPassword,
            mustChangePassword: true,
          },
        }),
        prisma.auditLog.create({
          data: buildUserAuditLogData(req, 'PASSWORD_RESET', id, {
            targetEmail: user.email,
            targetName: user.name,
            batch: true,
          }),
        }),
      ]);

      results.push({ id: user.id, name: user.name, email: user.email, generatedPassword });
    }

    res.json({
      data: results,
      errors,
      meta: {
        requested: uniqueUserIds.length,
        succeeded: results.length,
        failed: errors.length,
      },
    });
  })
);

// PATCH /:id/toggle-status - Enable or disable user account
adminUsersRouter.patch(
  '/:id/toggle-status',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const id = String(req.params.id);
    const { enabled } = req.body as { enabled?: unknown };

    if (id === req.user!.id) {
      throw new HttpError(400, 'Cannot change your own account status');
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new HttpError(400, 'enabled must be a boolean');
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, enabled: true },
    });
    if (!user) throw new HttpError(404, 'User not found');

    const nextEnabled = typeof enabled === 'boolean' ? enabled : !user.enabled;
    const action = nextEnabled ? 'ACCOUNT_ENABLE' : 'ACCOUNT_DISABLE';

    const updated = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: { enabled: nextEnabled },
        select: userListSelect,
      });

      await tx.auditLog.create({
        data: buildUserAuditLogData(req, action, id, {
          targetEmail: user.email,
          targetName: user.name,
          previousEnabled: user.enabled,
          enabled: nextEnabled,
        }),
      });

      return updatedUser;
    });

    res.json(updated);
  })
);

// PATCH /:id - Update user roles
adminUsersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const id = String(req.params.id);
    const { role, okrRole, internalRole } = req.body as {
      role?: string;
      okrRole?: string;
      internalRole?: string | null;
    };

    if (id === req.user!.id) {
      throw new HttpError(400, 'Cannot change your own roles');
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, internalRole: true, okrRole: true },
    });
    if (!user) throw new HttpError(404, 'User not found');

    const validUserRoles = Object.values(UserRole);
    const validOkrRoles = Object.values(OkrRole);
    const validInternalRoles = Object.values(InternalRole);

    const data: Prisma.UserUpdateInput = {};
    if (role !== undefined) {
      if (!validUserRoles.includes(role as UserRole)) {
        throw new HttpError(400, `Invalid role. Valid values: ${validUserRoles.join(', ')}`);
      }
      data.role = role as UserRole;
    }
    if (okrRole !== undefined) {
      if (!validOkrRoles.includes(okrRole as OkrRole)) {
        throw new HttpError(400, `Invalid okrRole. Valid values: ${validOkrRoles.join(', ')}`);
      }
      data.okrRole = okrRole as OkrRole;
    }
    if (internalRole !== undefined) {
      if (internalRole === null) {
        data.internalRole = null;
      } else if (!validInternalRoles.includes(internalRole as InternalRole)) {
        throw new HttpError(400, `Invalid internalRole. Valid values: ${validInternalRoles.join(', ')}`);
      } else {
        data.internalRole = internalRole as InternalRole;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, 'No valid fields to update');
    }

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (role !== undefined && user.role !== role) {
      changes.role = { from: user.role, to: role };
    }
    if (okrRole !== undefined && user.okrRole !== okrRole) {
      changes.okrRole = { from: user.okrRole, to: okrRole };
    }
    if (internalRole !== undefined && user.internalRole !== internalRole) {
      changes.internalRole = { from: user.internalRole, to: internalRole };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data,
        select: userListSelect,
      });

      await tx.auditLog.create({
        data: buildUserAuditLogData(req, 'ROLE_CHANGE', id, {
          targetEmail: user.email,
          targetName: user.name,
          changes,
        }),
      });

      return updatedUser;
    });

    res.json(updated);
  })
);

// POST /:id/reset-password - Reset user password
adminUsersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const id = String(req.params.id);

    if (id === req.user!.id) {
      throw new HttpError(400, 'Cannot reset your own password');
    }

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
    if (!user) throw new HttpError(404, 'User not found');

    const generatedPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          password: hashedPassword,
          mustChangePassword: true,
        },
      }),
      prisma.auditLog.create({
        data: buildUserAuditLogData(req, 'PASSWORD_RESET', id, {
          targetEmail: user.email,
          targetName: user.name,
        }),
      }),
    ]);

    res.json({ id: user.id, email: user.email, generatedPassword });
  })
);

// ─── Admin Create User (2026-06-04: 替代被关闭的公共注册) ────────────────

adminUsersRouter.post(
  '/',
  assertAdmin,
  asyncHandler(async (req, res) => {
    const { name, email, password, role, internalRole } = req.body as {
      name: string;
      email: string;
      password?: string;
      role?: string;
      internalRole?: string;
    };

    if (!name || !email) throw new HttpError(400, 'name 和 email 必填');

    const validUserRoles = Object.values(UserRole);
    const validInternalRoles = Object.values(InternalRole);
    const userRole = (role && validUserRoles.includes(role as UserRole)) ? role as UserRole : 'developer';
    const userInternalRole = (internalRole && validInternalRoles.includes(internalRole as InternalRole)) ? internalRole as InternalRole : null;

    // Check duplicate email
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new HttpError(409, `邮箱 ${email} 已存在`);

    const plainPassword = password || generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: userRole,
        internalRole: userInternalRole,
        mustChangePassword: !password,  // 自选密码不需要强制改
      },
      select: { id: true, name: true, email: true, role: true, internalRole: true },
    });

    await prisma.auditLog.create({
      data: buildUserAuditLogData(req, 'USER_CREATED', user.id, {
        targetEmail: user.email,
        targetName: user.name,
        role: user.role,
        internalRole: user.internalRole,
        selfProvidedPassword: !!password,
      }),
    });

    res.status(201).json({
      success: true,
      data: { ...user, generatedPassword: password ? undefined : plainPassword },
    });
  })
);

// ─── Password Policy ─────────────────────────────────────────

// GET /password-policy — Get current password policy
adminUsersRouter.get(
  '/password-policy',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    let policy = await prisma.passwordPolicy.findFirst({ where: { isDefault: true } });
    if (!policy) {
      // Auto-create default policy if not exists
      policy = await prisma.passwordPolicy.create({
        data: { name: 'default', isDefault: true },
      });
    }
    res.json(policy);
  })
);

// PUT /password-policy — Update password policy (upsert single default)
adminUsersRouter.put(
  '/password-policy',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const {
      minLength,
      requireUppercase,
      requireLowercase,
      requireNumber,
      requireSpecial,
      expiresInDays,
      forceChangeCycleDays,
    } = req.body as {
      minLength?: number;
      requireUppercase?: boolean;
      requireLowercase?: boolean;
      requireNumber?: boolean;
      requireSpecial?: boolean;
      expiresInDays?: number | null;
      forceChangeCycleDays?: number | null;
    };

    const data: Prisma.PasswordPolicyUpdateInput = {};
    if (minLength !== undefined) data.minLength = Math.max(4, Math.min(128, Number(minLength)));
    if (requireUppercase !== undefined) data.requireUppercase = Boolean(requireUppercase);
    if (requireLowercase !== undefined) data.requireLowercase = Boolean(requireLowercase);
    if (requireNumber !== undefined) data.requireNumber = Boolean(requireNumber);
    if (requireSpecial !== undefined) data.requireSpecial = Boolean(requireSpecial);
    if (expiresInDays !== undefined) data.expiresInDays = expiresInDays === null ? null : Math.max(1, Number(expiresInDays));
    if (forceChangeCycleDays !== undefined) data.forceChangeCycleDays = forceChangeCycleDays === null ? null : Math.max(1, Number(forceChangeCycleDays));

    const policy = await prisma.passwordPolicy.upsert({
      where: { name: 'default' },
      update: data,
      create: {
        name: 'default',
        isDefault: true,
        ...(minLength !== undefined ? { minLength: Math.max(4, Math.min(128, Number(minLength))) } : {}),
        ...(requireUppercase !== undefined ? { requireUppercase: Boolean(requireUppercase) } : {}),
        ...(requireLowercase !== undefined ? { requireLowercase: Boolean(requireLowercase) } : {}),
        ...(requireNumber !== undefined ? { requireNumber: Boolean(requireNumber) } : {}),
        ...(requireSpecial !== undefined ? { requireSpecial: Boolean(requireSpecial) } : {}),
        ...(expiresInDays !== undefined ? { expiresInDays: expiresInDays === null ? null : Math.max(1, Number(expiresInDays)) } : {}),
        ...(forceChangeCycleDays !== undefined ? { forceChangeCycleDays: forceChangeCycleDays === null ? null : Math.max(1, Number(forceChangeCycleDays)) } : {}),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: buildUserAuditLogData(req, 'POLICY_UPDATE', policy.id, {
        action: 'PASSWORD_POLICY_UPDATE',
        changes: data,
      }),
    });

    res.json(policy);
  })
);
