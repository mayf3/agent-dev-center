import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  createRequirementSchema,
  listRequirementsSchema,
  requirementIdSchema,
  updateRequirementSchema
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { apiRequirementStatus, serializeRequirement } from '../../utils/status.js';
import { validateAssigneeRoleMatch } from '../../lib/assignee-resolver.js';
import { notifyEvent } from '../../utils/notifications.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { findOverdueRequirements, runOverdueCheck } from '../../utils/overdue-check.js';
import { listRevisionsSchema } from '../../schemas/revision.js';
import { canReadRequirement, canEditRequirement, roleAwareRequirementWhere, buildStatusData } from './utils.js';

export function registerCoreRoutes(router: import('express').Router): void {

// POST / - 创建需求
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { body } = createRequirementSchema.parse({ body: req.body });
    const actor = req.user!;

    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, status: true },
    });
    const normalizedNew = normalizeTitle(body.title);
    const similarItems = allRequirements
      .map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        score: similarity(normalizedNew, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= DEFAULT_SIMILARITY_THRESHOLD && r.title !== body.title)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 解析 assignee：支持 name/email/userId 输入，自动查找 ID
    let createAssigneeId: string | null = null;
    let createAssigneeName: string | null = null;
    if (body.assignee && (actor.role === 'admin' || actor.role === 'cto_agent')) {
      const assigneeUser = await prisma.user.findFirst({
        where: { OR: [{ name: body.assignee }, { email: body.assignee }, { id: body.assignee }] },
        select: { id: true, name: true }
      });
      createAssigneeId = assigneeUser?.id ?? null;
      createAssigneeName = assigneeUser?.name ?? body.assignee;
    }

    const requirement = await prisma.requirement.create({
      data: {
        title: body.title, description: body.description, priority: body.priority,
        type: body.type, tags: body.tags,
        requester: body.requester ?? actor.name, requesterId: actor.id,
        department: body.department,
        assignee: createAssigneeName, assigneeId: createAssigneeId,
        dueDate: body.dueDate, attachment: body.attachment
      },
      include: { tasks: true, assigneeUser: { select: { name: true } } }
    });

    void notifyEvent('requirement.submitted', {
      id: requirement.id, title: requirement.title, actor: actor.name, assignee: createAssigneeName
    });

    const response: Record<string, unknown> = serializeRequirement(requirement);
    if (similarItems.length > 0) {
      response.warning = {
        type: 'possible_duplicate',
        message: `检测到 ${similarItems.length} 个相似需求（相似度 ≥ 80%）`,
        similar: similarItems,
      };
    }

    res.status(201).json(response);
  })
);

// GET /similar - 重复检测
router.get(
  '/similar',
  asyncHandler(async (req, res) => {
    const title = z.string().min(1).parse(req.query.title);
    const threshold = z.coerce.number().min(0).max(1).default(DEFAULT_SIMILARITY_THRESHOLD).parse(req.query.threshold);
    const normalizedInput = normalizeTitle(title);

    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, status: true, priority: true, createdAt: true },
    });

    const similar = allRequirements
      .map(r => ({
        id: r.id, title: r.title, status: r.status, priority: r.priority, createdAt: r.createdAt,
        score: similarity(normalizedInput, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ success: true, data: similar, query: { title, threshold } });
  })
);

// GET /overdue - 超时需求列表
router.get(
  '/overdue',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await findOverdueRequirements();
    res.json({ success: true, data: result });
  })
);

// POST /overdue/notify - 手动催办
router.post(
  '/overdue/notify',
  requireRoles('admin'),
  asyncHandler(async (_req, res) => {
    const result = await runOverdueCheck();
    res.json({ success: true, data: result });
  })
);

// GET /kanban - 看板数据
router.get(
  '/kanban',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    const requirements = await prisma.requirement.findMany({
      where,
      include: { tasks: true, assigneeUser: { select: { name: true } } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const grouped: Record<string, typeof requirements> = {
      pending: [], clarifying: [], 'in-progress': [], testing: [],
      review: [], deploying: [], done: [], rejected: [],
    };

    for (const r of requirements) {
      const status = apiRequirementStatus[r.status as keyof typeof apiRequirementStatus] || r.status;
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(r);
    }

    const serialized: Record<string, unknown[]> = {};
    for (const [status, items] of Object.entries(grouped)) {
      serialized[status] = items.map(serializeRequirement);
    }

    res.json({ data: serialized, meta: { total: requirements.length } });
  })
);

// GET /summary - 轻量摘要接口 (47ce94b8: 6字段 + status过滤, 目标<200ms)
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const statusFilter = req.query.status as string | undefined;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    // status filter: active=pending+approved+in-progress+testing+review+deploying, pending, all
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'active') {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { status: { in: ['pending', 'approved', 'in_progress', 'testing', 'review', 'deploying'] } }
        ];
      } else {
        // Map API status to DB status if needed
        const dbStatus = (apiRequirementStatus as Record<string, string>)[statusFilter] ?? statusFilter;
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { status: dbStatus } as Prisma.RequirementWhereInput
        ];
      }
    }

    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        assignee: true,
        assigneeId: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const data = requirements.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      assigneeName: r.assignee,
      assignee: r.assigneeId,
    }));

    res.json({ success: true, data, meta: { total: data.length } });
  })
);

