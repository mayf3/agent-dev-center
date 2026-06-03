import { Prisma } from '@prisma/client';
import { authRequired, requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

export function registerCoreRoutes(router: import('express').Router): void {

interface MonthlyGoal {
  text: string;
  status: 'not_started' | 'in_progress' | 'done';
}

interface MonthlyGoalGroup {
  month: string;
  goals: MonthlyGoal[];
}

// GET / - 列出所有 Agent（含目标卡）
router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const layer = req.query.layer as string | undefined;
    const pipeline = req.query.pipeline as string | undefined;
    const search = req.query.search as string | undefined;

    const where: Prisma.MarketplaceAgentWhereInput = {};
    if (layer) where.tags = { has: layer };

    const agents = await prisma.marketplaceAgent.findMany({
      where,
      include: {
        goalCard: {
          include: { revisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
      orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
    });

    let result = agents.map((agent) => {
      const goalCard = agent.goalCard;
      const monthlyGoals: MonthlyGoalGroup[] = (goalCard?.monthlyGoals as any) || [];
      const totalGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.length, 0);
      const doneGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.filter((goal) => goal.status === 'done').length, 0);
      const inProgressGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.filter((goal) => goal.status === 'in_progress').length, 0);

      return {
        id: agent.id, name: agent.name, displayName: agent.displayName,
        description: agent.description, avatar: agent.avatar,
        capabilities: agent.capabilities, apiEndpoint: agent.apiEndpoint,
        status: agent.status, tags: agent.tags,
        lastHeartbeatAt: agent.lastHeartbeatAt, createdAt: agent.createdAt, updatedAt: agent.updatedAt,
        goalCard: goalCard ? {
          id: goalCard.id, pipeline: goalCard.pipeline,
          longTermDirection: goalCard.longTermDirection, monthlyGoals: goalCard.monthlyGoals,
          selfCheckCriteria: goalCard.selfCheckCriteria, pushedMonths: goalCard.pushedMonths,
          status: goalCard.status, lastReviewedAt: goalCard.lastReviewedAt,
          lastReviewedBy: goalCard.lastReviewedBy,
          upstreamAgentIds: goalCard.upstreamAgentIds, downstreamAgentIds: goalCard.downstreamAgentIds,
          stats: { total: totalGoals, done: doneGoals, inProgress: inProgressGoals },
        } : null,
      };
    });

    if (pipeline) result = result.filter((agent) => agent.goalCard?.pipeline === pipeline);

    if (search) {
      const term = search.toLowerCase();
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(term) ||
          agent.displayName.toLowerCase().includes(term) ||
          agent.description.toLowerCase().includes(term)
      );
    }

    res.json({ data: result });
  })
);

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /me - 获取当前用户关联的 Agent 详情
router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    // Match by userId (direct link), ownerId (legacy), or by id (if user.id happens to be agent.id)
    const agent = await prisma.marketplaceAgent.findFirst({
      where: {
        OR: [
          { userId },
          { ownerId: userId },
          { id: userId },
        ],
      },
      include: {
        goalCard: {
          include: { revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        },
        accessTokens: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!agent) throw new HttpError(404, '当前用户未关联 Agent');

    const taskStats = await prisma.marketplaceTask.groupBy({
      by: ['status'],
      where: { agentId: agent.id },
      _count: { _all: true },
    });

    const taskCounts = {
      pending: taskStats.find((t) => t.status === 'pending')?._count._all ?? 0,
      processing: taskStats.find((t) => t.status === 'processing')?._count._all ?? 0,
      completed: taskStats.find((t) => t.status === 'completed')?._count._all ?? 0,
      failed: taskStats.find((t) => t.status === 'failed')?._count._all ?? 0,
    };

    const goalCard = agent.goalCard;
    const monthlyGoals: MonthlyGoalGroup[] = (goalCard?.monthlyGoals as any) || [];
    const totalGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.length, 0);
    const doneGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.filter((goal) => goal.status === 'done').length, 0);

    res.json({
      data: {
        id: agent.id, name: agent.name, displayName: agent.displayName,
        description: agent.description, avatar: agent.avatar,
        capabilities: agent.capabilities, apiEndpoint: agent.apiEndpoint,
        status: agent.status, tags: agent.tags,
        notificationType: agent.notificationType, feishuWebhookUrl: agent.feishuWebhookUrl,
        lastHeartbeatAt: agent.lastHeartbeatAt, createdAt: agent.createdAt, updatedAt: agent.updatedAt,
        ownerId: agent.ownerId,
        taskStats: taskCounts,
        goalCard: goalCard ? {
          id: goalCard.id, pipeline: goalCard.pipeline,
          longTermDirection: goalCard.longTermDirection, monthlyGoals: goalCard.monthlyGoals,
          selfCheckCriteria: goalCard.selfCheckCriteria, pushedMonths: goalCard.pushedMonths,
          status: goalCard.status, lastReviewedAt: goalCard.lastReviewedAt,
          lastReviewedBy: goalCard.lastReviewedBy,
          upstreamAgentIds: goalCard.upstreamAgentIds, downstreamAgentIds: goalCard.downstreamAgentIds,
          revisions: goalCard.revisions,
          stats: { total: totalGoals, done: doneGoals },
        } : null,
      },
    });
  })
);

