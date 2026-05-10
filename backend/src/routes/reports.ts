import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import {
  submitReportSchema,
  listReportsSchema,
  reviewReportSchema,
  reportIdSchema,
} from '../schemas/report.js';

export const reportsRouter = Router({ mergeParams: true });

// 所有接口需要认证
reportsRouter.use(authRequired);

/**
 * POST /api/requirements/:id/reports
 * 提交验收报告（需认证）
 */
reportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { params, body } = submitReportSchema.parse({
      params: req.params,
      body: req.body,
    });

    // 确认需求存在
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const report = await prisma.requirementReport.create({
      data: {
        requirementId: params.id,
        reportType: body.reportType,
        content: body.content as Prisma.InputJsonValue,
        submittedBy: body.submittedBy ?? req.user!.name,
        submittedById: req.user!.id,
      },
    });

    res.status(201).json({ success: true, data: report });
  }),
);

/**
 * GET /api/requirements/:id/reports
 * 查询需求的所有报告（需认证）
 */
reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { params, query } = listReportsSchema.parse({
      params: req.params,
      query: req.query,
    });

    // 确认需求存在
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    const where: Prisma.RequirementReportWhereInput = {
      requirementId: params.id,
    };
    if (query.reportType) where.reportType = query.reportType;
    if (query.status) where.status = query.status;

    const reports = await prisma.requirementReport.findMany({
      where,
      include: {
        submittedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: reports });
  }),
);

/**
 * PATCH /api/requirements/:id/reports/:reportId
 * CTO 审核报告（仅 admin 角色）
 */
reportsRouter.patch(
  '/:reportId',
  requireRoles('admin'),
  asyncHandler(async (req, res) => {
    const { params, body } = reviewReportSchema.parse({
      params: req.params,
      body: req.body,
    });

    const report = await prisma.requirementReport.findUnique({
      where: { id: params.reportId },
    });
    if (!report) throw new HttpError(404, '报告不存在');
    if (report.requirementId !== params.id) throw new HttpError(400, '报告与需求不匹配');
    if (report.status !== 'pending') throw new HttpError(400, '该报告已审核');

    const updated = await prisma.requirementReport.update({
      where: { id: params.reportId },
      data: {
        status: body.status,
        reviewComment: body.reviewComment,
        reviewedAt: new Date(),
      },
    });

    res.json({ success: true, data: updated });
  }),
);

/**
 * DELETE /api/requirements/:id/reports/:reportId
 * 删除报告（仅提交者本人或 CTO）
 */
reportsRouter.delete(
  '/:reportId',
  asyncHandler(async (req, res) => {
    const { params } = reportIdSchema.parse({ params: req.params });

    const report = await prisma.requirementReport.findUnique({
      where: { id: params.reportId },
    });
    if (!report) throw new HttpError(404, '报告不存在');
    if (report.requirementId !== params.id) throw new HttpError(400, '报告与需求不匹配');

    // 权限检查：仅提交者本人或 admin
    const isOwner = report.submittedById === req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    if (!isOwner && !isAdmin) throw new HttpError(403, '无权删除该报告');

    // 仅允许删除 pending 或 changes_requested 状态的报告
    if (report.status !== 'pending' && report.status !== 'changes_requested') {
      throw new HttpError(400, '仅待审核或需要修改状态的报告可删除');
    }

    await prisma.requirementReport.delete({
      where: { id: params.reportId },
    });

    res.status(204).send();
  }),
);
