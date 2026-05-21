import { Prisma, OkrRole } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const agentsRouter = Router();

// ─── Types ──────────────────────────────────────────────────

interface MonthlyGoal {
  text: string;
  status: 'not_started' | 'in_progress' | 'done';
}

interface MonthlyGoalGroup {
  month: string;
  goals: MonthlyGoal[];
}

// ─── 1. 列出所有 Agent（含目标卡） ─────────────────────────

agentsRouter.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const layer = req.query.layer as string | undefined;
    const pipeline = req.query.pipeline as string | undefined;
    const search = req.query.search as string | undefined;

    const where: Prisma.MarketplaceAgentWhereInput = {};

    // Filter by layer (tags)
    if (layer) {
      where.tags = { has: layer };
    }

    // Filter by pipeline via goal card
    // We'll handle this post-query
    const agents = await prisma.marketplaceAgent.findMany({
      where,
      include: {
        goalCard: {
          include: {
            revisions: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
    });

    // Convert to response format
    let result = agents.map((agent) => {
      const goalCard = agent.goalCard;
      const monthlyGoals: MonthlyGoalGroup[] = (goalCard?.monthlyGoals as any) || [];
      const totalGoals = monthlyGoals.reduce((sum, g) => sum + g.goals.length, 0);
      const doneGoals = monthlyGoals.reduce(
        (sum, g) => sum + g.goals.filter((goal) => goal.status === 'done').length,
        0
      );
      const inProgressGoals = monthlyGoals.reduce(
        (sum, g) => sum + g.goals.filter((goal) => goal.status === 'in_progress').length,
        0
      );

      return {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        capabilities: agent.capabilities,
        apiEndpoint: agent.apiEndpoint,
        status: agent.status,
        tags: agent.tags,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        goalCard: goalCard
          ? {
              id: goalCard.id,
              pipeline: goalCard.pipeline,
              longTermDirection: goalCard.longTermDirection,
              monthlyGoals: goalCard.monthlyGoals,
              selfCheckCriteria: goalCard.selfCheckCriteria,
              pushedMonths: goalCard.pushedMonths,
              status: goalCard.status,
              lastReviewedAt: goalCard.lastReviewedAt,
              lastReviewedBy: goalCard.lastReviewedBy,
              upstreamAgentIds: goalCard.upstreamAgentIds,
              downstreamAgentIds: goalCard.downstreamAgentIds,
              stats: {
                total: totalGoals,
                done: doneGoals,
                inProgress: inProgressGoals,
              },
            }
          : null,
      };
    });

    // Filter by pipeline if specified
    if (pipeline) {
      result = result.filter((agent) => agent.goalCard?.pipeline === pipeline);
    }

    // Filter by search term
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

// ─── 2. 获取单个 Agent 详情（含目标卡 + 周报） ─────────────

agentsRouter.get(
  '/:agentId',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);

    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: agentId },
      include: {
        goalCard: {
          include: {
            revisions: { orderBy: { createdAt: 'desc' }, take: 20 },
          },
        },
        accessTokens: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!agent) {
      throw new HttpError(404, 'Agent 不存在');
    }

    // Count tasks stats
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
    const doneGoals = monthlyGoals.reduce(
      (sum, g) => sum + g.goals.filter((goal) => goal.status === 'done').length, 0
    );

    res.json({
      data: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        avatar: agent.avatar,
        capabilities: agent.capabilities,
        apiEndpoint: agent.apiEndpoint,
        status: agent.status,
        tags: agent.tags,
        notificationType: agent.notificationType,
        feishuWebhookUrl: agent.feishuWebhookUrl,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        taskStats: taskCounts,
        goalCard: goalCard
          ? {
              id: goalCard.id,
              pipeline: goalCard.pipeline,
              longTermDirection: goalCard.longTermDirection,
              monthlyGoals: goalCard.monthlyGoals,
              selfCheckCriteria: goalCard.selfCheckCriteria,
              pushedMonths: goalCard.pushedMonths,
              status: goalCard.status,
              lastReviewedAt: goalCard.lastReviewedAt,
              lastReviewedBy: goalCard.lastReviewedBy,
              upstreamAgentIds: goalCard.upstreamAgentIds,
              downstreamAgentIds: goalCard.downstreamAgentIds,
              revisions: goalCard.revisions,
              stats: {
                total: totalGoals,
                done: doneGoals,
              },
            }
          : null,
      },
    });
  })
);

// ─── 3. 获取层（tag）列表 ────────────────────────────────────

