import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  claimMarketplaceTaskSchema,
  createTaskSchema,
  listMarketplaceTasksSchema,
  marketplaceIdSchema,
  updateTaskSchema
} from '../schemas/marketplace.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const marketplaceTasksRouter = Router();

const taskStatusValues = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;

function emptyTaskStatusCounts() {
  return {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  };
}

marketplaceTasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listMarketplaceTasksSchema.parse({ query: req.query });
    const where: Prisma.MarketplaceTaskWhereInput = {};

    if (query.agentId) {
      where.agentId = query.agentId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.requesterId) {
      where.requesterId = query.requesterId;
    }

    if (query.priority) {
      where.priority = query.priority;
    }

    const skip = (query.page - 1) * query.limit;
    const [tasks, total] = await prisma.$transaction([
      prisma.marketplaceTask.findMany({
        where,
        include: {
          agent: true
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.limit
      }),
      prisma.marketplaceTask.count({ where })
    ]);

    res.json({
      data: tasks,
      pagination: {
        page: query.page,
        limit: query.limit,
        total
      }
    });
  })
);

marketplaceTasksRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [statusCounts, topAgents, recentTasks] = await prisma.$transaction([
      prisma.marketplaceTask.groupBy({
        by: ['status'],
        _count: { _all: true },
        orderBy: { status: 'asc' }
      }),
      prisma.marketplaceAgent.findMany({
        select: {
          id: true,
          name: true,
          displayName: true,
          avatar: true,
          status: true,
          _count: {
            select: { tasks: true }
          }
        },
        orderBy: {
          tasks: { _count: 'desc' }
        },
        take: 5
      }),
      prisma.marketplaceTask.findMany({
        include: {
          agent: true
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    const byStatus = emptyTaskStatusCounts();
    for (const item of statusCounts) {
      const count = typeof item._count === 'object' ? (item._count as Record<string, number>)._all ?? 0 : 0;
      byStatus[item.status as keyof typeof byStatus] = count;
    }

    res.json({
      data: {
        byStatus,
        topAgents,
        recentTasks
      }
    });
  })
);

marketplaceTasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params } = marketplaceIdSchema.parse({ params: req.params });

    const task = await prisma.marketplaceTask.findUnique({
      where: { id: params.id },
      include: {
        agent: true,
        requester: { select: { id: true, name: true, email: true } },
        deliverables: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!task) {
      throw new HttpError(404, '市场任务不存在');
    }

    res.json({ data: task });
  })
);

marketplaceTasksRouter.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = createTaskSchema.parse({ body: req.body });

    const agent = await prisma.marketplaceAgent.findUnique({
      where: { name: body.agentName }
    });

    if (!agent) {
      throw new HttpError(404, '市场 Agent 不存在');
    }

    const task = await prisma.marketplaceTask.create({
      data: {
        agentId: agent.id,
        requesterId: req.user!.id,
        requesterName: req.user!.name,
        title: body.title,
        description: body.description,
        input: body.input as Prisma.InputJsonValue | undefined,
        priority: body.priority,
        deadline: body.deadline,
        status: 'pending'
      },
      include: {
        agent: true,
        requester: { select: { id: true, name: true, email: true } },
        deliverables: true
      }
    });

    res.status(201).json({ data: task });
  })
);

marketplaceTasksRouter.patch(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = updateTaskSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.marketplaceTask.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      throw new HttpError(404, '市场任务不存在');
    }

    const data: Prisma.MarketplaceTaskUpdateInput = {
      status: body.status,
      startedAt: body.startedAt,
      completedAt: body.completedAt,
      errorMsg: body.errorMsg
    };

    if (body.status && body.status !== existing.status) {
      if (body.status === 'processing') {
        data.startedAt = new Date();
      }

      if (body.status === 'completed' || body.status === 'failed') {
        data.completedAt = new Date();
      }
    }

    const task = await prisma.marketplaceTask.update({
      where: { id: params.id },
      data,
      include: {
        agent: true,
        requester: { select: { id: true, name: true, email: true } },
        deliverables: { orderBy: { createdAt: 'desc' } }
      }
    });

    res.json({ data: task });
  })
);

marketplaceTasksRouter.post(
  '/:id/claim',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = claimMarketplaceTaskSchema.parse({ body: req.body });

    const agent = await prisma.marketplaceAgent.findUnique({
      where: { name: body.agentName }
    });

    if (!agent) {
      throw new HttpError(404, '市场 Agent 不存在');
    }

    const task = await prisma.$transaction(async (tx) => {
      const pendingTask = await tx.marketplaceTask.findFirst({
        where: {
          agentId: agent.id,
          status: 'pending'
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
      });

      if (!pendingTask) {
        throw new HttpError(404, '暂无待领取任务');
      }

      const result = await tx.marketplaceTask.updateMany({
        where: {
          id: pendingTask.id,
          status: 'pending'
        },
        data: {
          status: 'processing',
          startedAt: new Date()
        }
      });

      if (result.count === 0) {
        throw new HttpError(409, '任务已被领取');
      }

      return tx.marketplaceTask.findUnique({
        where: { id: pendingTask.id },
        include: {
          agent: true,
          requester: { select: { id: true, name: true, email: true } },
          deliverables: { orderBy: { createdAt: 'desc' } }
        }
      });
    });

    res.json({ data: task });
  })
);
