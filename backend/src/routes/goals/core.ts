import { authRequired } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requireOkrEdit, resolveAgentParam } from './permissions.js';

export function registerCoreRoutes(router: import('express').Router): void {

// GET /mine - Agent 自助: 读取自己的目标卡
router.get(
  '/mine',
  authRequired,
  asyncHandler(async (req, res) => {
    // 3e274d90: 用 User.id 查询 goalCard（解耦 marketplaceAgents）
    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: req.user!.id },
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });
    res.json({ goalCard });
  })
);

// GET / - 列出所有目标卡
router.get(
  '/',
  authRequired,
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
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    const key = String(req.params.openclawAgentId);

    // 3e274d90: 用 User 查找替代 marketplaceAgent
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { name: { equals: key, mode: 'insensitive' } },
          { email: { equals: key, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    });

    if (!user) throw new HttpError(404, `用户 "${key}" 不存在`);

    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: user.id },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      },
    });

    if (!goalCard) throw new HttpError(404, `用户 "${key}" 暂无目标卡`);

    res.json({
      agent: { id: user.id, name: user.name },
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
  authRequired,
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

    // 3e274d90: 查询未分配 goalCard 的用户（解耦 marketplaceAgent）
    const users = await prisma.user.findMany({
      where: { id: { notIn: assignedIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    res.json({ agents: users });
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

    const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { id: true, name: true } });
    if (!agent) throw new HttpError(404, '用户不存在');

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
