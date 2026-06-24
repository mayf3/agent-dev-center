/**
 * reports-approval.ts — CTO 审批报告路由
 * PATCH /api/reports/:reportId（含 QA Bypass、工作流回退）
 * Extracted from reports.ts (≤500 line split)
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { notifyEvent } from '../utils/notifications.js';
import { resolveAssigneeForStep } from '../lib/assignee-resolver.js';
import { ReportType } from '@prisma/client';
import { isPlatformAdmin } from '../lib/platform-roles.js';
import { reviewReportSchema, reportIdSchema } from '../schemas/report.js';

export const router = Router({ mergeParams: true });
export const mountPath = '/api/reports';

// QA Bypass 最小等待时间（2 小时）
const QA_BYPASS_MIN_WAIT_MS = 2 * 60 * 60 * 1000;

function describeUserRoles(user: Express.AuthUser): string {
  const roles = [user.role, user.internalRole, user.okrRole].filter(Boolean);
  return roles.join(', ');
}

function hasWorkflowStepRole(user: Express.AuthUser, stepRole: string): boolean {
  const userRoles = [user.role, user.internalRole, user.okrRole].filter(Boolean);
  return userRoles.includes(stepRole) || userRoles.includes('cto');
}


// CTO 最终审批（或直接审批非 QA 流程的报告）
router.use((req, _res, next) => {
  if (!req.params.id) {
    req.params.id = req.body?.requirementId || (req.query as any)?.requirementId || req.params.id;
  }
  next();
});

router.patch(
  '/:reportId',

  asyncHandler(async (req, res, next) => {
    // 权限检查：adc:admin 直接通过，否则检查工作流步骤角色
    const isAdminOrCto = isPlatformAdmin(req.user!);
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

      // 无论有无工作流，报告驳回都自动回退
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
        case 'ARCH_DESIGN':
          targetStep = 'arch_design';
          break;
        case 'ARCH_REVIEW':
          targetStep = 'dev_self_check';
          break;
        default:
          break;
      }

      if (targetStep && reqInfo.workflowId) {
        // 工作流模式：使用 workflow reject 逻辑回退（自动解析 assignee）
        const wf = await prisma.workflowTemplate.findUnique({
          where: { id: reqInfo.workflowId },
          select: { steps: true },
        });
        const stepDefs = (wf?.steps as any[]) || [];
        const targetStepDef = stepDefs.find((s: any) => s.name === targetStep);
        const currentIdx = stepDefs.findIndex((s: any) => s.name === reqInfo.currentStep);
        const targetIdx = stepDefs.findIndex((s: any) => s.name === targetStep);
        const actualTarget = targetIdx >= 0 && targetIdx < currentIdx
          ? targetStep
          : currentIdx > 0 ? stepDefs[currentIdx - 1]?.name ?? targetStep : targetStep;

        if (actualTarget !== reqInfo.currentStep) {
          let rollbackAssigneeId: string | null = reqInfo.assigneeId;
          if (targetStepDef?.role) {
            rollbackAssigneeId = await resolveAssigneeForStep(targetStepDef.role, reqInfo.assigneeId);
          }

          await prisma.requirement.update({
            where: { id: params.id },
            data: {
              currentStep: actualTarget,
              assigneeId: rollbackAssigneeId,
            },
          });

          await prisma.workflowTransition.create({
            data: {
              requirementId: params.id,
              fromStep: reqInfo.currentStep ?? '',
              toStep: actualTarget,
              action: 'reject',
              actorId: req.user!.id,
              actorName: req.user!.name,
              actorRole: req.user!.internalRole ?? req.user!.role ?? 'cto',
              comment: body.reviewComment || `${reportType} 报告被打回，自动回退至 ${actualTarget}`,
            },
          });

          void notifyEvent('requirement.step_changed' as any, {
            id: params.id,
            title: reqInfo.title ?? '',
            currentStep: actualTarget,
            actor: req.user!.name,
          });
        }
      } else if (targetStep && !reqInfo.workflowId) {
        // 旧版非工作流模式保留原逻辑
        let rollbackAssigneeName: string | null = null;
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

        await prisma.requirement.update({
          where: { id: params.id },
          data: {
            currentStep: targetStep,
            assignee: rollbackAssigneeName,
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
            revisionNote: `${reportType} 报告被打回，步骤回退至 ${targetStep}`,
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
