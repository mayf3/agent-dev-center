import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  createRequirementSchema,
  listRequirementsSchema,
  requirementIdSchema,
  updateRequirementSchema,
  patchRequirementSchema,
} from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { validateAssigneeRoleMatch } from '../../lib/assignee-resolver.js';
import { notifyEvent } from '../../utils/notifications.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { findOverdueRequirements, runOverdueCheck } from '../../utils/overdue-check.js';
import { listRevisionsSchema } from '../../schemas/revision.js';
import { canReadRequirement, canEditRequirement, roleAwareRequirementWhere } from './utils.js';

export function registerCoreRoutes(router: import('express').Router): void {

// POST / - 创建需求
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { body } = createRequirementSchema.parse({ body: req.body });
    const actor = req.user!;

    const allRequirements = await prisma.requirement.findMany({
      select: { id: true, title: true, currentStep: true },
    });
    const normalizedNew = normalizeTitle(body.title);
    const similarItems = allRequirements
      .map(r => ({
        id: r.id,
        title: r.title,
        currentStep: r.currentStep,
        score: similarity(normalizedNew, normalizeTitle(r.title)),
      }))
      .filter(r => r.score >= DEFAULT_SIMILARITY_THRESHOLD && r.title !== body.title)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 解析 assignee：支持 name/email/userId 输入，自动查找 ID
    let createAssigneeId: string | null = null;
    let createAssigneeName: string | null = null;
    if (body.assignee && (actor.role === 'admin' || actor.role === 'cto_agent')) {
      // assignee 可以是 name/email/UUID，分条件查找避免 Prisma UUID 解析错误
      let assigneeUser;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assignee)) {
        assigneeUser = await prisma.user.findUnique({
          where: { id: body.assignee },
          select: { id: true, name: true }
        });
      } else {
        assigneeUser = await prisma.user.findFirst({
          where: { OR: [{ name: body.assignee }, { email: body.assignee }] },
          select: { id: true, name: true }
        });
      }
      createAssigneeId = assigneeUser?.id ?? null;
      createAssigneeName = assigneeUser?.name ?? null;
      // 如果指定了 assignee 但找不到用户，拒绝创建（不允许存垃圾数据）
      if (body.assignee && !assigneeUser) {
        throw new HttpError(400, `找不到用户「${body.assignee}」，请使用有效的用户名、邮箱或 UUID`);
      }
    }

    const requirement = await prisma.requirement.create({
      data: {
        title: body.title, description: body.description, priority: body.priority,
        type: body.type, tags: body.tags,
        requester: body.requester ?? actor.name, requesterId: actor.id,
        department: body.department,
        assignee: createAssigneeName, assigneeId: createAssigneeId,
        dueDate: body.dueDate, attachment: body.attachment,
        dependsOnIds: (body as any).dependsOnIds ?? []
      },
      include: { tasks: true, assigneeUser: { select: { name: true } } }
    });

    // 反向更新被依赖的需求的 blockedBy
    if ((body as any).dependsOnIds && (body as any).dependsOnIds.length > 0) {
      // 验证依赖的需求存在
      const dependencies = await prisma.requirement.findMany({
        where: { id: { in: (body as any).dependsOnIds } },
        select: { id: true, blockedBy: true },
      });
      if (dependencies.length !== (body as any).dependsOnIds.length) {
        throw new HttpError(400, `部分依赖需求不存在`);
      }
      // 更新每个被依赖需求的 blockedBy
      for (const dep of dependencies) {
        const newBlockedBy = [...(dep.blockedBy || []), requirement.id];
        await prisma.requirement.update({
          where: { id: dep.id },
          data: { blockedBy: newBlockedBy },
        });
      }
    }

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
      select: { id: true, title: true, currentStep: true, priority: true, createdAt: true },
    });

    const similar = allRequirements
      .map(r => ({
        id: r.id, title: r.title, currentStep: r.currentStep, priority: r.priority, createdAt: r.createdAt,
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

    // Group by currentStep
    const grouped: Record<string, typeof requirements> = {};
    for (const r of requirements) {
      const step = r.currentStep || 'pending';
      if (!grouped[step]) grouped[step] = [];
      grouped[step].push(r);
    }

    const serialized: Record<string, unknown[]> = {};
    for (const [step, items] of Object.entries(grouped)) {
      serialized[step] = items.map(serializeRequirement);
    }

    res.json({ data: serialized, meta: { total: requirements.length } });
  })
);

