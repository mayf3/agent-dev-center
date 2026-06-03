import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { archiveRecord } from '../lib/archive.js';

export const postmortemsRouter = Router();

// ─── 1. 创建验尸报告 ──────────────────────────────────────

postmortemsRouter.post(
  '/',
  authRequired,
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const {
      requirementId,
      title,
      phenomenon,
      rootCause,
      whyExistingProcess,
      longTermPrinciple,
      preventionMeasures,
      responsiblePerson,
    } = req.body as {
      requirementId?: string;
      title: string;
      phenomenon: string;
      rootCause: string;
      whyExistingProcess: string;
      longTermPrinciple: string;
      preventionMeasures: string;
      responsiblePerson: string;
    };

    if (!title || !phenomenon || !rootCause || !preventionMeasures || !responsiblePerson) {
      throw new HttpError(400, '缺少必填字段: title, phenomenon, rootCause, preventionMeasures, responsiblePerson');
    }

    // Verify requirement if provided
    if (requirementId) {
      const reqmt = await prisma.requirement.findUnique({ where: { id: requirementId } });
      if (!reqmt) throw new HttpError(404, '关联需求不存在');
    }

    const postmortem = await prisma.postmortem.create({
      data: {
        requirementId: requirementId || null,
        title,
        phenomenon,
        rootCause,
        whyExistingProcess: whyExistingProcess || '',
        longTermPrinciple: longTermPrinciple || '',
        preventionMeasures,
        responsiblePerson,
        status: 'pending',
      },
      include: {
        requirement: { select: { id: true, title: true, priority: true, currentStep: true } },
      },
    });

    res.status(201).json({ postmortem });
  })
);

// ─── 2. 列表（支持筛选） ────────────────────────────────────

postmortemsRouter.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const {
      status,
      responsiblePerson,
      startDate,
      endDate,
      page = '1',
      pageSize = '20',
    } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (responsiblePerson) where.responsiblePerson = responsiblePerson;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(pageSize, 10);
    const take = parseInt(pageSize, 10);

    const [postmortems, total] = await Promise.all([
      prisma.postmortem.findMany({
        where,
        include: {
          requirement: { select: { id: true, title: true, priority: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.postmortem.count({ where }),
    ]);

    res.json({ postmortems, total, page: parseInt(page, 10), pageSize: take });
  })
);

// ─── 3. 获取单个报告 ────────────────────────────────────────

postmortemsRouter.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const postmortem = await prisma.postmortem.findUnique({
      where: { id },
      include: {
        requirement: { select: { id: true, title: true, priority: true, currentStep: true, description: true } },
      },
    });

    if (!postmortem) {
      throw new HttpError(404, '验尸报告不存在');
    }

    res.json({ postmortem });
  })
);

// ─── 4. 更新报告 ──────────────────────────────────────────

postmortemsRouter.patch(
  '/:id',
  authRequired,
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.postmortem.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpError(404, '验尸报告不存在');
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'title', 'phenomenon', 'rootCause', 'whyExistingProcess',
      'longTermPrinciple', 'preventionMeasures', 'responsiblePerson',
      'status', 'requirementId',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // If status changed to implemented, check for overdue tracking
    if (body.status === 'implemented' || body.status === 'verified') {
      updateData.updatedAt = new Date();
    }

    const postmortem = await prisma.postmortem.update({
      where: { id },
      data: updateData,
      include: {
        requirement: { select: { id: true, title: true, priority: true, currentStep: true } },
      },
    });

    res.json({ postmortem });
  })
);

// ─── 5. 删除报告 ─────────────────────────────────────────

postmortemsRouter.delete(
  '/:id',
  authRequired,
  requireRoles('admin'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const existing = await prisma.postmortem.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpError(404, '验尸报告不存在');
    }

    // Archive the postmortem record before deleting from DB
    archiveRecord(
      existing as unknown as Record<string, unknown>,
      'postmortems',
      {
        itemName: existing.title,
        itemId: existing.id,
        reason: '管理员归档删除验尸报告',
        archivedBy: req.user!.name || req.user!.email,
        extra: existing.requirementId ? `requirementId=${existing.requirementId}` : undefined
      }
    );

    await prisma.postmortem.delete({ where: { id } });

    res.json({ success: true, archived: true });
  })
);

// ─── 6. 统计信息 ──────────────────────────────────────────

postmortemsRouter.get(
  '/stats/summary',
  authRequired,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // This month's postmortems
    const thisMonth = await prisma.postmortem.count({
      where: { createdAt: { gte: monthStart } },
    });

    // Total counts by status
    const byStatus = await Promise.all(
      (['pending', 'implemented', 'verified'] as const).map(async (status) => {
        const count = await prisma.postmortem.count({ where: { status } });
        return { status, count };
      })
    );

    // Overdue (>3 days without implementation)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const overdue = await prisma.postmortem.count({
      where: {
        status: 'pending',
        createdAt: { lte: threeDaysAgo },
      },
    });

    // Total
    const total = await prisma.postmortem.count();

    res.json({
      thisMonth,
      total,
      overdue,
      byStatus,
    });
  })
);

// ─── 7. 获取给定需求的关联报告 ────────────────────────────────

postmortemsRouter.get(
  '/by-requirement/:requirementId',
  authRequired,
  asyncHandler(async (req, res) => {
    const requirementId = String(req.params.requirementId);

    const postmortems = await prisma.postmortem.findMany({
      where: { requirementId },
      orderBy: { createdAt: 'desc' },
      include: {
        requirement: { select: { id: true, title: true } },
      },
    });

    res.json({ postmortems });
  })
);
