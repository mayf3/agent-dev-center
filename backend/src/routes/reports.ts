import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { notifyEvent } from '../utils/notifications.js';
import { archiveRecord } from '../lib/archive.js';
import { resolveAssigneeForStep, getAssigneeName } from '../lib/assignee-resolver.js';
import { ReportType } from '@prisma/client';
import { requireInternalRole } from '../middleware/internal-workflow.js';
import { getPlatformRoles, hasPlatformRole, isPlatformAdmin } from '../lib/platform-roles.js';
import { getWorkflowRawJson, parseSteps } from './requirements/workflow-helpers.js';
import { assertDomainReadAccess } from './requirements/utils.js';
import {
  submitReportSchema,
  listReportsSchema,
  reviewReportSchema,
  findingsReviewSchema,
  reportIdSchema,
} from '../schemas/report.js';

export const reportsRouter = Router({ mergeParams: true });

// 所有接口需要认证
reportsRouter.use(authRequired);

// autoRegisterRoutes 兼容：当路由为平路路径 (/api/reports) 时，从 body/query 读 requirementId
reportsRouter.use((req, _res, next) => {
  if (!req.params.id) {
    req.params.id = req.body?.requirementId || (req.query as any)?.requirementId || req.params.id;
  }
  next();
});

/**
 * Load requirement by id and assert domain read access.
 * Throws 404/403 if not found or domain-forbidden.
 */
async function assertRequirementDomainById(reqId: string, user: Express.AuthUser): Promise<void> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: reqId },
    select: { id: true, domainKey: true },
  });
  if (!requirement) throw new HttpError(404, '需求不存在');
  assertDomainReadAccess(user, requirement);
}

/**
 * Load the requirement linked to a report and assert domain read access.
 */
async function assertReportRequirementDomain(reportId: string, user: Express.AuthUser): Promise<{ requirementId: string }> {
  const report = await prisma.requirementReport.findUnique({
    where: { id: reportId },
    select: { requirementId: true },
  });
  if (!report) throw new HttpError(404, '报告不存在');
  await assertRequirementDomainById(report.requirementId, user);
  return report;
}

/**
 * 报告类型 → 允许提交的角色/身份映射
 *
 * ⚠️ 2026-05-21 验尸修复：废除 admin 万能豁免
 *
 * 规则（写死原则）：
 * - DEV_SELF_CHECK → 需求 assignee 可提
 * - TEST_REPORT → 仅 adc:tester 可提
 * - SECURITY_REVIEW → 仅 adc:security 可提
 * - CTO_REVIEW → 仅 adc:admin 可提
 * - DEPLOY_CONFIRM → 仅 adc:ops 可提
 * - POSTMORTEM → 任何认证用户可提（全员验尸文化）
 * - ⛔ admin 不能代提交任何报告（allowAdmin: 已废除）
 * - ⛔ 角色校验优先使用 roles，兼容期 fallback 到 internalRole
 */
const REPORT_ROLE_MAP: Record<string, { mode: 'assignee' | 'role' | 'any'; platformRoles?: string[]; allowAdmin?: boolean }> = {
  DEV_SELF_CHECK:    { mode: 'assignee', allowAdmin: false },
  TEST_REPORT:       { mode: 'role', platformRoles: ['adc:tester'], allowAdmin: false },
  SECURITY_REVIEW:   { mode: 'role', platformRoles: ['adc:security'], allowAdmin: false },
  ARCH_DESIGN:       { mode: 'assignee', allowAdmin: false },
  ARCH_REVIEW:       { mode: 'assignee', allowAdmin: false },
  CTO_REVIEW:        { mode: 'role', platformRoles: ['adc:admin'], allowAdmin: true },
  DEPLOY_CONFIRM:    { mode: 'role', platformRoles: ['adc:ops'], allowAdmin: false },
  POSTMORTEM:        { mode: 'any', allowAdmin: true },
  MERGE_REPORT:      { mode: 'assignee', allowAdmin: true },
};

const QA_BYPASS_MIN_WAIT_MS = 2 * 60 * 60 * 1000;

