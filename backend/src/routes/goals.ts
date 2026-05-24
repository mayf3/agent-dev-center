import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { agentTokenRequired } from '../middleware/marketplace-auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { GoalStatus, PipelineName } from '@prisma/client';

export const goalsRouter = Router();

// ─── OKR Permission helpers (68e8ceed) ─────────────────────

function canEditGoals(okrRole: string | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

function requireOkrEdit(req: any, _res: any, next: any): void {
  const okrRole = req.user?.okrRole;
  if (!canEditGoals(okrRole)) {
    throw new HttpError(403, '需要 okr_admin / okr_reviewer / okr_owner 权限才能操作目标卡');
  }
  next();
}

// ─── Types ──────────────────────────────────────────────────

interface MonthlyGoal {
  text: string;
  status: 'not_started' | 'in_progress' | 'done';
}

interface MonthlyGoalGroup {
  month: string; // "2026-05"
  goals: MonthlyGoal[];
}

// ─── Helper: parse JSON monthlyGoals ────────────────────────

function parseMonthlyGoals(val: unknown): MonthlyGoalGroup[] {
  return (val as MonthlyGoalGroup[]) || [];
}

// ─── Helper: resolve agentId (UUID or name) to marketplaceAgent ───

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAgentParam(param: string): Promise<{ id: string; name: string }> {
  // If it's a valid UUID, try direct lookup
  if (UUID_REGEX.test(param)) {
    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: param },
      select: { id: true, name: true },
    });
    if (agent) return agent;
  }

  // Fallback: lookup by name (exact match, case-insensitive)
  const agent = await prisma.marketplaceAgent.findFirst({
    where: { name: { equals: param, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!agent) {
    throw new HttpError(404, `Agent 不存在: "${param}"`);
  }
  return agent;
}

// ─── Validate UUID format before Prisma queries ────────────

function assertValidUuid(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new HttpError(400, `无效的参数格式: ${fieldName} 不是有效的 UUID 格式`);
  }
}

// ─── 1. Agent 自助: 读取自己的目标卡 ────────────────────────

goalsRouter.get(
  '/mine',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) {
      return agentTokenRequired(req, res, next);
    }
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

    // Admin session: find agent by user's marketplaceAgents
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { marketplaceAgents: { take: 1 } },
    });
    if (!user?.marketplaceAgents.length) {
      throw new HttpError(404, '当前用户未关联 Agent');
    }
    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: user.marketplaceAgents[0].id },
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });

    res.json({ goalCard });
  })
);

// ─── 2. 列出所有目标卡 ──────────────────────────────────────

goalsRouter.get(
  '/',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) {
      return agentTokenRequired(req, res, next);
    }
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
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ goalCards });
  })
);

// ─── 3. 获取单个目标卡 ──────────────────────────────────────


// ─── 3. 按 name 查询目标卡 ──────────────────────────────────

goalsRouter.get(
  '/by-name/:openclawAgentId',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) {
      return agentTokenRequired(req, res, next);
    }
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const key = String(req.params.openclawAgentId);

    // 1. Look up agent by openclawAgentId first, then name
    const agent = await prisma.marketplaceAgent.findFirst({
      where: {
        OR: [
          { openclawAgentId: { equals: key, mode: 'insensitive' } },
          { name: { equals: key, mode: 'insensitive' } },
        ],
      },
    });

    if (!agent) {
      throw new HttpError(404, `Agent "${key}" 不存在`);
    }

    // 2. Permission check
    if (req.agentAuth) {
      if (req.agentAuth.agentId !== agent.id) {
        throw new HttpError(403, 'Agent 只能查询自己的目标卡');
      }
    } else {
      const user = req.user as Express.AuthUser | undefined;
      if (user) {
        const okrRole = user.okrRole;
        if (!okrRole || !['okr_admin', 'okr_owner', 'okr_reviewer'].includes(okrRole)) {
          throw new HttpError(403, '需要 okr_admin / okr_owner / okr_reviewer 权限');
        }
      }
    }

    // 3. Fetch goal card
    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: agent.id },
      include: {
        agent: {
          select: {
            id: true, name: true, displayName: true, avatar: true,
            openclawAgentId: true, capabilities: true,
          },
        },
      },
    });

    if (!goalCard) {
      throw new HttpError(404, `Agent "${key}" 暂无目标卡`);
    }

    // 4. Return structured response
    res.json({
      agent: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        openclawAgentId: agent.openclawAgentId,
      },
      pipeline: goalCard.pipeline,
      layer: goalCard.layer,
      longTermDirection: goalCard.longTermDirection,
      monthlyGoals: (goalCard.monthlyGoals as Array<{
        month: string;
        goals: Array<{ text: string; status: string }>;
      }>) || [],
      status: goalCard.status,
      updatedAt: goalCard.updatedAt,
    });
  })
);
goalsRouter.get(
  '/:agentId',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) {
      return agentTokenRequired(req, res, next);
    }
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const agentParam = String(req.params.agentId);

    // Resolve UUID or name to agent
    const agent = await resolveAgentParam(agentParam);

    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: agent.id },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
        revisions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!goalCard) {
      throw new HttpError(404, `Agent "${agent.name}" 暂无目标卡`);
    }

    res.json({ goalCard });
  })
);

