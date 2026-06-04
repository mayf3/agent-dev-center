import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired, requireRoles } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { notifyEvent } from '../utils/notifications.js';
import { archiveRecord } from '../lib/archive.js';
import { InternalRole, ReportType } from '@prisma/client';
import { requireInternalRole } from '../middleware/internal-workflow.js';
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
 * ⚠️ 2026-05-21 验尸修复：废除 admin 万能豁免
 *
 * 规则（写死原则）：
 * - DEV_SELF_CHECK → 需求 assignee 可提
 * - TEST_REPORT → 仅 internal_role=tester 可提
 * - SECURITY_REVIEW → 仅 internal_role=security 可提
 * - CTO_REVIEW → 仅 internal_role=cto（admin）可提
 * - DEPLOY_CONFIRM → 仅 internal_role=ops 可提
 * - POSTMORTEM → 任何认证用户可提（全员验尸文化）
 * - ⛔ admin 不能代提交任何报告（allowAdmin: 已废除）
 * - ⛔ 角色校验使用 internal_role（因为所有 Agent 的 role 字段都是 'developer'）
 */
const REPORT_ROLE_MAP: Record<string, { mode: 'assignee' | 'role' | 'any'; internalRoles?: InternalRole[]; allowAdmin?: boolean }> = {
  DEV_SELF_CHECK:    { mode: 'assignee', allowAdmin: false },
  TEST_REPORT:       { mode: 'role', internalRoles: ['tester'], allowAdmin: false },
  SECURITY_REVIEW:   { mode: 'role', internalRoles: ['security'], allowAdmin: false },
  CTO_REVIEW:        { mode: 'role', internalRoles: ['cto'], allowAdmin: true },
  DEPLOY_CONFIRM:    { mode: 'role', internalRoles: ['ops'], allowAdmin: false },
  POSTMORTEM:        { mode: 'any', allowAdmin: true },
};

const QA_BYPASS_MIN_WAIT_MS = 2 * 60 * 60 * 1000;

/**
 * 校验提交者是否有权提交该类型的报告
 *
 * ⚠️ 2026-05-21 验尸修复：废除 admin 万能豁免 + 改用 internal_role 校验
 * 验证记录：docs/postmortem-cto-hack-20260521.md
 */
