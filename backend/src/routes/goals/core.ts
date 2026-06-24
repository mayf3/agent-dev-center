import { authRequired } from '../../middleware/auth.js';
import { agentTokenRequired } from '../../middleware/marketplace-auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requireOkrEdit, resolveAgentParam } from './permissions.js';

export function registerCoreRoutes(router: import('express').Router): void {

// GET /mine - Agent 自助: 读取自己的目标卡
router.get(
  '/mine',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) return agentTokenRequired(req, res, next);
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    if (req.agentAuth) {
      const goalCard = await prisma.agentGoalCard.findUnique({
        where: { agentId: req.agentAuth.agentId },
        include: { agent: { select: { id: true, name: true, displayName: true } } },
      });
      res.json({ goalCard });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { marketplaceAgents: { take: 1 } },
    });
    if (!user?.marketplaceAgents.length) throw new HttpError(404, '当前用户未关联 Agent');

    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: user.marketplaceAgents[0].id },
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });

    res.json({ goalCard });
  })
);

// GET / - 列出所有目标卡
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) return agentTokenRequired(req, res, next);
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const pipeline = req.query.pipeline as string | undefined;
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};
    if (pipeline) where.pipeline = pipeline;
    if (status) where.status = status;

    const goalCards = await prisma.agentGoalCard.findMany({
      where,
      include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ goalCards });
  })
);

// GET /by-name/:openclawAgentId - 按 name 查询目标卡
router.get(
  '/by-name/:openclawAgentId',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) return agentTokenRequired(req, res, next);
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const key = String(req.params.openclawAgentId);

    const agent = await prisma.marketplaceAgent.findFirst({
      where: {
        OR: [
          { openclawAgentId: { equals: key, mode: 'insensitive' } },
          { name: { equals: key, mode: 'insensitive' } },
        ],
      },
    });

    if (!agent) throw new HttpError(404, `Agent "${key}" 不存在`);

    if (req.agentAuth) {
      if (req.agentAuth.agentId !== agent.id) throw new HttpError(403, 'Agent 只能查询自己的目标卡');
    } else {
      const user = req.user as Express.AuthUser | undefined;
      if (user) {
        const okrRole = user.okrRole;
        if (!okrRole || !['okr_admin', 'okr_owner', 'okr_reviewer'].includes(okrRole)) {
          throw new HttpError(403, '需要 okr_admin / okr_owner / okr_reviewer 权限');
        }
      }
    }

    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: agent.id },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true, openclawAgentId: true, capabilities: true } },
      },
    });

    if (!goalCard) throw new HttpError(404, `Agent "${key}" 暂无目标卡`);

    res.json({
      agent: { id: agent.id, name: agent.name, displayName: agent.displayName, openclawAgentId: agent.openclawAgentId },
      pipeline: goalCard.pipeline, layer: goalCard.layer,
      longTermDirection: goalCard.longTermDirection,
      monthlyGoals: (goalCard.monthlyGoals as Array<{ month: string; goals: Array<{ text: string; status: string }> }>) || [],
      status: goalCard.status, updatedAt: goalCard.updatedAt,
    });
  })
);

// GET /:agentId - 获取单个目标卡
router.get(
  '/:agentId',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) return agentTokenRequired(req, res, next);
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const agent = await resolveAgentParam(String(req.params.agentId));

    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: agent.id },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
        revisions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!goalCard) throw new HttpError(404, `Agent "${agent.name}" 暂无目标卡`);

    res.json({ goalCard });
  })
);

// GET /unassigned/list - 获取未规划 Agent 列表
router.get(
  '/unassigned/list',
  authRequired,
  asyncHandler(async (_req, res) => {
    const agentsWithGoals = await prisma.agentGoalCard.findMany({
      where: { status: 'active' },
      select: { agentId: true },
    });
    const assignedIds = agentsWithGoals.map((g) => g.agentId);

    const unassigned = await prisma.marketplaceAgent.findMany({
      where: { id: { notIn: assignedIds }, status: 'active' },
      select: { id: true, name: true, displayName: true, avatar: true, capabilities: true },
      orderBy: { name: 'asc' },
    });

    res.json({ agents: unassigned });
  })
);

