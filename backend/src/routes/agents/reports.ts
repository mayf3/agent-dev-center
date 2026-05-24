import { Prisma } from '@prisma/client';
import { authRequired } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

export function registerReportsRoutes(router: import('express').Router): void {

// POST /:agentId/weekly-reports - 提交周报
router.post(
  '/:agentId/weekly-reports',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const { week, content, summary, nextWeekPlan, blockers } = req.body as {
      week: string; content: string; summary?: string; nextWeekPlan?: string; blockers?: string;
    };

    if (!week || !content) throw new HttpError(400, '缺少必填字段: week, content');

    const agent = await prisma.marketplaceAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new HttpError(404, 'Agent 不存在');

    const report = await prisma.weeklyReport.upsert({
      where: { agentId_week: { agentId, week } },
      update: {
        content, summary: summary || '', nextWeekPlan: nextWeekPlan || '',
        blockers: blockers || '', submittedBy: req.user!.name,
        submittedAt: new Date(), status: 'submitted',
      },
      create: {
        agentId, week, content, summary: summary || '', nextWeekPlan: nextWeekPlan || '',
        blockers: blockers || '', submittedBy: req.user!.name,
        submittedAt: new Date(), status: 'submitted',
      },
    });

    res.status(201).json({ data: report });
  })
);

// GET /:agentId/weekly-reports - 获取周报列表
router.get(
  '/:agentId/weekly-reports',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const { status, limit, offset } = req.query as { status?: string; limit?: string; offset?: string };

    const where: Prisma.WeeklyReportWhereInput = { agentId };
    if (status) where.status = status as Prisma.WeeklyReportWhereInput['status'];

    const take = limit ? parseInt(limit, 10) : 20;
    const skip = offset ? parseInt(offset, 10) : 0;

    const [reports, total] = await Promise.all([
      prisma.weeklyReport.findMany({ where, orderBy: { week: 'desc' }, take, skip }),
      prisma.weeklyReport.count({ where }),
    ]);

    res.json({ data: reports, total });
  })
);

// GET /:agentId/weekly-reports/:reportId - 获取单条周报
router.get(
  '/:agentId/weekly-reports/:reportId',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const reportId = String(req.params.reportId);

    const report = await prisma.weeklyReport.findFirst({ where: { id: reportId, agentId } });
    if (!report) throw new HttpError(404, '周报不存在');

    res.json({ data: report });
  })
);

// PATCH /:agentId/weekly-reports/:reportId/review - 审批周报
router.patch(
  '/:agentId/weekly-reports/:reportId/review',
  authRequired,
  asyncHandler(async (req, res) => {
    const agentId = String(req.params.agentId);
    const reportId = String(req.params.reportId);
    const { action, comment } = req.body as { action: 'approved' | 'changes_requested'; comment?: string };

    if (!action || !['approved', 'changes_requested'].includes(action)) {
      throw new HttpError(400, 'action 必须是 approved 或 changes_requested');
    }

    const report = await prisma.weeklyReport.findFirst({ where: { id: reportId, agentId } });
    if (!report) throw new HttpError(404, '周报不存在');

    const updated = await prisma.weeklyReport.update({
      where: { id: reportId },
      data: {
        status: action === 'approved' ? 'approved' : 'changes_requested',
        reviewedBy: req.user!.name, reviewedAt: new Date(),
        reviewComment: comment || null,
      },
    });

    res.json({ data: updated });
  })
);

// GET /weekly-reports/pending - 获取待审批周报
router.get(
  '/weekly-reports/pending',
  authRequired,
  asyncHandler(async (_req, res) => {
    const pendingReports = await prisma.weeklyReport.findMany({
      where: { status: 'submitted' },
      orderBy: { submittedAt: 'asc' },
      include: { agent: { select: { id: true, name: true, displayName: true, avatar: true } } },
    });

    res.json({ data: pendingReports });
  })
);

}