// GET /:agentId - 获取单个 Agent 详情
router.get(
  '/:agentId',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);

    // UUID format validation — non-UUID strings get a clear 404
    if (!UUID_REGEX.test(agentId)) {
      throw new HttpError(404, `Agent 不存在: "${agentId}" (无效 ID 格式)`);
    }

    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: agentId },
      include: {
        goalCard: {
          include: { revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        },
        accessTokens: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!agent) throw new HttpError(404, 'Agent 不存在');

    const taskStats = await prisma.marketplaceTask.groupBy({
      by: ['status'],
      where: { agentId },
      _count: { _all: true },
    });

    const taskCounts = {
      pending: taskStats.find((t) => t.status === 'pending')?._count._all ?? 0,
      processing: taskStats.find((t) => t.status === 'processing')?._count._all ?? 0,
      completed: taskStats.find((t) => t.status === 'completed')?._count._all ?? 0,
      failed: taskStats.find((t) => t.status === 'failed')?._count._all ?? 0,
    };

    const goalCard = agent.goalCard;
    const monthlyGoals: MonthlyGoalGroup[] = (goalCard?.monthlyGoals as any) || [];
    const totalGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.length, 0);
    const doneGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.filter((goal) => goal.status === 'done').length, 0);

    res.json({
      data: {
        id: agent.id, name: agent.name, displayName: agent.displayName,
        description: agent.description, avatar: agent.avatar,
        capabilities: agent.capabilities, apiEndpoint: agent.apiEndpoint,
        status: agent.status, tags: agent.tags,
        notificationType: agent.notificationType, feishuWebhookUrl: agent.feishuWebhookUrl,
        lastHeartbeatAt: agent.lastHeartbeatAt, createdAt: agent.createdAt, updatedAt: agent.updatedAt,
        taskStats: taskCounts,
        goalCard: goalCard ? {
          id: goalCard.id, pipeline: goalCard.pipeline,
          longTermDirection: goalCard.longTermDirection, monthlyGoals: goalCard.monthlyGoals,
          selfCheckCriteria: goalCard.selfCheckCriteria, pushedMonths: goalCard.pushedMonths,
          status: goalCard.status, lastReviewedAt: goalCard.lastReviewedAt,
          lastReviewedBy: goalCard.lastReviewedBy,
          upstreamAgentIds: goalCard.upstreamAgentIds, downstreamAgentIds: goalCard.downstreamAgentIds,
          revisions: goalCard.revisions,
          stats: { total: totalGoals, done: doneGoals },
        } : null,
      },
    });
  })
);

// GET /layers/list - 获取层（tag）列表
router.get(
  '/layers/list',
  authRequired,
  asyncHandler(async (_req, res) => {
    const agents = await prisma.marketplaceAgent.findMany({ select: { tags: true } });

    const layerSet = new Set<string>();
    for (const agent of agents) {
      for (const tag of agent.tags) layerSet.add(tag);
    }

    res.json({ data: Array.from(layerSet).sort() });
  })
);

// PATCH /:agentId - 更新 Agent 标签
router.patch(
  '/:agentId',
  authRequired,
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const { tags } = req.body as { tags?: string[] };

    if (!tags) throw new HttpError(400, '缺少 tags 字段');

    const agent = await prisma.marketplaceAgent.update({
      where: { id: agentId },
      data: { tags },
    });

    res.json({ data: agent });
  })
);

}
