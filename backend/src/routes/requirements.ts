import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  createRequirementSchema,
  listRequirementsSchema,
  patchRequirementSchema,
  requirementIdSchema,
  updateRequirementSchema
} from '../schemas/requirements.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import {
  prismaRequirementStatus,
  serializeRequirement,
  type RequirementStatusApi
} from '../utils/status.js';
import { notifyEvent } from '../utils/notifications.js';

export const requirementsRouter = Router();

requirementsRouter.use(authRequired);

/** 权限判断：是否可查看该需求（基于 user.id） */
function canReadRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; assigneeId: string | null; assignee: string | null }) {
  if (user.role === 'admin') {
    return true;
  }

  if (user.role === 'requester') {
    // 优先用 ID 匹配，兼容旧数据用 name/email fallback
    return requirement.requesterId === user.id ||
           requirement.requester === user.name ||
           requirement.requester === user.email;
  }

  // developer
  return requirement.assigneeId === user.id ||
         requirement.assignee === user.name ||
         requirement.assignee === user.email;
}

/** 权限判断：是否可编辑该需求（基于 user.id） */
function canEditRequirement(user: Express.AuthUser, requirement: { requesterId: string | null; requester: string; status: unknown }) {
  if (user.role === 'admin') {
    return true;
  }

  return (
    user.role === 'requester' &&
    (requirement.requesterId === user.id || requirement.requester === user.name) &&
    ['pending', 'rejected'].includes(String(requirement.status))
  );
}

/** 基于角色过滤查询条件（使用 user.id） */
function roleAwareRequirementWhere(user: Express.AuthUser): Prisma.RequirementWhereInput {
  if (user.role === 'admin') {
    return {};
  }

  if (user.role === 'requester') {
    return {
      OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
    };
  }

  return {
    OR: [{ assigneeId: user.id }, { assignee: user.name }, { assignee: user.email }]
  };
}

function buildStatusData(status?: RequirementStatusApi) {
  return status ? prismaRequirementStatus[status] : undefined;
}

requirementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { body } = createRequirementSchema.parse({ body: req.body });
    const actor = req.user!;

    const requirement = await prisma.requirement.create({
      data: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        requester: body.requester ?? actor.name,
        requesterId: actor.id,
        department: body.department,
        assignee: body.assignee,
        dueDate: body.dueDate,
        attachment: body.attachment
      },
      include: { tasks: true }
    });

    void notifyEvent('requirement.submitted', {
      id: requirement.id,
      title: requirement.title,
      actor: actor.name,
      assignee: requirement.assignee
    });

    res.status(201).json(serializeRequirement(requirement));
  })
);

requirementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listRequirementsSchema.parse({ query: req.query });
    const actor = req.user!;
    const where: Prisma.RequirementWhereInput = {
      AND: [roleAwareRequirementWhere(actor)]
    };

    if (query.status) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { status: buildStatusData(query.status) }];
    }

    if (query.priority) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { priority: query.priority }];
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
        where,
        include: { tasks: true },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize
      }),
      prisma.requirement.count({ where })
    ]);

    res.json({
      data: requirements.map(serializeRequirement),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    });
  })
);

requirementsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { tasks: true }
    });

    if (!requirement) {
      throw new HttpError(404, '需求不存在');
    }

    if (!canReadRequirement(req.user!, requirement)) {
      throw new HttpError(403, '无权查看该需求');
    }

    res.json(serializeRequirement(requirement));
  })
);

requirementsRouter.patch(
  '/:id',
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const { params, body } = patchRequirementSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { tasks: true }
    });

    if (!existing) {
      throw new HttpError(404, '需求不存在');
    }

    if (req.user!.role === 'developer' && !canReadRequirement(req.user!, existing)) {
      throw new HttpError(403, '无权更新该需求');
    }

    if (body.status === 'rejected' && !body.rejectReason) {
      throw new HttpError(400, '拒绝需求时必须填写拒绝原因');
    }

    const targetAssignee = body.assignee ?? existing.assignee;
    const shouldCreateTask =
      targetAssignee &&
      ['approved', 'in-progress'].includes(body.status ?? '') &&
      existing.tasks.length === 0;

    const updated = await prisma.$transaction(async (tx) => {
      // 如果指定了 assignee，查找对应的 userId
      let assigneeId = existing.assigneeId;
      if (body.assignee && body.assignee !== existing.assignee) {
        const assigneeUser = await tx.user.findFirst({
          where: {
            OR: [{ name: body.assignee }, { email: body.assignee }]
          },
          select: { id: true }
        });
        assigneeId = assigneeUser?.id ?? null;
      }

      await tx.requirement.update({
        where: { id: params.id },
        data: {
          status: buildStatusData(body.status),
          assignee: body.assignee,
          assigneeId,
          rejectReason: body.status === 'rejected' ? body.rejectReason : body.status ? null : body.rejectReason
        }
      });

      if (shouldCreateTask) {
        await tx.task.create({
          data: {
            requirementId: params.id,
            title: `开发需求：${existing.title}`,
            description: existing.description,
            agentType: targetAssignee,
            status: 'todo'
          }
        });
      }

      return tx.requirement.findUniqueOrThrow({
        where: { id: params.id },
        include: { tasks: true }
      });
    });

    void notifyEvent('requirement.status_changed', {
      id: updated.id,
      title: updated.title,
      status: body.status,
      actor: req.user!.name,
      assignee: updated.assignee
    });

    res.json(serializeRequirement(updated));
  })
);

requirementsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params, body } = updateRequirementSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.requirement.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      throw new HttpError(404, '需求不存在');
    }

    if (!canEditRequirement(req.user!, existing)) {
      throw new HttpError(403, '无权编辑该需求');
    }

    // 解析 assignee 对应的 userId
    let assigneeId = existing.assigneeId;
    if (body.assignee !== undefined) {
      if (body.assignee) {
        const assigneeUser = await prisma.user.findFirst({
          where: {
            OR: [{ name: body.assignee }, { email: body.assignee }]
          },
          select: { id: true }
        });
        assigneeId = assigneeUser?.id ?? null;
      } else {
        assigneeId = null;
      }
    }

    const updated = await prisma.requirement.update({
      where: { id: params.id },
      data: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        requester: body.requester,
        department: body.department,
        assignee: body.assignee,
        assigneeId,
        dueDate: body.dueDate,
        attachment: body.attachment
      },
      include: { tasks: true }
    });

    void notifyEvent('requirement.updated', {
      id: updated.id,
      title: updated.title,
      actor: req.user!.name,
      assignee: updated.assignee
    });

    res.json(serializeRequirement(updated));
  })
);
