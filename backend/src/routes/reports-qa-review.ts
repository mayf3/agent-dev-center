import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { notifyEvent } from '../utils/notifications.js';
import { resolveAssigneeForStep } from '../lib/assignee-resolver.js';
import { ReportType } from '@prisma/client';
import { requireInternalRole } from '../middleware/internal-workflow.js';
import { reviewReportSchema } from '../schemas/report.js';

export const router = Router({ mergeParams: true });
export const mountPath = '/api/reports';

// QA 审批 TEST_REPORT 和 SECURITY_REVIEW
router.patch(
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
        select: { title: true, currentStep: true, workflowId: true, assigneeId: true, assignee: true },
      });

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

        // 获取工作流步骤，确保 targetStep 在当前步骤之前
        const wf = await prisma.workflowTemplate.findUnique({
          where: { id: reqInfo.workflowId },
          select: { steps: true },
        });
        if (wf) {
          const stepDefs = (wf.steps as any[]) || [];
          const currentIdx = stepDefs.findIndex((s: any) => s.name === reqInfo.currentStep);
          const targetIdx = stepDefs.findIndex((s: any) => s.name === targetStep);
          const actualTarget = targetIdx >= 0 && targetIdx < currentIdx
            ? targetStep
            : currentIdx > 0 ? stepDefs[currentIdx - 1]?.name ?? targetStep : targetStep;

          if (actualTarget !== reqInfo.currentStep) {
            // 自动重新分配 assignee：用目标步骤的 role 解析对应的用户
            const targetStepDef = stepDefs.find((s: any) => s.name === actualTarget);
            let rollbackAssigneeId: string | null = null;
            if (targetStepDef?.role) {
              rollbackAssigneeId = await resolveAssigneeForStep(targetStepDef.role, reqInfo.assigneeId);
            }

            await prisma.requirement.update({
              where: { id: params.id },
              data: {
                currentStep: actualTarget,
                assigneeId: rollbackAssigneeId ?? reqInfo.assigneeId,
              },
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
