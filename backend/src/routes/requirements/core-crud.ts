/**
 * Core CRUD Routes
 *
 * POST /   — 创建需求
 * GET /    — 列表
 * GET /:id — 详情
 * PUT /:id — 完整更新
 * PATCH /:id — 部分更新
 */
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
import { validateAssigneeRoleMatch, resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import { notifyEvent } from '../../utils/notifications.js';
import { similarity, normalizeTitle, DEFAULT_SIMILARITY_THRESHOLD } from '../../utils/similarity.js';
import { getWorkflowSteps, getCurrentStep } from './workflow-helpers.js';
import { canReadRequirement, canEditRequirement, roleAwareRequirementWhere } from './utils.js';

const requirementInclude = {
  tasks: true,
  assigneeUser: { select: { name: true } },
  project: { select: { id: true, name: true, boundaries: true } },
} satisfies Prisma.RequirementInclude;

export function registerCoreCrudRoutes(router: import('express').Router): void {

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

    // Fix 1 (e97eb46b): 校验 requester 名字 — 如果 body.requester 传了值，必须在 users 表能找到对应的 name
    const requesterName = body.requester ?? actor.name;
    if (body.requester && body.requester !== actor.name) {
      const requesterUser = await prisma.user.findFirst({
        where: { name: body.requester },
        select: { id: true, name: true }
      });
      if (!requesterUser) {
        throw new HttpError(400, `requester「${body.requester}」在用户表中不存在，请使用 users 表中的实际用户名`);
      }
    }

    const requirement = await prisma.requirement.create({
      data: {
        title: body.title, description: body.description, priority: body.priority,
        type: body.type, tags: body.tags,
        requester: requesterName, requesterId: actor.id,
        department: body.department,
        assignee: createAssigneeName, assigneeId: createAssigneeId,
        dueDate: body.dueDate, attachment: body.attachment,
        projectId: body.projectId ?? null,
        dependsOnIds: (body as any).dependsOnIds ?? []
      },
      include: requirementInclude
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
    if (query.assigneeId) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { assigneeId: query.assigneeId }];
    }
    if (query.projectId) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { projectId: query.projectId }];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [requirements, total] = await prisma.$transaction([
      prisma.requirement.findMany({
        where, include: requirementInclude,
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
      include: requirementInclude
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

    // Fix 1 (e97eb46b): PUT 时校验 requester 名字 — 如果传了 requester 且在 users 表找不到，400
    if (body.requester && body.requester !== existing.requester) {
      const requesterUser = await prisma.user.findFirst({
        where: { name: body.requester },
        select: { id: true, name: true }
      });
      if (!requesterUser) {
        throw new HttpError(400, `requester「${body.requester}」在用户表中不存在，请使用 users 表中的实际用户名`);
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
        ...(body.projectId !== undefined && { projectId: body.projectId }),
        dependsOnIds: body.dependsOnIds
      },
      include: requirementInclude
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
    const existing = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { workflow: { select: { steps: true } } },
    });
    if (!existing) throw new HttpError(404, '需求不存在');
    if (!canEditRequirement(req.user!, existing)) throw new HttpError(403, '无权编辑该需求');

    // 5c76bb65: PM 审核时字段级权限控制
    // 2026-06-13: draft 步骤允许 requester/PM 修改 description/title（补充材料后重新提交）
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

    // 2026-06-14 (fe6d34b5): 先计算 newStep，用于后续 assignee 角色校验和白名单校验
    let newStep = existing.currentStep;
    if (body.currentStep !== undefined) {
      newStep = body.currentStep;
    } else if (body.status !== undefined) {
      newStep = body.status;
    }
    const stepChanged = newStep !== existing.currentStep;

    // 白名单校验：PATCH currentStep 只允许特定转换，其他必须走 advance/reject API
    if (stepChanged) {
      const PATCH_STEP_WHITELIST: Record<string, string[]> = {
        'pm_review': ['draft'],     // PM 打回到 draft
        'draft': ['draft'],          // draft 同步骤（补充材料后重新提交）
      };
      const allowedTargets = existing.currentStep ? PATCH_STEP_WHITELIST[existing.currentStep] : undefined;
      if (!allowedTargets || !newStep || !allowedTargets.includes(newStep)) {
        throw new HttpError(
          400,
          `PATCH currentStep 不支持从「${existing.currentStep}」转到「${newStep}」。请使用 workflow advance/reject API 进行步骤流转。`
        );
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

        // 角色校验：步骤变更时用 targetStep 的 role 校验，否则用 currentStep
        // 2026-06-14 (fe6d34b5): 修复 PM 打回时用 currentStep(pm) 校验导致 requester 被拒
        const roleCheck = await validateAssigneeRoleMatch(
          params.id, assigneeId,
          stepChanged ? (newStep ?? undefined) : undefined,
        );
        if (!roleCheck.ok) {
          throw new HttpError(400, roleCheck.message);
        }
      } else {
        assigneeId = null;
        assigneeName = null;
      }
    }

    // If step changed and assignee not manually specified, auto-resolve from snapshot (snapshot-first)
    if (stepChanged && !body.assignee) {
      if (existing.workflowId) {
        const existingSteps = getWorkflowSteps(existing);
        const targetStepDef = getCurrentStep(existingSteps, newStep ?? '');
        if (targetStepDef?.role) {
          const resolvedId = await resolveAssigneeForStep(targetStepDef.role, existing.assigneeId);
          if (resolvedId) {
            assigneeId = resolvedId;
            assigneeName = await getAssigneeName(resolvedId);
          }
        }
      }
    }

    // 构建 update data
    const patchData: Record<string, unknown> = {
      currentStep: newStep,
      assignee: assigneeName,
      assigneeId,
      rejectReason: body.rejectReason,
      gitHash: body.gitHash,
      deployVersion: body.deployVersion,
    };
    if (body.title !== undefined) patchData.title = body.title;
    if (body.description !== undefined) patchData.description = body.description;
    if (body.workflowId !== undefined) patchData.workflowId = body.workflowId;

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: patchData,
      include: requirementInclude
    });

    void notifyEvent('requirement.updated', {
      id: updated.id, title: updated.title, actor: req.user!.name, assignee: assigneeName
    });

    res.json(serializeRequirement(updated));
  })
);

}