// POST / - 创建目标卡
router.post(
  '/',
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    const { agentId, pipeline, longTermDirection, monthlyGoals, selfCheckCriteria, upstreamAgentIds, downstreamAgentIds } = req.body as {
      agentId: string; pipeline: string; longTermDirection: string;
      monthlyGoals?: any[]; selfCheckCriteria?: string; upstreamAgentIds?: string[]; downstreamAgentIds?: string[];
    };

    if (!agentId || !pipeline || !longTermDirection) throw new HttpError(400, '缺少必填字段: agentId, pipeline, longTermDirection');

    const validPipelines = ['content', 'parenting', 'investment', 'health', 'planning', 'lifestyle', 'devops', 'education', 'business', 'cross-cutting'];
    if (!validPipelines.includes(pipeline)) throw new HttpError(400, `无效的 pipeline 值: "${pipeline}"。有效值: ${validPipelines.join(', ')}`);

    const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new HttpError(404, 'Agent 不存在');

    const existing = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (existing) throw new HttpError(409, '该 Agent 已有目标卡，请使用 PUT 更新');

    const goalCard = await prisma.agentGoalCard.create({
      data: {
        agentId, pipeline: pipeline as any, longTermDirection,
        monthlyGoals: (monthlyGoals || []) as any, selfCheckCriteria: selfCheckCriteria || '',
        upstreamAgentIds: upstreamAgentIds || [], downstreamAgentIds: downstreamAgentIds || [],
        status: 'active',
      },
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });

    await prisma.goalRevision.create({
      data: {
        goalCardId: goalCard.id, longTermDirection, monthlyGoals: (monthlyGoals || []) as any,
        selfCheckCriteria: selfCheckCriteria || '', pipeline: pipeline as any,
        changeNote: '创建目标卡', changedBy: req.user!.name, changedById: req.user!.id,
      },
    });

    res.status(201).json({ goalCard });
  })
);

// PUT /:agentId - 更新目标卡
router.put(
  '/:agentId',
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    const agent = await resolveAgentParam(String(req.params.agentId));
    const agentId = agent.id;

    const body = req.body as {
      pipeline?: string; longTermDirection?: string; monthlyGoals?: any[];
      selfCheckCriteria?: string; upstreamAgentIds?: string[]; downstreamAgentIds?: string[];
      status?: string; changeNote?: string;
    };

    const existing = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!existing) throw new HttpError(404, '目标卡不存在');

    const validPipelines = ['content', 'parenting', 'investment', 'health', 'planning', 'lifestyle', 'devops', 'education', 'business', 'cross-cutting'];
    if (body.pipeline !== undefined && !validPipelines.includes(body.pipeline)) {
      throw new HttpError(400, `无效的 pipeline 值: "${body.pipeline}"`);
    }

    const updateData: Record<string, unknown> = {};
    if (body.pipeline !== undefined) updateData.pipeline = body.pipeline;
    if (body.longTermDirection !== undefined) updateData.longTermDirection = body.longTermDirection;
    if (body.monthlyGoals !== undefined) updateData.monthlyGoals = body.monthlyGoals;
    if (body.selfCheckCriteria !== undefined) updateData.selfCheckCriteria = body.selfCheckCriteria;
    if (body.upstreamAgentIds !== undefined) updateData.upstreamAgentIds = body.upstreamAgentIds;
    if (body.downstreamAgentIds !== undefined) updateData.downstreamAgentIds = body.downstreamAgentIds;
    if (body.status !== undefined) updateData.status = body.status;

    const goalCard = await prisma.agentGoalCard.update({
      where: { agentId },
      data: updateData,
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });

    const keyFields = ['longTermDirection', 'monthlyGoals', 'selfCheckCriteria', 'pipeline'];
    const hasKeyChange = keyFields.some((f) => (body as Record<string, unknown>)[f] !== undefined);
    if (hasKeyChange) {
      await prisma.goalRevision.create({
        data: {
          goalCardId: goalCard.id, longTermDirection: goalCard.longTermDirection,
          monthlyGoals: goalCard.monthlyGoals as any, selfCheckCriteria: goalCard.selfCheckCriteria,
          pipeline: goalCard.pipeline, changeNote: body.changeNote || '更新目标卡',
          changedBy: req.user!.name, changedById: req.user!.id,
        },
      });
    }

    res.json({ goalCard });
  })
);

}
