import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { notifyEvent } from '../utils/notifications.js';
import { archiveRecord } from '../lib/archive.js';
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
 * 报告类型 → 允许提交的角色/身份映射
 *
 * 规则：
 * - DEV_SELF_CHECK → 需求 assignee 可提
 * - TEST_REPORT → test-engineer 角色
 * - SECURITY_REVIEW → security-agent 角色
 * - CTO_REVIEW → admin 角色（CTO）
 * - DEPLOY_CONFIRM → itops-agent 角色
 */
const REPORT_ROLE_MAP: Record<string, { mode: 'assignee' | 'role' | 'any'; roles?: string[]; allowAdmin?: boolean }> = {
  DEV_SELF_CHECK: { mode: 'assignee', allowAdmin: true },
  TEST_REPORT: { mode: 'role', roles: ['test-engineer', 'admin'], allowAdmin: true },
  SECURITY_REVIEW: { mode: 'role', roles: ['security-agent', 'admin'], allowAdmin: true },
  CTO_REVIEW: { mode: 'role', roles: ['admin'] },
  DEPLOY_CONFIRM: { mode: 'role', roles: ['itops-agent', 'admin'], allowAdmin: true },
  POSTMORTEM: { mode: 'role', roles: ['agent-dev-engineer', 'devtools-agent', 'frontend-react-engineer', 'mobile-app-engineer', 'miniapp-game-engineer', 'game-dev-agent', 'test-engineer', 'security-agent', 'itops-agent', 'admin'], allowAdmin: true }, // 开发团队全员可提交验尸报告（2026-05-20 老板指令）
};

/**
 * 校验提交者是否有权提交该类型的报告
 */
async function validateReportRole(
  userId: string,
  userRole: string,
  userName: string,
  userEmail: string,
  reportType: string,
  requirementId: string,
): Promise<void> {
  const rule = REPORT_ROLE_MAP[reportType];
  if (!rule) return; // 未知类型暂不限制

  // admin 总是有权
  if (rule.allowAdmin !== false && userRole === 'admin') return;
  if (rule.roles?.includes(userRole)) return;

  // any 模式：任何认证用户都可以
  if (rule.mode === 'any') return;

  // assignee 模式：检查是否是需求的 assignee
  if (rule.mode === 'assignee') {
    const requirement = await prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { assigneeId: true, assignee: true },
    });
    if (requirement?.assigneeId === userId) return;
    // fallback: 如果 assigneeId 为空，用 name/email 匹配（兼容旧数据）
    if (requirement?.assignee && (requirement.assignee === userName || requirement.assignee === userEmail)) return;
  }

  const allowed = rule.mode === 'assignee'
    ? `需求 assignee${rule.allowAdmin ? ' 或 admin' : ''}`
    : (rule.roles || []).join(' / ');
  throw new HttpError(403, `${reportType} 报告仅 ${allowed} 可提交`);
}

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

    // 校验提交者角色
    await validateReportRole(req.user!.id, req.user!.role, req.user!.name, req.user!.email, body.reportType, params.id);

    const report = await prisma.requirementReport.create({
      data: {
        requirementId: params.id,
        reportType: body.reportType,
        content: body.content as Prisma.InputJsonValue,
        submittedBy: body.submittedBy ?? req.user!.name,
        submittedById: req.user!.id,
      },
    });

    void notifyEvent('report.submitted', {
      id: params.id,
      title: requirement.title,
      reportType: body.reportType,
      actor: req.user!.name,
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

    // 通知相关方
    const reqInfo = await prisma.requirement.findUnique({
      where: { id: params.id },
      select: { title: true, requesterId: true, assigneeId: true },
    });
    const reportEvent = body.status === 'approved' ? 'report.approved' : 'report.rejected';
    void notifyEvent(reportEvent as any, {
      id: params.id,
      title: reqInfo?.title ?? '',
      reportType: report.reportType,
      actor: req.user!.name,
    });

    res.json({ success: true, data: updated });
  }),
);

/**
 * GET /api/requirements/:id/reports/:reportId
 * GET /api/reports/:reportId
 * 获取单个报告详情
 */
reportsRouter.get(
  '/:reportId',
  asyncHandler(async (req, res) => {
    const reportId = req.params.reportId as string;
    if (!reportId) throw new HttpError(400, '缺少 reportId');

    const report = await prisma.requirementReport.findUnique({
      where: { id: reportId },
      include: {
        submittedByUser: { select: { id: true, name: true, email: true } },
        requirement: { select: { id: true, title: true, status: true } },
      },
    });

    if (!report) throw new HttpError(404, '报告不存在');

    // 权限检查：只在有 requirementId 上下文时校验
    if (req.params.id) {
      // 通过 /api/requirements/:id/reports/:reportId 访问，校验 requirementId 匹配
      if (report.requirementId !== req.params.id) {
        throw new HttpError(400, '报告与需求不匹配');
      }
      const reqInfo = await prisma.requirement.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!reqInfo) throw new HttpError(404, '需求不存在');
    }

    res.json({ success: true, data: report });
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

    // Archive the report before deleting
    archiveRecord(
      report as unknown as Record<string, unknown>,
      'reports',
      {
        itemName: `${report.reportType} 报告`,
        itemId: report.id,
        reason: `${req.user!.name || req.user!.email} 归档删除报告`,
        archivedBy: req.user!.name || req.user!.email,
        extra: `requirementId=${report.requirementId}, reportType=${report.reportType}, status=${report.status}`
      }
    );

    await prisma.requirementReport.delete({
      where: { id: params.reportId },
    });

    res.status(204).send();
  }),
);
