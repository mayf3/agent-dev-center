import { authRequired } from '../../middleware/auth.js';
import { agentTokenRequired } from '../../middleware/marketplace-auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requireOkrEdit, parseMonthlyGoals, resolveAgentParam, type MonthlyGoal } from './permissions.js';

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

// POST /:agentId/push-todos - 推送月度目标到 LLM Todo
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
            title: `[目标卡] ${goal.text}`, status: 'active',
            priority: 'medium', horizon: 'month', type: 'agent',
            source: 'goal-card', area: goalCard.pipeline,
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

    const newPushedMonths = [...goalCard.pushedMonths, month];
    await prisma.agentGoalCard.update({ where: { agentId }, data: { pushedMonths: newPushedMonths } });

    res.json({ created: created.length, taskIds: created, total: monthGroup.goals.length });
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