async function validateReportRole(
  userId: string,
  userRole: string,
  userName: string,
  userEmail: string,
  reportType: string,
  requirementId: string,
  internalRole?: string,
): Promise<void> {
  const rule = REPORT_ROLE_MAP[reportType];
  if (!rule) return; // 未知类型暂不限制

  const isAdminEnv = userRole === 'admin' || userRole === 'cto_agent';

  // admin 特赦：仅 allowAdmin=true 时放行（目前只有 CTO_REVIEW 和 POSTMORTEM）
  if (isAdminEnv && rule.allowAdmin) {
    // admin 只能提交 CTO_REVIEW 或 POSTMORTEM，不能代提交其他类型
    if (rule.mode === 'assignee') {
      throw new HttpError(403, `⛔ ${reportType} 仅需求 assignee 可提交，admin 不能代提交`);
    }
    if (rule.internalRoles && rule.internalRoles.length > 0 && !rule.internalRoles.includes('cto')) {
      throw new HttpError(403, `⛔ ${reportType} 仅 ${rule.internalRoles.join('/')} 可提交，admin 不能代提交`);
    }
    return; // admin 提交 CTO_REVIEW / POSTMORTEM → 放行
  }

  // admin 被明确拒绝 → 直接 403
  if (isAdminEnv && !rule.allowAdmin) {
    throw new HttpError(403, `⛔ admin 不能提交 ${reportType} 报告，请使用对应角色的 ADC 账号自行提交`);
  }

  // role 模式：使用 internal_role 校验
  // 注意：用 internal_role（测试工程师 = tester，安全卫士 = security）而非 role（全是 developer）
  if (rule.mode === 'role' && rule.internalRoles && rule.internalRoles.length > 0) {
    if (internalRole && rule.internalRoles.includes(internalRole as InternalRole)) return;
    const allowed = rule.internalRoles.map(r => `internal_role=${r}`).join(' 或 ');
    throw new HttpError(403, `${reportType} 报告仅 ${allowed} 可提交（你的 internal_role: ${internalRole ?? '未设置'}）`);
  }

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
    throw new HttpError(403, `${reportType} 仅需求 assignee 可提交，当前 assignee: ${requirement?.assignee ?? '未分配'}`);
  }

  throw new HttpError(403, `${reportType} 报告类型配置错误，请联系管理员`);
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
      include: { assigneeUser: { select: { name: true } } },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    // 校验提交者角色
    await validateReportRole(req.user!.id, req.user!.role, req.user!.name, req.user!.email, body.reportType, params.id, req.user!.internalRole);

    // 铁律 #37：DEV_SELF_CHECK 报告必须包含代码仓库路径和部署指引
    if (body.reportType === 'DEV_SELF_CHECK') {
      const content = body.content as Record<string, unknown>;
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      const hasRepoPath = /repo|仓库|git.*remote|github|gitlab|gitee|\/opt\/git\//i.test(contentStr);
      const hasDeployGuide = /deploy|部署|docker|dockerfile|nginx|环境变量|env/i.test(contentStr);
      if (!hasRepoPath) {
        throw new HttpError(400, 'DEV_SELF_CHECK 报告必须包含代码仓库路径（如 git remote URL 或服务器路径）');
      }
      if (!hasDeployGuide) {
        throw new HttpError(400, 'DEV_SELF_CHECK 报告必须包含部署指引（如 Dockerfile 位置、环境变量、依赖服务）');
      }
    }

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
 * GET /api/reports/pending-review
 * QA 待审报告队列 — 返回所有 status=pending 且类型为 TEST_REPORT/SECURITY_REVIEW 的报告
 * 仅 internalRole=qa 或 admin/cto_agent 可访问
 */
