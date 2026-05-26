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

// Admin guard: only role=admin or internalRole=cto
function assertAdmin(req: Express.Request): void {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  if (req.user.role !== 'admin' && req.user.internalRole !== 'cto') {
    throw new HttpError(403, 'Admin or CTO role required');
  }
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
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          internalRole: true,
          okrRole: true,
          mustChangePassword: true,
          createdAt: true,
        },
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

// PATCH /:id - Update user roles
adminUsersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    assertAdmin(req);

    const id = String(req.params.id);
    const { role, okrRole, internalRole } = req.body as {
      role?: string;
      okrRole?: string;
      internalRole?: string;
    };

    if (id === req.user!.id) {
      throw new HttpError(400, 'Cannot change your own roles');
    }

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
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

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        internalRole: true,
        okrRole: true,
        mustChangePassword: true,
        createdAt: true,
      },
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

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new HttpError(404, 'User not found');

    const generatedPassword = crypto.randomBytes(12).toString('hex');
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
      },
    });

    res.json({ generatedPassword });
  })
);