agentsRouter.get(
  '/layers/list',
  authRequired,
  asyncHandler(async (_req, res) => {
    const agents = await prisma.marketplaceAgent.findMany({
      select: { tags: true },
    });

    const layerSet = new Set<string>();
    for (const agent of agents) {
      for (const tag of agent.tags) {
        layerSet.add(tag);
      }
    }

    const layers = Array.from(layerSet).sort();
    res.json({ data: layers });
  })
);

// ─── 4. 更新 Agent 层/标签 ─────────────────────────────────

agentsRouter.patch(
  '/:agentId',
  authRequired,
  requireRoles('admin', 'developer'),
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const { tags } = req.body as { tags?: string[] };

    if (!tags) {
      throw new HttpError(400, '缺少 tags 字段');
    }

    const agent = await prisma.marketplaceAgent.update({
      where: { id: agentId },
      data: { tags },
    });

    res.json({ data: agent });
  })
);

// ─── 5. 提交周报 ────────────────────────────────────────────

agentsRouter.post(
  '/:agentId/weekly-reports',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const { week, content, summary, nextWeekPlan, blockers } = req.body as {
      week: string;
      content: string;
      summary?: string;
      nextWeekPlan?: string;
      blockers?: string;
    };

    if (!week || !content) {
      throw new HttpError(400, '缺少必填字段: week, content');
    }

    const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new HttpError(404, 'Agent 不存在');
    }

    // Upsert: if report for this agent+week exists, update it; otherwise create
    const report = await prisma.weeklyReport.upsert({
      where: {
        agentId_week: { agentId, week },
      },
      update: {
        content,
        summary: summary || '',
        nextWeekPlan: nextWeekPlan || '',
        blockers: blockers || '',
        submittedBy: req.user!.name,
        submittedAt: new Date(),
        status: 'submitted',
      },
      create: {
        agentId,
        week,
        content,
        summary: summary || '',
        nextWeekPlan: nextWeekPlan || '',
        blockers: blockers || '',
        submittedBy: req.user!.name,
        submittedAt: new Date(),
        status: 'submitted',
      },
    });

    res.status(201).json({ data: report });
  })
);

// ─── 6. 获取周报列表 ────────────────────────────────────────

agentsRouter.get(
  '/:agentId/weekly-reports',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const { status, limit, offset } = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    const where: Prisma.WeeklyReportWhereInput = { agentId };
    if (status) {
      where.status = status as Prisma.WeeklyReportWhereInput['status'];
    }

    const take = limit ? parseInt(limit, 10) : 20;
    const skip = offset ? parseInt(offset, 10) : 0;

    const [reports, total] = await Promise.all([
      prisma.weeklyReport.findMany({
        where,
        orderBy: { week: 'desc' },
        take,
        skip,
      }),
      prisma.weeklyReport.count({ where }),
    ]);

    res.json({ data: reports, total });
  })
);

// ─── 7. 获取单条周报 ────────────────────────────────────────

agentsRouter.get(
  '/:agentId/weekly-reports/:reportId',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const reportId = String(req.params.reportId);

    const report = await prisma.weeklyReport.findFirst({
      where: { id: reportId, agentId },
    });

    if (!report) {
      throw new HttpError(404, '周报不存在');
    }

    res.json({ data: report });
  })
);

// ─── 8. 审批周报 ────────────────────────────────────────────

agentsRouter.patch(
  '/:agentId/weekly-reports/:reportId/review',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const reportId = String(req.params.reportId);
    const { action, comment } = req.body as {
      action: 'approved' | 'changes_requested';
      comment?: string;
    };

    if (!action || !['approved', 'changes_requested'].includes(action)) {
      throw new HttpError(400, 'action 必须是 approved 或 changes_requested');
    }

    const report = await prisma.weeklyReport.findFirst({
      where: { id: reportId, agentId },
    });

    if (!report) {
      throw new HttpError(404, '周报不存在');
    }

    const updated = await prisma.weeklyReport.update({
      where: { id: reportId },
      data: {
        status: action === 'approved' ? 'approved' : 'changes_requested',
        reviewedBy: req.user!.name,
        reviewedAt: new Date(),
        reviewComment: comment || null,
      },
    });

    res.json({ data: updated });
  })
);

// ─── 9. 获取待审批周报（所有 Agent） ────────────────────────

