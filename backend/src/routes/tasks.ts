import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { createTaskSchema, deleteTaskSchema, listTasksSchema, patchTaskSchema } from '../schemas/tasks.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { prismaTaskStatus, serializeTask } from '../utils/status.js';
import { notifyEvent } from '../utils/notifications.js';

export const tasksRouter = Router();

tasksRouter.use(authRequired);

function roleAwareTaskWhere(user: Express.AuthUser): Prisma.TaskWhereInput {
  if (user.role === 'admin') {
    return {};
  }

  if (user.role === 'developer') {
    return {
      OR: [{ agentType: user.name }, { agentType: user.email }]
    };
  }

  // requester: 基于 requesterId 匹配，兼容旧数据用 name/email fallback
  return {
    requirement: {
      OR: [{ requesterId: user.id }, { requester: user.name }, { requester: user.email }]
    }
  };
}

tasksRouter.post(
  '/',
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const { body } = createTaskSchema.parse({ body: req.body });
    const requirement = await prisma.requirement.findUnique({
      where: { id: body.requirementId }
    });

    if (!requirement) {
      throw new HttpError(404, '需求不存在');
    }

    // 查找 assignee 对应的 userId
    const assigneeUser = await prisma.user.findFirst({
      where: {
        OR: [{ name: body.agentType }, { email: body.agentType }]
      },
      select: { id: true }
    });

    const task = await prisma.$transaction(async (tx) => {
      await tx.requirement.update({
        where: { id: body.requirementId },
        data: {
          assignee: body.agentType,
          assigneeId: assigneeUser?.id ?? null,
          status: requirement.status === 'pending' || requirement.status === 'rejected' ? 'approved' : undefined,
          rejectReason: null
        }
      });

      return tx.task.create({
        data: {
          requirementId: body.requirementId,
          title: body.title,
          description: body.description,
          agentType: body.agentType
        }
      });
    });

    void notifyEvent('task.created', {
      id: task.id,
      title: task.title,
      actor: req.user!.name,
      agentType: task.agentType,
      requesterId: req.user!.id,
      assigneeId: assigneeUser?.id ?? null
    });

    res.status(201).json(serializeTask(task));
  })
);

tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listTasksSchema.parse({ query: req.query });
    const where: Prisma.TaskWhereInput = {
      AND: [roleAwareTaskWhere(req.user!)]
    };

    if (query.requirementId) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { requirementId: query.requirementId }];
    }

    if (query.status) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { status: prismaTaskStatus[query.status] }];
    }

    if (query.agentType) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { agentType: query.agentType }];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: { requirement: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });

    res.json({
      data: tasks.map((task) => ({
        ...serializeTask(task),
        requirement: {
          id: task.requirement.id,
          title: task.requirement.title,
          status: task.requirement.status,
          priority: task.requirement.priority
        }
      }))
    });
  })
);

tasksRouter.patch(
  '/:id',
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const { params, body } = patchTaskSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.task.findUnique({
      where: { id: params.id },
      include: { requirement: true }
    });

    if (!existing) {
      throw new HttpError(404, '任务不存在');
    }

    if (
      req.user!.role === 'developer' &&
      existing.agentType !== req.user!.name &&
      existing.agentType !== req.user!.email
    ) {
      throw new HttpError(403, '无权更新该任务');
    }

    const task = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: params.id },
        data: {
          status: prismaTaskStatus[body.status]
        }
      });

      if (body.status === 'in-progress') {
        await tx.requirement.update({
          where: { id: existing.requirementId },
          data: { status: 'in_progress' }
        });
      }

      if (body.status === 'done') {
        const unfinishedCount = await tx.task.count({
          where: {
            requirementId: existing.requirementId,
            id: { not: params.id },
            status: { not: 'done' }
          }
        });

        await tx.requirement.update({
          where: { id: existing.requirementId },
          data: { status: unfinishedCount === 0 ? 'review' : 'in_progress' }
        });
      }

      return updatedTask;
    });

    void notifyEvent('task.status_changed', {
      id: task.id,
      title: task.title,
      status: body.status,
      actor: req.user!.name,
      agentType: task.agentType
    });

    res.json(serializeTask(task));
  })
);

tasksRouter.delete(
  '/:id',
  requireRoles('admin'),
  asyncHandler(async (req, res) => {
    const { params } = deleteTaskSchema.parse({ params: req.params });

    const existing = await prisma.task.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      throw new HttpError(404, '任务不存在');
    }

    await prisma.task.delete({
      where: { id: params.id }
    });

    void notifyEvent('task.deleted', {
      id: existing.id,
      title: existing.title,
      actor: req.user!.name
    });

    res.json({ success: true, id: existing.id });
  })
);