// ─── 4. 获取未规划 Agent 列表 ───────────────────────────────

goalsRouter.get(
  '/unassigned/list',
  authRequired,
  asyncHandler(async (_req, res) => {
    const agentsWithGoals = await prisma.agentGoalCard.findMany({
      where: { status: 'active' },
      select: { agentId: true },
    });
    const assignedIds = agentsWithGoals.map((g) => g.agentId);

    const unassigned = await prisma.marketplaceAgent.findMany({
      where: {
        id: { notIn: assignedIds },
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        avatar: true,
        capabilities: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({ agents: unassigned });
  })
);

// ─── 5. 创建目标卡 ──────────────────────────────────────────

goalsRouter.post(
  '/',
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    const {
      agentId,
      pipeline,
      longTermDirection,
      monthlyGoals,
      selfCheckCriteria,
      upstreamAgentIds,
      downstreamAgentIds,
    } = req.body as {
      agentId: string;
      pipeline: string;
      longTermDirection: string;
      monthlyGoals?: MonthlyGoalGroup[];
      selfCheckCriteria?: string;
      upstreamAgentIds?: string[];
      downstreamAgentIds?: string[];
    };

    if (!agentId || !pipeline || !longTermDirection) {
      throw new HttpError(400, '缺少必填字段: agentId, pipeline, longTermDirection');
    }

    // Validate pipeline enum (68e8ceed: clearer error for invalid values)
    const validPipelines = ['content', 'parenting', 'investment', 'health', 'planning', 'lifestyle', 'devops', 'education', 'business', 'cross-cutting'];
    if (!validPipelines.includes(pipeline)) {
      throw new HttpError(400, `无效的 pipeline 值: "${pipeline}"。有效值: ${validPipelines.join(', ')}`);
    }

    const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new HttpError(404, 'Agent 不存在');
    }

    const existing = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (existing) {
      throw new HttpError(409, '该 Agent 已有目标卡，请使用 PUT 更新');
    }

    const goalCard = await prisma.agentGoalCard.create({
      data: {
        agentId,
        pipeline: pipeline as PipelineName,
        longTermDirection,
        monthlyGoals: (monthlyGoals || []) as any,
        selfCheckCriteria: selfCheckCriteria || '',
        upstreamAgentIds: upstreamAgentIds || [],
        downstreamAgentIds: downstreamAgentIds || [],
        status: 'active',
      },
      include: {
        agent: { select: { id: true, name: true, displayName: true } },
      },
    });

    await prisma.goalRevision.create({
      data: {
        goalCardId: goalCard.id,
        longTermDirection,
        monthlyGoals: (monthlyGoals || []) as any,
        selfCheckCriteria: selfCheckCriteria || '',
        pipeline: pipeline as PipelineName,
        changeNote: '创建目标卡',
        changedBy: req.user!.name,
        changedById: req.user!.id,
      },
    });

    res.status(201).json({ goalCard });
  })
);

// ─── 6. 更新目标卡 ──────────────────────────────────────────

goalsRouter.put(
  '/:agentId',
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    // Resolve agentId param: UUID or name
    const agent = await resolveAgentParam(String(req.params.agentId));
    const agentId = agent.id;

    const body = req.body as {
      pipeline?: string;
      longTermDirection?: string;
      monthlyGoals?: MonthlyGoalGroup[];
      selfCheckCriteria?: string;
      upstreamAgentIds?: string[];
      downstreamAgentIds?: string[];
      status?: string;
      changeNote?: string;
    };

    const existing = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!existing) {
      throw new HttpError(404, '目标卡不存在');
    }

    // Validate pipeline if provided (68e8ceed)
    if (body.pipeline !== undefined) {
      const validPipelines = ['content', 'parenting', 'investment', 'health', 'planning', 'lifestyle', 'devops', 'education', 'business', 'cross-cutting'];
      if (!validPipelines.includes(body.pipeline)) {
        throw new HttpError(400, `无效的 pipeline 值: "${body.pipeline}"。有效值: ${validPipelines.join(', ')}`);
      }
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
      include: {
        agent: { select: { id: true, name: true, displayName: true } },
      },
    });

    // Create revision if key fields changed
    const keyFields = ['longTermDirection', 'monthlyGoals', 'selfCheckCriteria', 'pipeline'];
    const hasKeyChange = keyFields.some((f) => (body as Record<string, unknown>)[f] !== undefined);
    if (hasKeyChange) {
      await prisma.goalRevision.create({
        data: {
          goalCardId: goalCard.id,
          longTermDirection: goalCard.longTermDirection,
          monthlyGoals: goalCard.monthlyGoals as any,
          selfCheckCriteria: goalCard.selfCheckCriteria,
          pipeline: goalCard.pipeline,
          changeNote: body.changeNote || '更新目标卡',
          changedBy: req.user!.name,
          changedById: req.user!.id,
        },
      });
    }

    res.json({ goalCard });
  })
);