// GET /summary - 轻量摘要接口 (47ce94b8: 6字段 + status过滤, 目标<200ms)
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const stepFilter = req.query.step as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const where: Prisma.RequirementWhereInput = roleAwareRequirementWhere(actor);

    // Filter by currentStep (step param preferred, status param as fallback)
    const filterValue = stepFilter || statusFilter;
    if (filterValue && filterValue !== 'all') {
      if (filterValue === 'active') {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { currentStep: { not: 'done' } },
        ];
      } else {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { currentStep: filterValue } as Prisma.RequirementWhereInput
        ];
      }
    }

    const requirements = await prisma.requirement.findMany({
      where,
      select: {
        id: true,
        title: true,
        currentStep: true,
        priority: true,
        assignee: true,
        assigneeId: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const data = requirements.map(r => ({
      id: r.id,
      title: r.title,
      currentStep: r.currentStep,
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

    if (query.currentStep) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { currentStep: query.currentStep }];
    } else if (query.status) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { currentStep: query.status }];
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

    // 查询依赖的需求详情
    const dependsOn = requirement.dependsOnIds.length > 0
      ? await prisma.requirement.findMany({
          where: { id: { in: requirement.dependsOnIds } },
          select: { id: true, title: true, currentStep: true, priority: true },
        })
      : [];

    // 查询被哪些需求依赖
    const blocks = requirement.blockedBy.length > 0
      ? await prisma.requirement.findMany({
          where: { id: { in: requirement.blockedBy } },
          select: { id: true, title: true, currentStep: true, priority: true },
        })
      : [];

    res.json({
      ...serializeRequirement(requirement),
      dependsOn,
      blocks,
    });
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
        // assignee 可以是 name/email/UUID，分条件查找避免 Prisma UUID 解析错误
        let assigneeUser;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assignee)) {
          assigneeUser = await prisma.user.findUnique({
            where: { id: body.assignee },
            select: { id: true, name: true }
          });
        } else {
          assigneeUser = await prisma.user.findFirst({
            where: { OR: [{ name: body.assignee }, { email: body.assignee }] },
            select: { id: true, name: true }
          });
        }
        if (!assigneeUser) {
          throw new HttpError(400, `找不到用户「${body.assignee}」，请使用有效的用户名、邮箱或 UUID`);
        }
        assigneeId = assigneeUser.id;
        assigneeName = assigneeUser.name;

        // 角色校验：如果有工作流，assigneeId 必须匹配当前步骤的角色
        const roleCheck = await validateAssigneeRoleMatch(params.id, assigneeId);
        if (!roleCheck.ok) {
          throw new HttpError(400, roleCheck.message);
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
        notes: body.notes,
        dependsOnIds: body.dependsOnIds
      },
      include: { tasks: true, assigneeUser: { select: { name: true } } }
    });

    // 处理 dependsOnIds 变化：更新被依赖需求的 blockedBy 反向引用
    if (body.dependsOnIds !== undefined) {
      const oldDeps = new Set(existing.dependsOnIds || []);
      const newDeps = new Set(body.dependsOnIds);

      // 新增的依赖：给被依赖需求加上此需求的 ID
      for (const depId of [...newDeps].filter(id => !oldDeps.has(id))) {
        const dep = await prisma.requirement.findUnique({ where: { id: depId }, select: { id: true, blockedBy: true } });
        if (!dep) continue;
        const newBlockedBy = [...(dep.blockedBy || []), params.id];
        await prisma.requirement.update({ where: { id: depId }, data: { blockedBy: newBlockedBy } });
      }

      // 移除的依赖：从被依赖需求的 blockedBy 中删除此需求的 ID
      for (const depId of [...oldDeps].filter(id => !newDeps.has(id))) {
        const dep = await prisma.requirement.findUnique({ where: { id: depId }, select: { id: true, blockedBy: true } });
        if (!dep) continue;
        const newBlockedBy = (dep.blockedBy || []).filter(id => id !== params.id);
        await prisma.requirement.update({ where: { id: depId }, data: { blockedBy: newBlockedBy } });
      }
    }

    await prisma.requirementRevision.create({
      data: {
        requirementId: params.id, title: existing.title, description: existing.description,
        priority: existing.priority, status: 'pending', requester: existing.requester,
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

// PATCH /:id - 部分更新（状态变更、分配、gitHash、deployVersion）
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = patchRequirementSchema.parse({ params: req.params, body: req.body });
    const existing = await prisma.requirement.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, '需求不存在');
    if (!canEditRequirement(req.user!, existing)) throw new HttpError(403, '无权编辑该需求');

    // 5c76bb65: PM 审核时字段级权限控制
    if (existing.currentStep === 'pm_review') {
      const user = req.user!;
      const isPmRole = user.internalRole === 'pm' || user.role === 'pm';
      const isAdmin = user.role === 'admin';
      if (isPmRole && !isAdmin) {
        const pmProtectedFields = ['title', 'description', 'priority', 'department'];
        const blockedFields = pmProtectedFields.filter(f => (body as any)[f] !== undefined);
        if (blockedFields.length > 0) {
          throw new HttpError(403, `PM 审核时不能修改以下字段：${blockedFields.join('、')}。只能打回（rejectReason）或写审核意见（notes）`);
        }
      }
    }

    let assigneeId = existing.assigneeId;
    let assigneeName: string | null = existing.assignee;

    // 处理 assignee 变更（强制校验）
    if (body.assignee !== undefined) {
      if (body.assignee) {
        // 严格校验：只接受 name/email，不再接受 UUID（内部用 assigneeId）
        // 检测是否是 UUID 格式（历史悬空数据）
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.assignee)) {
          throw new HttpError(400, `assignee 不接受 UUID 格式，请使用有效的用户名或邮箱`);
        }

        // 按 name/email 查找用户
        const assigneeUser = await prisma.user.findFirst({
          where: { OR: [{ name: body.assignee }, { email: body.assignee }] },
          select: { id: true, name: true }
        });

        if (!assigneeUser) {
          throw new HttpError(400, `找不到用户「${body.assignee}」，请使用有效的用户名或邮箱`);
        }

        assigneeId = assigneeUser.id;
        assigneeName = assigneeUser.name;

        // 角色校验：如果有工作流，assigneeId 必须匹配当前步骤的角色
        const roleCheck = await validateAssigneeRoleMatch(params.id, assigneeId);
        if (!roleCheck.ok) {
          throw new HttpError(400, roleCheck.message);
        }
      } else {
        assigneeId = null;
        assigneeName = null;
      }
    }

    // 处理步骤变更
    let newStep = existing.currentStep;
    if (body.currentStep !== undefined) {
      newStep = body.currentStep;
    } else if (body.status !== undefined) {
      newStep = body.status;
    }

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        currentStep: newStep,
        assignee: assigneeName,
        assigneeId,
        rejectReason: body.rejectReason,
        gitHash: body.gitHash,
        deployVersion: body.deployVersion,
        ...(body.workflowId ? { workflowId: body.workflowId } : {}),
      },
      include: { tasks: true, assigneeUser: { select: { name: true } } }
    });

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title, actor: req.user!.name, assignee: assigneeName
    });

    res.json(serializeRequirement(updated));
  })
);

}