// GET / - 列表
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listRequirementsSchema.parse({ query: req.query });
    const actor = req.user!;
    const where: Prisma.RequirementWhereInput = { AND: [roleAwareRequirementWhere(actor)] };

    if (query.status) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { status: buildStatusData(query.status) }];
    }
    if (query.priority) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { priority: query.priority }];
    }
    if (query.type) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { type: query.type }];
    }
    if (query.tags && query.tags.length > 0) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { tags: { hasEvery: query.tags } }];
    }
    if (query.search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { requester: { contains: query.search, mode: 'insensitive' } },
            { department: { contains: query.search, mode: 'insensitive' } },
            { assignee: { contains: query.search, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where, include: { tasks: true, assigneeUser: { select: { name: true } } },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip, take: query.pageSize
      }),
      prisma.requirement.count({ where })
    ]);

    res.json({
      data: requirements.map(serializeRequirement),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }
    });
  })
);

// GET /:id - 详情
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { tasks: true, assigneeUser: { select: { name: true } } }
    });

    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权查看该需求');

    res.json(serializeRequirement(requirement));
  })
);

// GET /:id/revisions - 修订历史
router.get(
  '/:id/revisions',
  asyncHandler(async (req, res) => {
    const { params, query } = listRevisionsSchema.parse({ params: req.params, query: req.query });
    const requirement = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权查看');

    const skip = (query.page - 1) * query.pageSize;
    const [revisions, total] = await prisma.$transaction([
      prisma.requirementRevision.findMany({
        where: { requirementId: params.id },
        orderBy: { createdAt: 'desc' },
        skip, take: query.pageSize,
        include: { operator: { select: { id: true, name: true } } },
      }),
      prisma.requirementRevision.count({ where: { requirementId: params.id } }),
    ]);

    res.json({
      data: revisions,
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  })
);

// PUT /:id - 完整更新
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateRequirementSchema.parse({ params: req.params, body: req.body });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    if (!canEditRequirement(req.user!, existing)) throw new HttpError(403, '无权编辑该需求');

    let assigneeId = existing.assigneeId;
    let assigneeName: string | null = existing.assignee;
    if (body.assignee !== undefined) {
      if (body.assignee) {
        const assigneeUser = await prisma.user.findFirst({
          where: { OR: [{ name: body.assignee }, { email: body.assignee }, { id: body.assignee }] },
          select: { id: true, name: true }
        });
        assigneeId = assigneeUser?.id ?? null;
        assigneeName = assigneeUser?.name ?? body.assignee;

        // 角色校验：如果有工作流，assigneeId 必须匹配当前步骤的角色
        if (assigneeId) {
          const roleCheck = await validateAssigneeRoleMatch(params.id, assigneeId);
          if (!roleCheck.ok) {
            throw new HttpError(400, roleCheck.message);
          }
        }
      } else {
        assigneeId = null;
        assigneeName = null;
      }
    }

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        title: body.title, description: body.description, priority: body.priority,
        type: body.type, tags: body.tags,
        requester: body.requester, department: body.department,
        assignee: assigneeName, assigneeId, dueDate: body.dueDate, attachment: body.attachment,
        notes: body.notes
      },
      include: { tasks: true, assigneeUser: { select: { name: true } } }
    });

    await prisma.requirementRevision.create({
      data: {
        requirementId: params.id, title: existing.title, description: existing.description,
        priority: existing.priority, status: existing.status, requester: existing.requester,
        department: existing.department, assignee: existing.assignee, dueDate: existing.dueDate,
        attachment: existing.attachment, revisionNote: '内容已编辑更新', operatorId: req.user!.id,
      }
    });

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title, actor: req.user!.name, assignee: assigneeName
    });

    res.json(serializeRequirement(updated));
  })
);

}
