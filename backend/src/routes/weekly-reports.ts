import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { agentTokenRequired } from '../middleware/marketplace-auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';

export const weeklyReportsRouter = Router();

// ─── Types ──────────────────────────────────────────────────

interface CompletedTask {
  title: string;
  status: string;
  description?: string;
}

interface ReportMetrics {
  tasksCompleted?: number;
  avgCycleHours?: number;
  statusDistribution?: Record<string, number>;
}

// ─── 1. GET /api/weekly-reports — 列表查询 ─────────────────

weeklyReportsRouter.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const { agentId, status, weekStart, weekEnd, page = '1', pageSize = '20' } = req.query as {
      agentId?: string;
      status?: string;
      weekStart?: string;
      weekEnd?: string;
      page?: string;
      pageSize?: string;
    };

    const where: Prisma.WeeklyReportWhereInput = {};

    if (agentId) where.agentId = agentId;
    if (status) where.status = status as any;
    if (weekStart || weekEnd) {
      where.weekStart = {};
      if (weekStart) where.weekStart.gte = new Date(weekStart);
      if (weekEnd) where.weekStart.lte = new Date(weekEnd);
    }

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const [reports, total] = await Promise.all([
      prisma.weeklyReport.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, displayName: true, avatar: true, tags: true } },
        },
        orderBy: { weekStart: 'desc' },
        skip,
        take,
      }),
      prisma.weeklyReport.count({ where }),
    ]);

    res.json({
      data: reports,
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total,
        totalPages: Math.ceil(total / parseInt(pageSize)),
      },
    });
  })
);

// ─── 2. GET /api/weekly-reports/pending — 待审批列表 ────────

weeklyReportsRouter.get(
  '/pending',
  authRequired,
  requireRoles('admin', 'cto_agent'),
  asyncHandler(async (req, res) => {
    const reports = await prisma.weeklyReport.findMany({
      where: { status: 'submitted' },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true, tags: true } },
      },
      orderBy: { weekStart: 'desc' },
    });

    res.json({ data: reports });
  })
);

// ─── 3. GET /api/weekly-reports/summary — 汇总统计 ─────────

weeklyReportsRouter.get(
  '/summary',
  authRequired,
  asyncHandler(async (req, res) => {
    const { weekStart, weekEnd } = req.query as { weekStart?: string; weekEnd?: string };

    // Default to current week
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const defaultStart = new Date(now);
    defaultStart.setDate(now.getDate() + mondayOffset);
    defaultStart.setHours(0, 0, 0, 0);

    const start = weekStart ? new Date(weekStart) : defaultStart;
    const end = weekEnd ? new Date(weekEnd) : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get all reports in the range
    const reports = await prisma.weeklyReport.findMany({
      where: {
        weekStart: { gte: start, lt: end },
      },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true, tags: true } },
      },
    });

    // Aggregate metrics
    const totalTasksCompleted = reports.reduce((sum, r) => {
      const metrics = (r.metrics as ReportMetrics) || {};
      return sum + (metrics.tasksCompleted || 0);
    }, 0);

    const agentSummaries = reports.map((r) => ({
      agentId: r.agentId,
      agentName: r.agent.displayName,
      agentTags: r.agent.tags,
      weekStart: r.weekStart,
      summary: r.summary,
      status: r.status,
      metrics: r.metrics,
      completedTasks: r.completedTasks,
    }));

    // Status distribution across all reports
    const statusDistribution: Record<string, number> = {};
    reports.forEach((r) => {
      statusDistribution[r.status] = (statusDistribution[r.status] || 0) + 1;
    });

    res.json({
      data: {
        weekRange: { start, end },
        totalReports: reports.length,
        totalTasksCompleted,
        statusDistribution,
        agents: agentSummaries,
      },
    });
  })
);

// ─── 4. GET /api/weekly-reports/:id — 单条详情 ──────────────

weeklyReportsRouter.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const report = await prisma.weeklyReport.findUnique({
      where: { id: req.params.id },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true, tags: true } },
      },
    });

    if (!report) {
      throw new HttpError(404, '周报不存在');
    }

    res.json({ data: report });
  })
);