// ─── 7. 更新月度目标状态 ────────────────────────────────────

goalsRouter.patch(
  '/:agentId/monthly-goals/:month/:goalIndex',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) {
      return agentTokenRequired(req, res, next);
    }
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const { month, goalIndex } = req.params as { month: string; goalIndex: string };
    // Resolve agentId param: UUID or name
    const agent = await resolveAgentParam(String(req.params.agentId));
    const agentId = agent.id;

    const { status } = req.body as { status: string };

    if (!status || !['not_started', 'in_progress', 'done'].includes(status)) {
      throw new HttpError(400, '无效的 status 值');
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) {
      throw new HttpError(404, '目标卡不存在');
    }

    const goals = parseMonthlyGoals(goalCard.monthlyGoals);
    const monthGroup = goals.find((g) => g.month === month);
    if (!monthGroup) {
      throw new HttpError(404, `月份 ${month} 不存在`);
    }

    const idx = parseInt(goalIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= monthGroup.goals.length) {
      throw new HttpError(400, '目标索引越界');
    }

    monthGroup.goals[idx].status = status as MonthlyGoal['status'];

    const updated = await prisma.agentGoalCard.update({
      where: { agentId },
      data: { monthlyGoals: goals as any },
    });

    res.json({ goalCard: updated });
  })
);

// ─── 8. 推送月度目标到 LLM Todo ─────────────────────────────

goalsRouter.post(
  '/:agentId/push-todos',
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    // Resolve agentId param: UUID or name
    const agent = await resolveAgentParam(String(req.params.agentId));
    const agentId = agent.id;

    const { month } = req.body as { month: string };

    if (!month) {
      throw new HttpError(400, '缺少 month 参数');
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) {
      throw new HttpError(404, '目标卡不存在');
    }

    // Check dedup
    if (goalCard.pushedMonths.includes(month)) {
      throw new HttpError(409, `月份 ${month} 已推送到 Todo，请勿重复推送`);
    }

    const goals = parseMonthlyGoals(goalCard.monthlyGoals);
    const monthGroup = goals.find((g) => g.month === month);
    if (!monthGroup) {
      throw new HttpError(404, `月份 ${month} 不存在`);
    }

    // Push to LLM Todo API
    const llmTodoUrl = process.env.LLM_TODO_API_URL || 'http://localhost:8720';
    const llmTodoToken = process.env.LLM_TODO_TOKEN || '';
    const created: string[] = [];

    for (const goal of monthGroup.goals) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (llmTodoToken) headers['Authorization'] = `Bearer ${llmTodoToken}`;

        const resp = await fetch(`${llmTodoUrl}/api/tasks`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: `[目标卡] ${goal.text}`,
            status: 'active',
            priority: 'medium',
            horizon: 'month',
            type: 'agent',
            source: 'goal-card',
            area: goalCard.pipeline,
          }),
        });

        if (resp.ok) {
          const data = await resp.json() as { task?: { id?: string } };
          if (data.task?.id) created.push(data.task.id);
        }
      } catch {
        // Continue pushing remaining goals even if one fails
      }
    }

    // Mark month as pushed
    const newPushedMonths = [...goalCard.pushedMonths, month];
    await prisma.agentGoalCard.update({
      where: { agentId },
      data: { pushedMonths: newPushedMonths },
    });

    res.json({
      created: created.length,
      taskIds: created,
      total: monthGroup.goals.length,
    });
  })
);

// ─── 9. 获取变更历史 ────────────────────────────────────────

goalsRouter.get(
  '/:agentId/revisions',
  authRequired,
  asyncHandler(async (req, res) => {
    // Resolve agentId param: UUID or name
    const agent = await resolveAgentParam(String(req.params.agentId));

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId: agent.id } });
    if (!goalCard) {
      throw new HttpError(404, '目标卡不存在');
    }

    const revisions = await prisma.goalRevision.findMany({
      where: { goalCardId: goalCard.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ revisions });
  })
);