const WORKFLOW_STEP_PLATFORM_ROLES: Record<string, string[]> = {
  cto: ['adc:admin'],
  admin: ['adc:admin'],
  developer: ['adc:developer'],
  tester: ['adc:tester'],
  security: ['adc:security'],
  ops: ['adc:ops'],
  pm: ['adc:pm', 'adc:viewer'],
  requester: ['adc:pm', 'adc:viewer'],
  architect: ['adc:admin'],  // 架构师 - 用 admin 级别权限提交 ARCH_DESIGN/ARCH_REVIEW
};

function describeUserRoles(user: Express.AuthUser): string {
  return getPlatformRoles(user).join(', ') || user.internalRole || user.role;
}

function hasWorkflowStepRole(user: Express.AuthUser, stepRole: string): boolean {
  const platformRoles = WORKFLOW_STEP_PLATFORM_ROLES[stepRole] ?? [];
  return platformRoles.some(role => hasPlatformRole(user, role));
}

/**
 * 校验提交者是否有权提交该类型的报告
 *
 * ⚠️ 2026-05-21 验尸修复：废除 admin 万能豁免 + 改用 internal_role 校验
 * 验证记录：docs/postmortem-cto-hack-20260521.md
 */
async function validateReportRole(
  user: Express.AuthUser,
  reportType: string,
  requirementId: string,
): Promise<void> {
  const rule = REPORT_ROLE_MAP[reportType];
  if (!rule) return; // 未知类型暂不限制

  const isAdminEnv = isPlatformAdmin(user);

  // admin 特赦：仅 allowAdmin=true 时放行（目前只有 CTO_REVIEW 和 POSTMORTEM）
  if (isAdminEnv && rule.allowAdmin) {
    // 如果是 assignee 模式，检查 admin 本人是否就是 assignee
    if (rule.mode === 'assignee') {
      const requirement = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: { assigneeId: true, assignee: true },
      });
      if (requirement?.assigneeId === user.id) return;
      if (requirement?.assignee && (requirement.assignee === user.name || requirement.assignee === user.email)) return;
      throw new HttpError(403, `⛔ ${reportType} 仅需求 assignee 可提交，你不是该需求的 assignee`);
    }
    if (rule.platformRoles && rule.platformRoles.length > 0 && !rule.platformRoles.includes('adc:admin')) {
      throw new HttpError(403, `⛔ ${reportType} 仅 ${rule.platformRoles.join('/')} 可提交，admin 不能代提交`);
    }
    return; // admin 提交 CTO_REVIEW / POSTMORTEM → 放行
  }

  // admin 被明确拒绝 → 直接 403
  if (isAdminEnv && !rule.allowAdmin) {
    throw new HttpError(403, `⛔ admin 不能提交 ${reportType} 报告，请使用对应角色的 ADC 账号自行提交`);
  }

  // role 模式：优先使用平台 roles 校验，兼容期 fallback 由 helper 处理
  if (rule.mode === 'role' && rule.platformRoles && rule.platformRoles.length > 0) {
    if (rule.platformRoles.some(role => hasPlatformRole(user, role))) return;
    const allowed = rule.platformRoles.map(r => `role=${r}`).join(' 或 ');
    throw new HttpError(403, `${reportType} 报告仅 ${allowed} 可提交（你的角色: ${describeUserRoles(user)}）`);
  }

  // any 模式：任何认证用户都可以
  if (rule.mode === 'any') return;

  // assignee 模式：检查是否是需求的 assignee
  if (rule.mode === 'assignee') {
    const requirement = await prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { assigneeId: true, assignee: true },
    });
    if (requirement?.assigneeId === user.id) return;
    // fallback: 如果 assigneeId 为空，用 name/email 匹配（兼容旧数据）
    if (requirement?.assignee && (requirement.assignee === user.name || requirement.assignee === user.email)) return;
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

    // autoRegisterRoutes 兼容：平路路径 (/api/reports) 时 params.id 为空，
    // 从 body.requirementId 取需求ID，注入到 params.id 供下游 handler 使用
    if (!params.id && body.requirementId) {
      params.id = body.requirementId;
    }
    if (!params.id) throw new HttpError(400, '缺少 requirementId');

    // 确认需求存在
    const requirement = await prisma.requirement.findUnique({
      where: { id: params.id },
      include: { assigneeUser: { select: { name: true, roles: true } } },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');
    assertDomainReadAccess(req.user!, requirement);

    // assigneeId 校验：非 assignee 不能提交报告（CTO 可以代操作）
    if (requirement.assigneeId && requirement.assigneeId !== req.user!.id && req.user!.role !== 'cto_agent') {
      throw new HttpError(403, `该任务当前有分配给其他成员，你无法为非自己名下的任务提交报告`);
    }

    // 校验提交者角色
    await validateReportRole(req.user!, body.reportType, params.id);

    // 9da94ac1: 报告绑定工作流步骤，实现 upsert 逻辑
    const workflowStep = requirement.currentStep ?? null;

    // 检查是否已存在同类型的报告
    const existingReport = await prisma.requirementReport.findFirst({
      where: {
        requirementId: params.id,
        reportType: body.reportType,
        workflowStep,
      },
      orderBy: { createdAt: 'desc' },
    });

    let report;

    if (existingReport) {
      // 如果已存在且为 approved，拒绝提交（已通过的报告不能覆盖）
      if (existingReport.status === 'approved') {
        throw new HttpError(409, `该需求当前步骤已存在 ${body.reportType} 报告（状态：approved），无法重复提交`);
      }

      // pending / changes_requested / rejected → 更新内容重新提交（upsert）
      report = await prisma.requirementReport.update({
        where: { id: existingReport.id },
        data: {
          content: body.content as Prisma.InputJsonValue,
          submittedBy: body.submittedBy ?? req.user!.name,
          submittedById: req.user!.id,
          status: 'pending',  // rejected 报告重新提交时重置为 pending
          qaReviewedAt: null,  // 清除 QA 审查记录
          qaReviewedBy: null,
          reviewComment: null,
          reviewedAt: null,
          updatedAt: new Date(),
        },
      });
    } else {
      // 不存在则创建
      report = await prisma.requirementReport.create({
        data: {
          requirementId: params.id,
          reportType: body.reportType,
          workflowStep,
          content: body.content as Prisma.InputJsonValue,
          submittedBy: body.submittedBy ?? req.user!.name,
          submittedById: req.user!.id,
        },
      });
    }

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
 * 仅 adc:qa 或 adc:admin 可访问
 */
reportsRouter.get(
  '/pending-review',
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const isQa = hasPlatformRole(actor, 'qa');
    const isAdmin = isPlatformAdmin(actor);
    if (!isQa && !isAdmin) {
      throw new HttpError(403, '仅 QA 或管理员可查看待审报告队列');
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const skip = (page - 1) * pageSize;

    const where: Prisma.RequirementReportWhereInput = {
      status: 'pending',
      reportType: { in: ['DEV_SELF_CHECK', 'TEST_REPORT', 'SECURITY_REVIEW'] },
    };

    // Domain scope filtering: restrict to user's allowed domains
    if (actor.crossDomainAccess) {
      // cross-domain admin sees all
    } else if (actor.allowedDomainKeys && actor.allowedDomainKeys.length > 0) {
      where.requirement = { domainKey: { in: actor.allowedDomainKeys } };
    } else {
      // No domain access → empty result
      (where as any).id = { in: [] };
    }

    const [reports, total] = await prisma.$transaction([
      prisma.requirementReport.findMany({
        where,
        include: {
          submittedByUser: { select: { id: true, name: true, email: true, roles: true } },
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
    // autoRegisterRoutes 兼容：平路路径 (/api/reports) 时 params.id 为空，
    // 从 query.requirementId 取需求ID
    const reqId = (req.params.id || (req.query as any)?.requirementId) as string | undefined;
    if (!reqId) throw new HttpError(400, '缺少 requirementId（通过路径或 query.requirementId 传入）');
    const { query } = listReportsSchema.parse({
      params: { id: reqId },
      query: req.query,
    });

    // 确认需求存在
    const requirement = await prisma.requirement.findUnique({
      where: { id: reqId },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');
    assertDomainReadAccess(req.user!, requirement);

    const where: Prisma.RequirementReportWhereInput = {
      requirementId: reqId,
    };
    if (query.reportType) where.reportType = query.reportType;
    if (query.status) where.status = query.status;

    const reports = await prisma.requirementReport.findMany({
      where,
      include: {
        submittedByUser: { select: { id: true, name: true, email: true, roles: true } },
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

    const reviewedAt = new Date();

    const updated = await prisma.requirementReport.update({
      where: { id: params.reportId },
      data: {
        qaReviewedAt: reviewedAt,
        qaReviewedBy: req.user!.name,
        reviewComment: body.reviewComment,
        // QA 审查直接改变报告状态（2026-06-05 改进：QA 是 qa_review 步骤的 assignee，应直接审批）
        status: body.status,
        reviewedAt,
      },
    });

    const reportEvent = body.status === 'approved' ? 'report.approved' : 'report.rejected';
    void notifyEvent(reportEvent as any, {
      id: report.requirementId,
      title: report.reportType,
      actor: req.user!.name,
    });

    // 如果是 rejected/changes_requested，触发报告打回逻辑
    if (body.status === 'rejected' || body.status === 'changes_requested') {
      const reqInfo = await prisma.requirement.findUnique({
        where: { id: report.requirementId },
        select: { title: true, currentStep: true, workflowId: true, workflowSnapshot: true, assigneeId: true, assignee: true, domainKey: true, workflow: { select: { steps: true } } },
      });

      if (reqInfo) assertDomainReadAccess(req.user!, reqInfo);

      if (reqInfo?.workflowId && reqInfo.currentStep) {
        void notifyEvent('report.rejected' as any, {
          id: report.requirementId,
          title: reqInfo.title,
          reportType: report.reportType,
          actor: req.user!.name,
        });

        // QA 驳回时自动退回工作流（不需要 QA 额外调 workflow/reject）
        let targetStep: string;
        switch (report.reportType) {
          case 'DEV_SELF_CHECK':
            targetStep = 'dev_self_check';
            break;
          case 'TEST_REPORT':
            targetStep = 'testing';
            break;
          case 'SECURITY_REVIEW':
            targetStep = 'dev_self_check';
            break;
          default:
            targetStep = reqInfo.currentStep;
        }

        // Get workflow steps (snapshot-first, legacy fallback)
        const rawJson = getWorkflowRawJson(reqInfo);
        if (rawJson) {
          const steps = parseSteps(rawJson);
          const currentIdx = steps.findIndex(s => s.name === reqInfo.currentStep!);
          const targetIdx = steps.findIndex(s => s.name === targetStep);
          const actualTarget = targetIdx >= 0 && targetIdx < currentIdx
            ? targetStep
            : currentIdx > 0 ? steps[currentIdx - 1].name : targetStep;

          if (actualTarget !== reqInfo.currentStep) {
            await prisma.requirement.update({
              where: { id: report.requirementId },
              data: { currentStep: actualTarget },
            });

            await prisma.workflowTransition.create({
              data: {
                requirement: { connect: { id: report.requirementId } },
                fromStep: reqInfo.currentStep,
                toStep: actualTarget,
                action: 'reject',
                actorId: req.user!.id,
                actorName: req.user!.name,
                actorRole: 'qa',
                comment: body.reviewComment || `QA 驳回 ${report.reportType} 报告，自动退回`,
              },
            });
          }
        }
      }
    }

    res.json({ success: true, data: updated, message: `QA 审查完成，报告已${body.status === 'approved' ? '通过' : '驳回'}` });
  }),
);

/**
 * PATCH /api/requirements/:id/reports/:reportId/qa-review-findings
 * Findings-driven QA review（2026-06-25 新增）
 *
 * QA 只需提交 findings（问题描述），系统自动决策：
 * - findings 为空 → auto approved
 * - ≥1 条 critical → auto rejected
 * - 只有 minor → auto approved
 *
 * 兼容旧流程：仍可通过 /qa-review 直接提交 approved/rejected
 */
reportsRouter.patch(
  '/:reportId/qa-review-findings',
  requireInternalRole('qa'),
  asyncHandler(async (req, res) => {
    const { params, body } = findingsReviewSchema.parse({
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

    // ─── 自动决策逻辑 ───
    const findings = body.findings;
    const hasCritical = findings.some(f => f.severity === 'critical');

    let autoStatus: 'approved' | 'rejected';
    let autoReason: string;

    if (findings.length === 0) {
      autoStatus = 'approved';
      autoReason = '无 findings，系统自动通过';
    } else if (hasCritical) {
      autoStatus = 'rejected';
      const criticalCount = findings.filter(f => f.severity === 'critical').length;
      const criticalSummary = findings
        .filter(f => f.severity === 'critical')
        .slice(0, 3)
        .map(f => f.description.slice(0, 50))
        .join('; ');
      autoReason = `共 ${criticalCount} 条 critical findings 未通过（${criticalSummary}${criticalCount > 3 ? '...' : ''}），系统自动驳回`;
    } else {
      autoStatus = 'approved';
      const minorCount = findings.length;
      autoReason = `${minorCount} 条 minor findings，系统自动通过`;
    }

    const reviewedAt = new Date();

    const updated = await prisma.requirementReport.update({
      where: { id: params.reportId },
      data: {
        qaReviewedAt: reviewedAt,
        qaReviewedBy: req.user!.name,
        reviewComment: body.reviewComment || autoReason,
        qaFindings: findings,
        status: autoStatus,
        reviewedAt,
      },
    });

    const reportEvent = autoStatus === 'approved' ? 'report.approved' : 'report.rejected';
    void notifyEvent(reportEvent as any, {
      id: report.requirementId,
      title: report.reportType,
      actor: req.user!.name,
    });

    // 如果驳回，触发报告打回逻辑
    if (autoStatus === 'rejected') {
      const reqInfo = await prisma.requirement.findUnique({
        where: { id: report.requirementId },
        select: { title: true, currentStep: true, workflowId: true, assigneeId: true, assignee: true, domainKey: true },
      });
      if (reqInfo) assertDomainReadAccess(req.user!, reqInfo);

      if (reqInfo?.workflowId && reqInfo.currentStep) {
        void notifyEvent('report.rejected' as any, {
          id: report.requirementId,
          title: reqInfo.title,
          reportType: report.reportType,
          actor: req.user!.name,
        });

        // 自动退回工作流
        let targetStep: string;
        switch (report.reportType) {
          case 'DEV_SELF_CHECK':
            targetStep = 'dev_self_check';
            break;
          case 'TEST_REPORT':
            targetStep = 'testing';
            break;
          case 'SECURITY_REVIEW':
            targetStep = 'dev_self_check';
            break;
          default:
            targetStep = reqInfo.currentStep;
        }

        const wf = await prisma.workflowTemplate.findUnique({
          where: { id: reqInfo.workflowId },
          select: { steps: true },
        });
        if (wf) {
          const steps = (wf.steps as any[]) || [];
          const currentIdx = steps.findIndex((s: any) => s.name === reqInfo.currentStep);
          const targetIdx = steps.findIndex((s: any) => s.name === targetStep);
          const actualTarget = targetIdx >= 0 && targetIdx < currentIdx
            ? targetStep
            : currentIdx > 0 ? steps[currentIdx - 1]?.name ?? targetStep : targetStep;

          if (actualTarget !== reqInfo.currentStep) {
            await prisma.requirement.update({
              where: { id: params.id },
              data: { currentStep: actualTarget },
            });

            await prisma.workflowTransition.create({
              data: {
                requirement: { connect: { id: params.id } },
                fromStep: reqInfo.currentStep,
                toStep: actualTarget,
                action: 'reject',
                actorId: req.user!.id,
                actorName: req.user!.name,
                actorRole: 'qa',
                comment: autoReason,
              },
            });
          }
        }
      }
    }

    res.json({
      success: true,
      data: updated,
      message: `Findings-based QA 审查完成，报告已${autoStatus === 'approved' ? '通过' : '驳回'}`,
      autoDecision: {
        status: autoStatus,
        reason: autoReason,
        findingsCount: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        minorCount: findings.filter(f => f.severity === 'minor').length,
      },
    });
  }),
);

// CTO 最终审批（或直接审批非 QA 流程的报告）
reportsRouter.patch(
  '/:reportId',
  asyncHandler(async (req, res, next) => {
    // 权限检查：adc:admin 直接通过，否则检查工作流步骤角色
    const isAdminOrCto = isPlatformAdmin(req.user!);
    if (isAdminOrCto) return next();

    // 工作流角色审批：检查报告是否属于当前用户负责的工作流步骤
    const { params } = reportIdSchema.parse({ params: req.params });
    const report = await prisma.requirementReport.findUnique({ where: { id: params.reportId } });
    if (!report) throw new HttpError(404, '报告不存在');

    // 查需求的工作流当前步骤（snapshot-first）
    const requirement = await prisma.requirement.findUnique({
      where: { id: report.requirementId },
      select: { id: true, currentStep: true, workflowSnapshot: true, domainKey: true, workflow: { select: { steps: true } } },
    });
    if (!requirement?.currentStep) {
      throw new HttpError(403, '只有 CTO 可以审批报告');
    }
    assertDomainReadAccess(req.user!, requirement);
    const rawJson = getWorkflowRawJson(requirement);
    if (!rawJson) {
      throw new HttpError(403, '只有 CTO 可以审批报告');
    }
    const stepsArray = parseSteps(rawJson);
    const currentStep = stepsArray.find(s => s.name === requirement.currentStep);
    if (!currentStep?.requiredReports?.includes(report.reportType)) {
      throw new HttpError(403, '只有 CTO 可以审批该报告（报告类型不在当前工作流步骤的待审批列表中）');
    }

    if (!hasWorkflowStepRole(req.user!, currentStep.role)) {
      throw new HttpError(403, `当前步骤需要「${currentStep.role}」角色，你的角色是「${describeUserRoles(req.user!)}」`);
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
    // 确保 params.id 可用（平路路径 /api/reports/:reportId 时从 report 取）
    if (!params.id) params.id = report.requirementId;
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
      select: { title: true, requesterId: true, assigneeId: true, assignee: true, currentStep: true, workflowId: true, workflowSnapshot: true, domainKey: true, workflow: { select: { steps: true } } },
    });
    if (reqInfo) assertDomainReadAccess(req.user!, reqInfo);
    const reportEvent = body.status === 'approved' ? 'report.approved' : 'report.rejected';
    void notifyEvent(reportEvent as any, {
      id: params.id,
      title: reqInfo?.title ?? '',
      reportType: report.reportType,
      actor: req.user!.name,
    });

    // ─── 报告打回自动回退需求状态 + assignee ───
    // 所有需求（有/无工作流）都会自动回退到上一步，给提交者修改机会
    if (body.status === 'rejected' && reqInfo) {
      const reportType = report.reportType as string;
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
          // 用 resolveAssigneeForStep 确保回退步骤的 assignee 角色正确（防止漂移）
          let rollbackAssigneeId: string | null = null;
          let rollbackAssigneeName: string | null = null;

          if (reqInfo.workflowId) {
            const rawJson = getWorkflowRawJson(reqInfo);
            if (rawJson) {
              const steps = parseSteps(rawJson);
              const targetStepDef = steps.find(s => s.name === targetStep);
              if (targetStepDef?.role) {
                try {
                  rollbackAssigneeId = await resolveAssigneeForStep(targetStepDef.role, reqInfo.assigneeId);
                  if (rollbackAssigneeId) {
                    rollbackAssigneeName = await getAssigneeName(rollbackAssigneeId);
                  }
                } catch (e) {
                  // resolveAssigneeForStep 可能因 roleUserMap 缺失抛出异常，
                  // 此时不清除 assignee（保留 null），防止漂移
                  rollbackAssigneeId = null;
                }
              }
            }
          }

          // fallback: 如果 resolveAssigneeForStep 没找到（无工作流），用历史 assignee
          if (!rollbackAssigneeId) {
            const lastRevision = await prisma.requirementRevision.findFirst({
              where: {
                requirementId: params.id,
                assignee: { not: null },
                status: { in: ['in_progress', 'testing'] },
              },
              orderBy: { createdAt: 'desc' },
              select: { assignee: true },
            });
            rollbackAssigneeName = lastRevision?.assignee ?? reqInfo.assignee;
            if (rollbackAssigneeName) {
              const assigneeUser = await prisma.user.findFirst({
                where: { OR: [{ name: rollbackAssigneeName }, { email: rollbackAssigneeName }] },
                select: { id: true },
              });
              rollbackAssigneeId = assigneeUser?.id ?? reqInfo.assigneeId;
            }
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
        submittedByUser: { select: { id: true, name: true, email: true, roles: true } },
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
      const reqInfo = await prisma.requirement.findUnique({ where: { id: req.params.id }, select: { id: true, domainKey: true } });
      if (!reqInfo) throw new HttpError(404, '需求不存在');
      assertDomainReadAccess(req.user!, reqInfo);
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
    await assertRequirementDomainById(report.requirementId, req.user!);

    // 权限检查：仅提交者本人或 adc:admin
    const isOwner = report.submittedById === req.user!.id;
    const isAdmin = isPlatformAdmin(req.user!);
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
export const router = reportsRouter;
export const mountPath = '/api/reports';