// ─── 5. POST /api/weekly-reports — Agent 提交周报 ──────────

weeklyReportsRouter.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const {
      agentId,
      weekStart,
      weekEnd,
      summary,
      completedTasks,
      nextWeekPlan,
      blockers,
      metrics,
    } = req.body as {
      agentId: string;
      weekStart: string;
      weekEnd: string;
      summary: string;
      completedTasks?: CompletedTask[];
      nextWeekPlan?: string;
      blockers?: string;
      metrics?: ReportMetrics;
    };

    if (!agentId || !weekStart || !weekEnd || !summary) {
      throw new HttpError(400, '缺少必填字段: agentId, weekStart, weekEnd, summary');
    }

    // Verify agent exists
    const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new HttpError(404, 'Agent 不存在');
    }

    const report = await prisma.weeklyReport.create({
      data: {
        agentId,
        weekStart: new Date(weekStart),
        weekEnd: new Date(weekEnd),
        summary,
        completedTasks: completedTasks || [],
        nextWeekPlan: nextWeekPlan || '',
        blockers: blockers || '',
        metrics: metrics || {},
        status: 'submitted',
        submittedBy: req.user!.name,
        submittedById: req.user!.id,
      },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      },
    });

    res.status(201).json({ data: report });
  })
);

// ─── 6. PATCH /api/weekly-reports/:id/review — 审批周报 ─────

weeklyReportsRouter.patch(
  '/:id/review',
  authRequired,
  requireRoles('admin', 'cto_agent'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, reviewComment } = req.body as {
      status: 'reviewed' | 'needs_revision';
      reviewComment?: string;
    };

    if (!status || !['reviewed', 'needs_revision'].includes(status)) {
      throw new HttpError(400, 'status 必须是 reviewed 或 needs_revision');
    }

    const report = await prisma.weeklyReport.findUnique({ where: { id } });
    if (!report) {
      throw new HttpError(404, '周报不存在');
    }

    if (report.status !== 'submitted') {
      throw new HttpError(400, '只能审批状态为 submitted 的周报');
    }

    const updated = await prisma.weeklyReport.update({
      where: { id },
      data: {
        status,
        reviewComment: reviewComment || null,
        reviewedBy: req.user!.name,
        reviewedAt: new Date(),
      },
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      },
    });

    res.json({ data: updated });
  })
);

// ─── 7. PATCH /api/weekly-reports/:id — 更新周报 ──────────

weeklyReportsRouter.patch(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { summary, completedTasks, nextWeekPlan, blockers, metrics } = req.body as {
      summary?: string;
      completedTasks?: CompletedTask[];
      nextWeekPlan?: string;
      blockers?: string;
      metrics?: ReportMetrics;
    };

    const report = await prisma.weeklyReport.findUnique({ where: { id } });
    if (!report) {
      throw new HttpError(404, '周报不存在');
    }

    // Only submitter or admin can edit
    if (report.submittedById !== req.user!.id && !['admin', 'cto_agent'].includes(req.user!.role)) {
      throw new HttpError(403, '无权编辑此周报');
    }

    // Can only edit draft or needs_revision reports
    if (!['draft', 'needs_revision', 'submitted'].includes(report.status)) {
      throw new HttpError(400, '当前状态的周报不可编辑');
    }

    const data: Prisma.WeeklyReportUpdateInput = {};
    if (summary !== undefined) data.summary = summary;
    if (completedTasks !== undefined) data.completedTasks = completedTasks as any;
    if (nextWeekPlan !== undefined) data.nextWeekPlan = nextWeekPlan;
    if (blockers !== undefined) data.blockers = blockers;
    if (metrics !== undefined) data.metrics = metrics as any;

    const updated = await prisma.weeklyReport.update({
      where: { id },
      data,
      include: {
        agent: { select: { id: true, name: true, displayName: true, avatar: true } },
      },
    });

    res.json({ data: updated });
  })
);