agentsRouter.get(
  '/weekly-reports/pending',
  authRequired,
  asyncHandler(async (_req, res) => {
    const pendingReports = await prisma.weeklyReport.findMany({
      where: { status: 'submitted' },
      orderBy: { submittedAt: 'asc' },
      include: {
        agent: {
          select: { id: true, name: true, displayName: true, avatar: true },
        },
      },
    });

    res.json({ data: pendingReports });
  })
);

// ============ OKR 独立权限体系 (8e415aa9) ============

// Helper: check OKR permission
function canEditAllOkrs(okrRole: OkrRole | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

function canApproveOkrs(okrRole: OkrRole | null | undefined): boolean {
  return okrRole === 'okr_admin' || okrRole === 'okr_reviewer' || okrRole === 'okr_owner';
}

// ─── 10. 获取 OKR 汇总（周报汇总，龙虾合伙人用） ─────────

agentsRouter.get(
  '/goals/summary',
  authRequired,
  asyncHandler(async (req, res) => {
    const okrRole = (req.user as any)?.okrRole;
    if (!canApproveOkrs(okrRole)) {
      throw new HttpError(403, '需要 okr_admin / okr_reviewer / okr_owner 权限');
    }

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

// ─── 11. PATCH /:agentId/kr/:month/:krId — 更新 KR 进度 ─

agentsRouter.patch(
  '/:agentId/kr/:month/:krId',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, month, krId } = req.params as Record<string, string>;
    const { current, description } = req.body as { current?: number; description?: string };

    const okrRole = (req.user as any)?.okrRole;
    const user = req.user!;

    // Permission: member can only edit own, admin/reviewer/owner can edit all
    if (!canEditAllOkrs(okrRole)) {
      const agent = await prisma.marketplaceAgent.findUnique({
        where: { id: agentId },
        select: { ownerId: true },
      });
      if (!agent || agent.ownerId !== user.id) {
        throw new HttpError(403, 'okr_member 只能更新自己的 KR');
      }
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

    await prisma.agentGoalCard.update({
      where: { agentId },
      data: { monthlyGoals },
    });

    res.json({ data: kr });
  })
);

// ─── 12. PATCH /:agentId/weekly-report/:month — 提交/更新周报 ─

agentsRouter.patch(
  '/:agentId/weekly-report/:month',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, month } = req.params as Record<string, string>;
    const { weekOf, summary, krProgress, blockers, nextWeekPlan } = req.body as {
      weekOf: string;
      summary?: string;
      krProgress?: any[];
      blockers?: string[];
      nextWeekPlan?: string[];
    };

    const okrRole = (req.user as any)?.okrRole;
    const user = req.user!;

    if (!canEditAllOkrs(okrRole)) {
      const agent = await prisma.marketplaceAgent.findUnique({
        where: { id: agentId },
        select: { ownerId: true },
      });
      if (!agent || agent.ownerId !== user.id) {
        throw new HttpError(403, 'okr_member 只能提交自己的周报');
      }
    }

    const goalCard = await prisma.agentGoalCard.findUnique({ where: { agentId } });
    if (!goalCard) throw new HttpError(404, '目标卡不存在');

    const monthlyGoals = goalCard.monthlyGoals as any[];
    const monthData = monthlyGoals.find((m: any) => m.month === month);
    if (!monthData) throw new HttpError(404, `${month} 月度数据不存在`);

    monthData.weeklyReport = {
      weekOf: weekOf || new Date().toISOString().slice(0, 10),
      status: 'submitted',
      summary: summary || '',
      krProgress: krProgress || [],
      blockers: blockers || [],
      nextWeekPlan: nextWeekPlan || [],
    };

    await prisma.agentGoalCard.update({
      where: { agentId },
      data: { monthlyGoals },
    });

    res.json({ data: monthData.weeklyReport });
  })
);

// ─── 13. PATCH /:agentId/approve/:month — OKR 审批 ─────────

agentsRouter.patch(
  '/:agentId/approve/:month',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, month } = req.params as Record<string, string>;
    const { approvalType, approved, comment } = req.body as {
      approvalType: 'strategic' | 'tactical' | 'boss';
      approved: boolean;
      comment?: string;
    };

    const okrRole = (req.user as any)?.okrRole;
    if (!canApproveOkrs(okrRole)) {
      throw new HttpError(403, '需要 okr_admin / okr_reviewer / okr_owner 审批权限');
    }

    // Role-check: strategic=okr_admin, tactical=okr_reviewer, boss=okr_owner
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

    await prisma.agentGoalCard.update({
      where: { agentId },
      data: { monthlyGoals },
    });

    res.json({ data: monthData.approvedBy });
  })
);
