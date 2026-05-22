import { Router } from 'express';
import { z } from 'zod';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const profileRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────

/** Full user profile shape (excludes password) */
const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  internalRole: true,
  okrRole: true,
  agentId: true,
  permissions: true,
  bio: true,
  phone: true,
  avatar: true,
  department: true,
  title: true,
  employeeNo: true,
  onboardingDate: true,
  managerId: true,
  createdAt: true,
} as const;

function canManageOkr(okrRole: string | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

function isHrManager(user: { role: string; internalRole?: string | null }): boolean {
  return user.role === 'admin' || user.internalRole === 'cto';
}

// ─── Zod schemas ──────────────────────────────────────────────

const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(500).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    avatar: z.string().trim().url().max(500).optional().nullable(),
    department: z.string().trim().max(100).optional().nullable(),
    title: z.string().trim().max(100).optional().nullable(),
  }),
});

const updateHrInfoSchema = z.object({
  body: z.object({
    internalRole: z.enum(['cto', 'pm', 'developer', 'tester', 'security', 'ops', 'qa']).optional().nullable(),
    department: z.string().trim().max(100).optional().nullable(),
    title: z.string().trim().max(100).optional().nullable(),
    employeeNo: z.string().trim().max(50).optional().nullable(),
    onboardingDate: z.string().datetime().optional().nullable(),
    managerId: z.string().uuid().optional().nullable(),
  }),
});

// ─── 1. GET /api/profile/me — current user's profile ─────────

profileRouter.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: userProfileSelect,
    });
    if (!user) throw new HttpError(404, '用户不存在');

    // Get direct report count separately
    const reportCount = await prisma.user.count({
      where: { managerId: req.user!.id },
    });

    res.json({ data: { ...user, _directReportCount: reportCount } });
  })
);

// ─── 2. PATCH /api/profile/me — update own profile ───────────

profileRouter.patch(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = updateProfileSchema.parse({ body: req.body });

    // Ensure name uniqueness if changed
    if (body.name && body.name !== req.user!.name) {
      const existing = await prisma.user.findUnique({ where: { email: req.user!.email } });
      if (!existing) throw new HttpError(404, '用户不存在');
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: body,
      select: userProfileSelect,
    });

    res.json({ message: 'Profile 已更新', data: updated });
  })
);

// ─── 3. GET /api/profile/:userId — view any user's profile ───

profileRouter.get(
  '/:userId',
  authRequired,
  asyncHandler(async (req, res) => {
    const targetId = req.params.userId as string;
    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: userProfileSelect,
    });
    if (!user) throw new HttpError(404, '用户不存在');

    const reportCount = await prisma.user.count({
      where: { managerId: targetId },
    });

    res.json({ data: { ...user, _directReportCount: reportCount } });
  })
);

// ─── 4. GET /api/profile — list all users (directory) ────────

profileRouter.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { search, department: deptFilter, role: roleFilter } = req.query as Record<string, string | undefined>;

    const where: Record<string, any> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeNo: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (deptFilter) where.department = deptFilter;
    if (roleFilter) where.role = roleFilter;

    const users = await prisma.user.findMany({
      where,
      select: userProfileSelect,
      orderBy: { name: 'asc' },
    });

    res.json({ data: users, total: users.length });
  })
);

// ─── 5. PATCH /api/profile/:userId/hr — HR info (admin/cto only) ──────

profileRouter.patch(
  '/:userId/hr',
  authRequired,
  asyncHandler(async (req, res) => {
    if (!isHrManager(req.user!)) {
      throw new HttpError(403, '需要 admin 或 cto 角色才能管理 HR 信息');
    }

    const { body: hrBody } = updateHrInfoSchema.parse({ body: req.body });
    const targetId = req.params.userId as string;

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new HttpError(404, '目标用户不存在');

    // Validate managerId points to a real user
    if (hrBody.managerId) {
      const manager = await prisma.user.findUnique({ where: { id: hrBody.managerId } });
      if (!manager) throw new HttpError(400, '上级用户不存在');
      if (hrBody.managerId === targetId) throw new HttpError(400, '不能将自己设为上级');
    }

    const hrData: Record<string, any> = { ...hrBody };
    if (hrBody.onboardingDate) hrData.onboardingDate = new Date(hrBody.onboardingDate);

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: hrData,
      select: userProfileSelect,
    });

    res.json({ message: 'HR 信息已更新', data: updated });
  })
);

// ─── 6. GET /api/profile/:userId/team — direct reports ───────

profileRouter.get(
  '/:userId/team',
  authRequired,
  asyncHandler(async (req, res) => {
    const targetId = req.params.userId as string;
    const reports = await prisma.user.findMany({
      where: { managerId: targetId },
      select: userProfileSelect,
      orderBy: { name: 'asc' },
    });

    res.json({ data: reports, total: reports.length });
  })
);
