import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { canEditRequirement, canReadRequirement, decomposeRequirement } from './helpers.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';

export function registerDecomposeRoutes(router: Router) {
  // POST / — 创建子需求
  router.post('/', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { title, description, priority, parentId } = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      parentId: z.string().uuid(),
    }).parse(req.body);

    const parent = await prisma.requirement.findUnique({ where: { id: parentId } });
    if (!parent) throw new HttpError(404, '父需求不存在');

    const requirement = await prisma.requirement.create({
      data: {
        title,
        description: description ?? '',
        priority: priority ?? 'P2',
        requesterId: user.id,
        requester: user.name,
        parentId,
        source: 'sub-requirement',
      },
    });

    const full = await prisma.requirement.findUnique({
      where: { id: requirement.id },
      include: { parent: true },
    });
    res.status(201).json({ data: serializeRequirement(full!) });
  }));

  // GET /:id/requirements — 获取子需求列表
  router.get('/:id/requirements', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(user, requirement)) throw new HttpError(403, '无权限');

    const children = await prisma.requirement.findMany({
      where: { parentId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        reports: { orderBy: { createdAt: 'desc' }, take: 1 },
        children: { take: 3, orderBy: { createdAt: 'asc' } },
      },
    });

    res.json({ data: children.map(serializeRequirement), total: children.length });
  }));

  // GET /:id/requirements/:reqId — 子需求详情
  router.get('/:id/requirements/:reqId', asyncHandler(async (req, res) => {
    const { id, reqId } = z.object({ id: z.string().uuid(), reqId: z.string().uuid() }).parse(req.params);

    const requirement = await prisma.requirement.findUnique({
      where: { id: reqId },
      include: { parent: true, reports: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });

    if (!requirement || requirement.parentId !== id) throw new HttpError(404, '子需求不存在');

    const user = req.user as Express.AuthUser;
    if (!canReadRequirement(user, requirement)) throw new HttpError(403, '无权限');

    res.json({ data: serializeRequirement(requirement) });
  }));

  // POST /:id/decompose — 自动拆解
  router.post('/:id/decompose', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);
    const { confirm } = z.object({
      confirm: z.boolean().optional().default(false),
    }).parse(req.body);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const tasks = decomposeRequirement(requirement.title, requirement.description);

    if (!confirm) {
      res.json({ data: { tasks, count: tasks.length }, message: `检测到 ${tasks.length} 个可拆解的子任务，confirm=true 确认创建` });
      return;
    }

    const created = [];
    for (const task of tasks) {
      const sub = await prisma.requirement.create({
        data: {
          title: task.title,
          description: task.description,
          priority: task.priority,
          estimatedHours: task.estimated_hours,
          requesterId: user.id,
          requester: user.name,
          parentId: id,
          source: 'auto-decompose',
        },
      });
      created.push(sub);
    }

    res.json({ data: created, message: `已拆解为 ${created.length} 个子任务` });
  }));
}
