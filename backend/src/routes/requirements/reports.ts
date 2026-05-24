import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { canEditRequirement, canReadRequirement } from './helpers.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { serializeRequirement } from '../../utils/status.js';
import { notifyEvent } from '../../utils/notifications.js';
import { requireInternalRole } from '../../middleware/internal-workflow.js';

export function registerReportRoutes(router: Router) {
  // GET /:id/reports — 列出报告
  router.get('/:id/reports', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(user, requirement)) throw new HttpError(403, '无权限');

    const reports = await prisma.requirementReport.findMany({
      where: { requirementId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: reports });
  }));

  // GET /:id/reports/type/:type
  router.get('/:id/reports/type/:type', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);
    const { type } = z.object({ type: z.string() }).parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');
    if (!canReadRequirement(user, requirement)) throw new HttpError(403, '无权限');

    const report = await prisma.requirementReport.findFirst({
      where: { requirementId: id, reportType: type.toUpperCase() },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: report });
  }));

  // GET /:id/reports/check — 检查报告状态
  router.get('/:id/reports/check', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const reports = await prisma.requirementReport.findMany({
      where: { requirementId: id },
      orderBy: { createdAt: 'desc' },
    });

    const byType: Record<string, { submitted: boolean; approved: boolean; latest: unknown }> = {};
    for (const r of reports) {
      const t = r.reportType.toLowerCase();
      if (!byType[t] || new Date(r.createdAt) > new Date(byType[t].latest!.createdAt)) {
        byType[t] = { submitted: true, approved: r.status === 'approved', latest: r };
      }
    }

    res.json({ data: byType });
  }));

  // POST /:id/reports — 提交报告
  router.post('/:id/reports', asyncHandler(async (req, res) => {
    const user = req.user as Express.AuthUser;
    const { id } = requirementIdSchema.parse(req.params);
    const body = z.object({
      reportType: z.enum(['DEV_SELF_CHECK', 'TEST_REPORT', 'REVIEW_REPORT', 'DEPLOYMENT_REPORT']),
      content: z.any(),
    }).parse(req.body);

    const requirement = await prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const report = await prisma.requirementReport.create({
      data: {
        requirementId: id,
        reportType: body.reportType,
        version: (await prisma.requirementReport.count({ where: { requirementId: id, reportType: body.reportType } })) + 1,
        content: body.content,
        submittedById: user.id,
        status: 'pending',
      },
    });

    await notifyEvent('report.submitted', {
      requirementId: id, title: requirement.title, reportType: body.reportType,
      user: { id: user.id, name: user.name },
    });

    res.status(201).json({ data: report });
  }));
}
