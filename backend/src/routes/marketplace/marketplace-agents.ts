import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  createAgentSchema,
  listAgentsSchema,
  marketplaceIdSchema,
  updateAgentSchema
} from '../../schemas/marketplace.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

export const marketplaceAgentsRouter = Router();

// GET /me — must be before /:id to avoid "me" being treated as UUID
marketplaceAgentsRouter.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const agents = await prisma.marketplaceAgent.findMany({
      where: { ownerId: userId },
      orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
      include: {
        owner: { select: { id: true, name: true, email: true } }
      }
    });

    res.json({ data: agents });
  })
);

marketplaceAgentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { query } = listAgentsSchema.parse({ query: req.query });
    const where: Prisma.MarketplaceAgentWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    const agents = await prisma.marketplaceAgent.findMany({
      where,
      orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }]
    });

    res.json({ data: agents });
  })
);

marketplaceAgentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { params } = marketplaceIdSchema.parse({ params: req.params });

    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } }
      }
    });

    if (!agent) {
      throw new HttpError(404, '市场 Agent 不存在');
    }

    const stats = await prisma.marketplaceTask.groupBy({
      by: ['status'],
      where: { agentId: params.id },
      _count: { _all: true }
    });

    const taskStats = {
      pending: stats.find((item) => item.status === 'pending')?._count._all ?? 0,
      processing: stats.find((item) => item.status === 'processing')?._count._all ?? 0,
      completed: stats.find((item) => item.status === 'completed')?._count._all ?? 0
    };

    res.json({ data: { ...agent, taskStats } });
  })
);

marketplaceAgentsRouter.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { body } = createAgentSchema.parse({ body: req.body });

    const agent = await prisma.marketplaceAgent.upsert({
      where: { name: body.name },
      update: {
        displayName: body.displayName,
        description: body.description,
        avatar: body.avatar,
        capabilities: body.capabilities as Prisma.InputJsonValue,
        apiEndpoint: body.apiEndpoint,
        ownerId: req.user!.id
      },
      create: {
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        avatar: body.avatar,
        capabilities: body.capabilities as Prisma.InputJsonValue,
        apiEndpoint: body.apiEndpoint,
        ownerId: req.user!.id
      },
      include: {
        owner: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json({ data: agent });
  })
);

marketplaceAgentsRouter.patch(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params, body } = updateAgentSchema.parse({
      params: req.params,
      body: req.body
    });

    const existing = await prisma.marketplaceAgent.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      throw new HttpError(404, '市场 Agent 不存在');
    }

    const agent = await prisma.marketplaceAgent.update({
      where: { id: params.id },
      data: {
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        avatar: body.avatar,
        capabilities: body.capabilities as Prisma.InputJsonValue | undefined,
        apiEndpoint: body.apiEndpoint,
        status: body.status
      },
      include: {
        owner: { select: { id: true, name: true, email: true } }
      }
    });

    res.json({ data: agent });
  })
);

marketplaceAgentsRouter.delete(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { params } = marketplaceIdSchema.parse({ params: req.params });

    const existing = await prisma.marketplaceAgent.findUnique({
      where: { id: params.id }
    });

    if (!existing) {
      throw new HttpError(404, '市场 Agent 不存在');
    }

    const agent = await prisma.marketplaceAgent.update({
      where: { id: params.id },
      data: { status: 'inactive' }
    });

    res.json({ data: agent });
  })
);
