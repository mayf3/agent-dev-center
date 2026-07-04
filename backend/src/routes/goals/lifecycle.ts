import { authRequired } from '../../middleware/auth.js';
import { agentTokenRequired } from '../../middleware/marketplace-auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requireOkrEdit, parseMonthlyGoals, resolveAgentParam, type MonthlyGoal } from './permissions.js';
import { createRequirement, type CreateRequirementActor } from '../../services/requirement-create-service.js';
import { env } from '../../config/env.js';

export function registerLifecycleRoutes(router: import('express').Router): void {

// PATCH /:agentId/monthly-goals/:month/:goalIndex - 更新月度目标状态
router.patch(
  '/:agentId/monthly-goals/:month/:goalIndex',
  asyncHandler(async (req, res, next) => {
    const authHeader = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (authHeader?.startsWith('agent_')) return agentTokenRequired(req, res, next);
    return authRequired(req, res, next);
  }),
  asyncHandler(async (req, res) => {
    const { month, goalIndex } = req.params as { month: string; goalIndex: string };
    const agent = await resolveAgentParam(String(req.params.agentId));
    const agentId = agent.id;

    const { status } = req.body as { status: string };
    if (!status || !['not_started', 'in_progress', 'done'].includes(status)) {
      throw new HttpError(400, '无效的 status 值');
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    const goals = parseMonthlyGoals(goalCard.monthlyGoals);
    const monthGroup = goals.find((g) => g.month === month);
    if (!monthGroup) throw new HttpError(404, `月份 ${month} 不存在`);

    const idx = parseInt(goalIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= monthGroup.goals.length) throw new HttpError(400, '目标索引越界');

    monthGroup.goals[idx].status = status as MonthlyGoal['status'];

    const updated = await prisma.agentGoalCard.update({
      where: { agentId },
      data: { monthlyGoals: goals as any },
    });

    res.json({ goalCard: updated });
  })
);

// POST /:agentId/push-todos - 推送月度目标到 ADC Agent Todo
router.post(
  '/:agentId/push-todos',
  authRequired,
  requireOkrEdit,
  asyncHandler(async (req, res) => {
    const agent = await resolveAgentParam(String(req.params.agentId));
    const agentId = agent.id;

    const { month } = req.body as { month: string };
    if (!month) throw new HttpError(400, '缺少 month 参数');

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');
    if (goalCard.pushedMonths.includes(month)) throw new HttpError(409, `月份 ${month} 已推送到 Todo，请勿重复推送`);

    const goals = parseMonthlyGoals(goalCard.monthlyGoals);
    const monthGroup = goals.find((g) => g.month === month);
    if (!monthGroup) throw new HttpError(404, `月份 ${month} 不存在`);

    // ── Validate required Agent Todo config ─────────────────────
    const efficiencyUserId = env.AGENT_TODO_EFFICIENCY_USER_ID;
    const lobsterUserId = env.AGENT_TODO_LOBSTER_USER_ID;
    const executorUserId = env.AGENT_TODO_EXECUTOR_USER_ID;

    if (!efficiencyUserId) {
      throw new HttpError(500, 'Agent Todo 配置缺失: AGENT_TODO_EFFICIENCY_USER_ID');
    }
    if (!lobsterUserId) {
      throw new HttpError(500, 'Agent Todo 配置缺失: AGENT_TODO_LOBSTER_USER_ID');
    }
    if (!executorUserId) {
      throw new HttpError(500, 'Agent Todo 配置缺失: AGENT_TODO_EXECUTOR_USER_ID');
    }

    // The auth actor is the req.user from authRequired (human user with okr roles).
    // Domain scope middleware is NOT mounted on goals routes, so we pass the raw
    // actor fields and let the shared service resolve domain scope from the DB.
    const actor = req.user!;
    const createActor: CreateRequirementActor = {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      internalRole: actor.internalRole,
      roles: actor.roles,
      // allowedDomainKeys is intentionally undefined — the shared service will
      // resolve domain scope from the database via resolveDomainScope().
    };

    // Query-before-create: check if a requirement already exists for this
    // goal/month/agent combo.  The title prefix "[目标卡]" + goal text is
    // a stable marker we check to avoid duplicate re-creation on retry.
    const existingRequirements = await prisma.requirement.findMany({
      where: {
        domainKey: 'agent-todo',
        title: { startsWith: '[目标卡]' },
        requesterId: actor.id,
      },
      select: { id: true, title: true },
    });

    const requirementIds: string[] = [];
    const created: string[] = [];

    for (const goal of monthGroup.goals) {
      const expectedTitle = `[目标卡] ${goal.text}`;

      // Check if already created (dedup via title + domainKey + requesterId)
      const existing = existingRequirements.find(r => r.title === expectedTitle);
      if (existing) {
        requirementIds.push(existing.id);
        created.push(existing.id); // compat alias
        continue;
      }

      // ── Create ADC Requirement via shared service ──────────
      const result = await createRequirement(createActor, {
        title: expectedTitle,
        description:
          `Goal Card push for ${month}. Agent: ${agentId}. Pipeline: ${goalCard.pipeline}.`,
        domainKey: 'agent-todo',
        workflowTemplateKey: 'agent-todo-v1',
        workflowRoleAssignments: {
          'efficiency-manager': efficiencyUserId,
          'lobster-partner': lobsterUserId,
          'executor': executorUserId,
        },
        priority: 'P2',
        type: 'FEATURE',
        tags: [
          'goal-card',
          `goal-month:${month}`,
          `goal-agent:${agentId}`,
          `goal-pipeline:${goalCard.pipeline}`,
        ],
      });

      requirementIds.push(result.id);
      created.push(result.id);
    }

    const newPushedMonths = [...goalCard.pushedMonths, month];
    await prisma.agentGoalCard.update({ where: { agentId }, data: { pushedMonths: newPushedMonths } });

    res.json({
      created: created.length,
      requirementIds,
      taskIds: created, // compat alias for existing callers
      total: monthGroup.goals.length,
    });
  })
);

// GET /:agentId/revisions - 获取变更历史
router.get(
  '/:agentId/revisions',
  authRequired,
  asyncHandler(async (req, res) => {
    const agent = await resolveAgentParam(String(req.params.agentId));

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId: agent.id } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    const revisions = await prisma.goalRevision.findMany({
      where: { goalCardId: goalCard.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ revisions });
  })
);

}
