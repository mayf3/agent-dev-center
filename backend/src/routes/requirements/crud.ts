import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  canReadRequirement,
  canEditRequirement,
  roleAwareRequirementWhere,
  decomposeRequirement,
} from './helpers.js';
import {
  createRequirementSchema,
  requirementIdSchema,
  listRequirementsSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { runOverdueCheck, findOverdueRequirements } from '../../utils/overdue-check.js';
import {
  requireInternalRole,
  requirePmApproval,
  checkWipLimit,
  preventSelfApproval,
  enforceReportReviewFlow,
} from '../../middleware/internal-workflow.js';

export function registerCrudRoutes(router: Router) {
  // POST / — 创建需求
  router.post('/', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const body = createRequirementSchema.parse(req.body);

    const { title, description, priority = 'medium', tags, category, parentId } = body;

    // 重复检测
    const existing = await prisma.requirement.findMany({
      where: { status: { not: 'rejected' } },
      select: { id: true, title: true },
    });

    const normalizedTitle = normalizeTitle(title);
    for (const reqt of existing) {
      if (similarity(normalizedTitle, normalizeTitle(reqt.title)) >= DEFAULT_SIMILARITY_THRESHOLD) {
        throw new HttpError(409, '存在相似标题的需求，请检查后再创建');
      }
    }

    // 自动建议 parentId（同分类下未完成的需求）
    let resolvedParentId = parentId;
    if (!resolvedParentId && category) {
      const parent = await prisma.requirement.findFirst({
        where: {
          category,
          parentId: null,
          status: { in: ['approved', 'in-progress', 'testing', 'review'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (parent) resolvedParentId = parent.id;
    }

    // 自动估算
    const estimatedHours = body.estimatedHours ?? (description ? Math.ceil(description.length / 500) * 2 : 4);
    const autoDecompose = body.autoDecompose !== false;

    const requirement = await prisma.requirement.create({
      data: {
        title,
        description: description ?? '',
        priority,
        tags: tags ?? [],
        category: category ?? null,
        parentId: resolvedParentId ?? null,
        estimatedHours,
        requesterId: user.id,
        requester: user.name,
        source: body.source ?? 'user-request',
        approvalStatus: body.priority?.startsWith('P0') || body.priority?.startsWith('P1') ? 'pending_pm' : 'approved',
      },
    });

    // 自动拆解
    if (autoDecompose && description) {
      const tasks = decomposeRequirement(title, description);
      for (const task of tasks) {
        await prisma.requirement.create({
          data: {
            title: task.title,
            description: task.description,
            priority: task.priority,
            estimatedHours: task.estimated_hours,
            requesterId: user.id,
            requester: user.name,
            parentId: requirement.id,
            source: 'auto-decompose',
          },
        });
      }
    }

    await notifyEvent('requirement.created', {
      requirementId: requirement.id,
      title: requirement.title,
      user: { id: user.id, name: user.name },
    });

    // 获取完整数据
    const full = await prisma.requirement.findUnique({
      where: { id: requirement.id },
      include: {
        reports: { orderBy: { createdAt: 'desc' }, take: 5 },
        children: { take: 5, orderBy: { createdAt: 'asc' } },
        parent: true,
      },
    });

    res.status(201).json({ data: serializeRequirement(full!) });
  }));

  // GET / — 列表
  router.get('/', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const query = listRequirementsSchema.parse(req.query);
    const { limit = 20, offset = 0, status, priority, search, category, sortBy, sortOrder, parentId: filterParentId } = query;

    const where: Record<string, unknown> = { ...roleAwareRequirementWhere(user) };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (search) where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
    if (filterParentId === 'null') where.parentId = null;
    else if (filterParentId) where.parentId = filterParentId;

    const orderBy: Record<string, string> = {};
    orderBy[sortBy || 'createdAt'] = sortOrder || 'desc';

    const [total, requirements] = await Promise.all([
      prisma.requirement.count({ where: where as any }),
      prisma.requirement.findMany({
        where: where as any,
        orderBy: orderBy as any,
        take: limit,
        skip: offset,
        include: {
          reports: { orderBy: { createdAt: 'desc' }, take: 1 },
          children: { take: 3, orderBy: { createdAt: 'asc' } },
        },
      }),
    ]);

    // 超期检查
    let overdueCheck: Record<string, string[]> = {};
    if (!status) {
      const userReqs = await findOverdueRequirements(user, prisma);
      overdueCheck = runOverdueCheck(userReqs);
    }

    res.json({
      data: requirements.map(serializeRequirement),
      total,
      limit,
      offset,
      overdue: overdueCheck,
    });
  }));

  // GET /stats — 统计
  router.get('/stats', asyncHandler(async (_req, res) => {
    const user = _req.user as Express.AuthUser;
    const where = roleAwareRequirementWhere(user);

    const stats = await prisma.requirement.groupBy({
      by: ['status'],
      where: where as any,
      _count: true,
    });

    res.json({
      data: stats.reduce((acc: Record<string, number>, s: { status: string; _count: number }) => {
        acc[s.status] = s._count;
        return acc;
      }, {}),
    });
  }));

  // GET /:id — 详情
  router.get('/:id', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({
      where: { id },
      include: {
        reports: { orderBy: { createdAt: 'desc' }, take: 20 },
        children: {
          orderBy: { createdAt: 'asc' },
          include: { children: { take: 3, orderBy: { createdAt: 'asc' } } },
        },
        parent: true,
        revisions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(user, requirement)) throw new HttpError(403, '无权限查看此需求');

    res.json({ data: serializeRequirement(requirement) });
  }));

  // DELETE /:id — 删除
  router.delete('/:id', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canEditRequirement(user, requirement)) throw new HttpError(403, '无权删除此需求');

    await prisma.requirement.delete({ where: { id } });

    await notifyEvent('requirement.deleted', {
      requirementId: id,
      title: requirement.title,
      user: { id: user.id, name: user.name },
    });

    res.json({ data: { id }, message: '需求已删除' });
  }));
}
