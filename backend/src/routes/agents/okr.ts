import { OkrRole } from '@prisma/client';
import { authRequired } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

function canEditAllOkrs(okrRole: OkrRole | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

function canApproveOkrs(okrRole: OkrRole | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

export function registerOkrRoutes(router: import('express').Router): void {

// GET /goals/mine — Agent 读取自己的 OKR
router.get(
  '/goals/mine',
  authRequired,
  asyncHandler(async (req, res) => {
    const okrRole = (req.user as any)?.okrRole;
    // okr_member 及以上权限可用
    if (!okrRole) throw new HttpError(403, '需要 OKR 相关角色权限');

    const userId = (req.user as any)?.sub || (req.user as any)?.id;
    if (!userId) throw new HttpError(401, '无法识别用户身份');

    // 通过 userId（即 marketplace_agents.id = users.id）查找对应的 Agent
    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: userId },
      select: { id: true, name: true, displayName: true },
    });

    // 如果按 id 找不到，尝试通过 ownerId 查找
    const targetAgent = agent || await prisma.marketplaceAgent.findFirst({
      where: { ownerId: userId },
      select: { id: true, name: true, displayName: true },
    });

    if (!targetAgent) throw new HttpError(404, '未找到关联的 Agent 记录');

    const goalCard = await prisma.agentGoalCard.findUnique({
      where: { agentId: targetAgent.id },
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });

    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    res.json({
      data: {
        agentId: goalCard.agentId,
        agentName: (goalCard.agent as any).displayName || (goalCard.agent as any).name,
        pipeline: goalCard.pipeline,
        layer: (goalCard as any).layer || 'mainline',
        longTermDirection: goalCard.longTermDirection,
        monthlyGoals: goalCard.monthlyGoals,
      },
    });
  })
);

// GET /goals/summary - OKR 汇总
router.get(
  '/goals/summary',
  authRequired,
  asyncHandler(async (req, res) => {
    const okrRole = (req.user as any)?.okrRole;
    if (!canApproveOkrs(okrRole)) throw new HttpError(403, '需要 okr_admin / okr_reviewer / okr_owner 权限');

    const goalCards = await prisma.agentGoalCard.findMany({
      where: { status: 'active' },
      include: { agent: { select: { id: true, name: true, displayName: true } } },
    });

    const summary = goalCards.map(gc => ({
      agentId: gc.agentId,
      agentName: (gc.agent as any).displayName || (gc.agent as any).name,
      pipeline: gc.pipeline,
      layer: (gc as any).layer || 'mainline',
      longTermDirection: gc.longTermDirection,
      monthlyGoals: gc.monthlyGoals,
    }));

    res.json({ data: summary });
  })
);

// PATCH /:agentId/kr/:month/:krId - 更新 KR 进度
router.patch(
  '/:agentId/kr/:month/:krId',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, month, krId } = req.params as Record<string, string>;
    const { current, description } = req.body as { current?: number; description?: string };

    const okrRole = (req.user as any)?.okrRole;
    const user = req.user!;

    if (!canEditAllOkrs(okrRole)) {
      const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId }, select: { ownerId: true } });
      if (!agent || agent.ownerId !== user.id) throw new HttpError(403, 'okr_member 只能更新自己的 KR');
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    const monthlyGoals = goalCard.monthlyGoals as any[];
    const monthData = monthlyGoals.find((m: any) => m.month === month);
    if (!monthData) throw new HttpError(404, `${month} 月度数据不存在`);

    const kr = (monthData.keyResults || []).find((k: any) => k.id === krId);
    if (!kr) throw new HttpError(404, `KR ${krId} 不存在`);

    if (current !== undefined) kr.current = current;
    if (description !== undefined) kr.description = description;

    await prisma.agentGoalCard.update({ where: { agentId }, data: { monthlyGoals } });
    res.json({ data: kr });
  })
);

// PATCH /:agentId/weekly-report/:month - 提交/更新周报
router.patch(
  '/:agentId/weekly-report/:month',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, month } = req.params as Record<string, string>;
    const { weekOf, summary, krProgress, blockers, nextWeekPlan } = req.body as {
      weekOf: string; summary?: string; krProgress?: any[]; blockers?: string[]; nextWeekPlan?: string[];
    };

    const okrRole = (req.user as any)?.okrRole;
    const user = req.user!;

    if (!canEditAllOkrs(okrRole)) {
      const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId }, select: { ownerId: true } });
      if (!agent || agent.ownerId !== user.id) throw new HttpError(403, 'okr_member 只能提交自己的周报');
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    const monthlyGoals = goalCard.monthlyGoals as any[];
    const monthData = monthlyGoals.find((m: any) => m.month === month);
    if (!monthData) throw new HttpError(404, `${month} 月度数据不存在`);

    monthData.weeklyReport = {
      weekOf: weekOf || new Date().toISOString().slice(0, 10),
      status: 'submitted', summary: summary || '',
      krProgress: krProgress || [], blockers: blockers || [], nextWeekPlan: nextWeekPlan || [],
    };

    await prisma.agentGoalCard.update({ where: { agentId }, data: { monthlyGoals } });
    res.json({ data: monthData.weeklyReport });
  })
);

// PATCH /:agentId/approve/:month - OKR 审批
router.patch(
  '/:agentId/approve/:month',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, month } = req.params as Record<string, string>;
    const { approvalType, approved, comment } = req.body as {
      approvalType: 'strategic' | 'tactical' | 'boss'; approved: boolean; comment?: string;
    };

    const okrRole = (req.user as any)?.okrRole;
    if (!canApproveOkrs(okrRole)) throw new HttpError(403, '需要 okr_admin / okr_reviewer / okr_owner 审批权限');

    const roleMap: Record<string, OkrRole[]> = {
      strategic: ['okr_admin', 'okr_owner'],
      tactical: ['okr_reviewer', 'okr_admin', 'okr_owner'],
      boss: ['okr_owner'],
    };
    if (!roleMap[approvalType]?.includes(okrRole as OkrRole)) {
      throw new HttpError(403, `审批类型 ${approvalType} 需要不同角色权限`);
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    const monthlyGoals = goalCard.monthlyGoals as any[];
    const monthData = monthlyGoals.find((m: any) => m.month === month);
    if (!monthData) throw new HttpError(404, `${month} 月度数据不存在`);

    if (!monthData.approvedBy) monthData.approvedBy = {};
    monthData.approvedBy[approvalType] = approved ? 'approved' : 'rejected';

    await prisma.agentGoalCard.update({ where: { agentId }, data: { monthlyGoals } });
    res.json({ data: monthData.approvedBy });
  })
);

}