reportsRouter.get(
  '/pending-review',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const isQa = actor.internalRole === 'qa';
    const isAdmin = actor.role === 'admin' || actor.role === 'cto_agent' || actor.internalRole === 'cto';
    if (!isQa && !isAdmin) {
      throw new HttpError(403, '仅 QA 或管理员可查看待审报告队列');
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const skip = (page - 1) * pageSize;

    const where: Prisma.RequirementReportWhereInput = {
      status: 'pending',
      reportType: { in: ['TEST_REPORT', 'SECURITY_REVIEW'] },
    };

    const [reports, total] = await prisma.$transaction([
      prisma.requirementReport.findMany({
        where,
        include: {
          submittedByUser: { select: { id: true, name: true, email: true } },
          requirement: { select: { id: true, title: true, currentStep: true, type: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: pageSize,
      }),
      prisma.requirementReport.count({ where }),
    ]);

    res.json({
      success: true,
      data: reports,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
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
// QA 审批 TEST_REPORT 和 SECURITY_REVIEW
reportsRouter.patch(
  '/:reportId/qa-review',
  requireInternalRole('qa'),
  asyncHandler(async (req, res) => {
    const { params, body } = reviewReportSchema.parse({
      params: req.params,
      body: req.body,
    });

    const report = await prisma.requirementReport.findUnique({
      where: { id: params.reportId },
    });
    if (!report) throw new HttpError(404, '报告不存在');
    if (report.status !== 'pending') throw new HttpError(400, '该报告已审核');

    // DEV_SELF_CHECK / TEST_REPORT / SECURITY_REVIEW 需要 QA 审批
    if (report.reportType !== ReportType.DEV_SELF_CHECK && report.reportType !== ReportType.TEST_REPORT && report.reportType !== ReportType.SECURITY_REVIEW) {
      throw new HttpError(400, '只有开发自检、测试报告和安全审查需要 QA 审批');
    }

    if (report.submittedById === req.user!.id) {
      throw new HttpError(403, '审核者和提交者不能为同一人，报告不能自己审自己');
    }

    const updated = await prisma.requirementReport.update({
      where: { id: params.reportId },
      data: {
        qaReviewedAt: new Date(),
        qaReviewedBy: req.user!.name,
        // QA 审批不改变最终状态，只是标记已审查
        reviewComment: body.reviewComment,
      },
    });

    void notifyEvent('report.qa_reviewed' as any, {
      id: params.id,
      title: report.reportType,
      qa: req.user!.name,
    });

    res.json({ success: true, data: updated, message: 'QA 审查完成，等待 CTO 最终审批' });
  }),
);

// CTO 最终审批（或直接审批非 QA 流程的报告）
reportsRouter.patch(
  '/:reportId',
  asyncHandler(async (req, res, next) => {
    // 权限检查：admin/cto_agent 直接通过，否则检查工作流步骤角色
    const isAdminOrCto = req.user!.role === 'admin' || req.user!.role === 'cto_agent';
    if (isAdminOrCto) return next();

    // 工作流角色审批：检查报告是否属于当前用户负责的工作流步骤
    const { params } = reportIdSchema.parse({ params: req.params });
    const report = await prisma.requirementReport.findUnique({ where: { id: params.reportId } });
    if (!report) throw new HttpError(404, '报告不存在');

    // 查需求的工作流当前步骤
    const requirement = await prisma.requirement.findUnique({
      where: { id: report.requirementId },
      include: { workflow: true },
    });
    if (!requirement?.workflow?.steps || !requirement.currentStep) {
      throw new HttpError(403, '只有 CTO 可以审批报告');
    }

    const steps = requirement.workflow.steps as Array<{ name: string; role: string; requiredReports?: string[] }>;
    const currentStep = steps.find(s => s.name === requirement.currentStep);
    if (!currentStep?.requiredReports?.includes(report.reportType)) {
      throw new HttpError(403, '只有 CTO 可以审批该报告（报告类型不在当前工作流步骤的待审批列表中）');
    }

    // 角色匹配
    const roleMap: Record<string, string[]> = {
      cto: ['cto', 'admin'],
      developer: ['developer'],
      tester: ['tester'],
      security: ['security'],
      ops: ['ops'],
      pm: ['pm', 'requester'],
    };
    const allowedRoles = roleMap[currentStep.role] ?? [];
    const userRole = req.user!.internalRole ?? req.user!.role;
    if (!allowedRoles.includes(userRole)) {
      throw new HttpError(403, `当前步骤需要「${currentStep.role}」角色，你的角色是「${userRole}」`);
    }

    // 不能审自己提交的
    if (report.submittedById === req.user!.id) {
      throw new HttpError(403, '审核者和提交者不能为同一人');
    }

    next();
  }),
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
    // CTO_REVIEW 自审豁免：CTO 审的是整个需求（开发+测试+安全），不是审自己
    const isCtoSelfReview = report.reportType === ReportType.CTO_REVIEW && report.submittedById === req.user!.id;
    if (report.submittedById === req.user!.id && !isCtoSelfReview) {
      throw new HttpError(403, '审核者和提交者不能为同一人，报告不能自己审自己');
    }

    // DEV_SELF_CHECK / TEST_REPORT / SECURITY_REVIEW 必须先经 QA 审查
    const requiresQaReview = report.reportType === ReportType.DEV_SELF_CHECK || report.reportType === ReportType.TEST_REPORT || report.reportType === ReportType.SECURITY_REVIEW;
    const shouldBypassQa = requiresQaReview && body.qa_bypass === true;
    const reviewedAt = new Date();

    if (shouldBypassQa) {
      if (report.status !== 'pending') throw new HttpError(400, '该报告已审核，不能执行 QA Bypass');
      if (!body.qa_bypass_reason) throw new HttpError(400, 'qa_bypass=true 时必须提供 qa_bypass_reason');

      const elapsedMs = reviewedAt.getTime() - report.createdAt.getTime();
      if (elapsedMs < QA_BYPASS_MIN_WAIT_MS) {
        throw new HttpError(403, '报告提交未满 2 小时，不能执行 QA Bypass');
      }
    } else if (requiresQaReview && !report.qaReviewedAt) {
      throw new HttpError(403, '测试报告和安全审查必须先经 QA 审查，再由 CTO 最终审批');
    }

    if (report.status !== 'pending') throw new HttpError(400, '该报告已审核');

    const updated = await prisma.requirementReport.update({
      where: { id: params.reportId },
      data: {
        status: body.status,
        reviewComment: body.reviewComment,
        reviewedAt,
        ...(shouldBypassQa ? {
          qaBypass: true,
          qaBypassReason: body.qa_bypass_reason,
          qaBypassAt: reviewedAt,
          qaBypassBy: req.user!.name,
        } : {}),
      },
    });

    // 通知相关方
    const reqInfo = await prisma.requirement.findUnique({
      where: { id: params.id },
      select: { title: true, requesterId: true, assigneeId: true, assignee: true, currentStep: true, workflowId: true },
    });
    const reportEvent = body.status === 'approved' ? 'report.approved' : 'report.rejected';
    void notifyEvent(reportEvent as any, {
      id: params.id,
      title: reqInfo?.title ?? '',
      reportType: report.reportType,
      actor: req.user!.name,
    });

    // ─── 报告打回自动回退需求状态 + assignee ───
    // 对于有工作流的需求：通过工作流 reject（按步骤角色自动分配）
    // 对于无工作流的旧需求：从 revisions 历史找 assignee
    if (body.status === 'rejected' && reqInfo) {
      const reportType = report.reportType as string;

      // 如果需求有工作流，不在这里处理回退（由 workflow reject 处理）
      if (reqInfo.workflowId) {
        // 工作流模式：报告打回不做状态回退，由 CTO/test-engineer 手动调 workflow reject
      } else {
        // 旧版非工作流模式保留原逻辑
        let targetStep: string | null = null;

        switch (reportType) {
          case 'DEV_SELF_CHECK':
          case 'TEST_REPORT':
          case 'SECURITY_REVIEW':
            targetStep = 'dev_self_check';
            break;
          case 'CTO_REVIEW':
            targetStep = 'testing';
            break;
          case 'DEPLOY_CONFIRM':
            targetStep = 'cto_review';
            break;
          default:
            break;
        }

        if (targetStep) {
          const lastRevision = await prisma.requirementRevision.findFirst({
            where: {
              requirementId: params.id,
              assignee: { not: null },
              status: { in: ['in_progress', 'testing'] },
            },
            orderBy: { createdAt: 'desc' },
            select: { assignee: true },
          });

          const rollbackAssigneeName = lastRevision?.assignee ?? reqInfo.assignee;

          let rollbackAssigneeId: string | null = reqInfo.assigneeId;
          if (rollbackAssigneeName) {
            const assigneeUser = await prisma.user.findFirst({
              where: { OR: [{ name: rollbackAssigneeName }, { email: rollbackAssigneeName }] },
              select: { id: true },
            });
            rollbackAssigneeId = assigneeUser?.id ?? rollbackAssigneeId;
          }

          await prisma.requirement.update({
            where: { id: params.id },
            data: {
              currentStep: targetStep,
              assignee: rollbackAssigneeName,
              assigneeId: rollbackAssigneeId,
            },
          });

          await prisma.requirementRevision.create({
            data: {
              requirementId: params.id,
              title: reqInfo.title ?? '',
              description: '',
              priority: 'P2',
              status: 'in_progress',
              requester: '',
              department: '',
              assignee: rollbackAssigneeName,
              revisionNote: `${reportType} 报告被打回，步骤回退至 ${targetStep}，assignee 回退为 ${rollbackAssigneeName ?? '原开发者'}`,
              operatorId: req.user!.id,
            },
          });

          void notifyEvent('requirement.step_changed' as any, {
            id: params.id,
            title: reqInfo.title ?? '',
            currentStep: targetStep,
            actor: req.user!.name,
            assignee: rollbackAssigneeName,
          });
        }
      }
    }

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
        requirement: { select: { id: true, title: true, currentStep: true } },
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

    // 权限检查：仅提交者本人或 admin/cto_agent
    const isOwner = report.submittedById === req.user!.id;
    const isAdmin = req.user!.role === 'admin' || req.user!.role === 'cto_agent';
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
