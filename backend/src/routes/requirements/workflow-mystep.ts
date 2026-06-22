/**
 * Workflow MyStep Route
 *
 * GET /:id/workflow/myStep — 查看当前用户在该需求的工作流状态
 */
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { canReadRequirement } from './utils.js';
import {
  parseSteps,
  getCurrentStep,
  getNextStep,
  mapUserRole,
  checkReportsApproved,
} from './workflow-helpers.js';

export function registerWorkflowMyStepRoutes(router: import('express').Router): void {

  /**
   * GET /mine/rejected-reports — 查询当前用户被驳回的报告
   */
  router.get(
    '/mine/rejected-reports',
    asyncHandler(async (req, res) => {
      const userId = req.user!.id;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const from = req.query.from ? new Date(req.query.from as string) : thirtyDaysAgo;
      const to = req.query.to ? new Date(req.query.to as string) : now;

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        throw new HttpError(400, 'from/to 日期格式无效，请使用 ISO 8601 格式');
      }

      const reports = await prisma.requirementReport.findMany({
        where: {
          submittedById: userId,
          status: 'rejected',
          createdAt: { gte: from, lte: to },
        },
        include: {
          requirement: {
            select: { id: true, title: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      res.json({
        data: reports.map(r => ({
          requirementId: r.requirementId,
          requirementTitle: r.requirement.title,
          reportType: r.reportType,
          reviewComment: r.reviewComment,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
        })),
        total: reports.length,
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }),
  );

  /**
   * GET /:id/workflow/myStep — 查看当前用户在该需求的工作流状态
   */
  router.get(
    '/:id/workflow/myStep',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!canReadRequirement(req.user!, requirement)) throw new HttpError(403, '无权查看该需求');

      // 没有分配工作流
      if (!requirement.workflow || !requirement.currentStep) {
        return res.json({
          data: {
            requirementId: requirement.id,
            hasWorkflow: false,
            message: '该需求未分配工作流，使用旧版状态流转',
          },
        });
      }

      const steps = parseSteps(requirement.workflow.steps);
      const currentStep = getCurrentStep(steps, requirement.currentStep);
      if (!currentStep) {
        return res.json({
          data: {
            requirementId: requirement.id,
            hasWorkflow: true,
            workflowName: requirement.workflow.name,
            currentStep: requirement.currentStep,
            message: '当前步骤不在工作流定义中',
          },
        });
      }

      // 检查当前用户是否可以操作
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      const canOperate = !!matchedRole || req.user!.role === 'admin' || req.user!.role === 'cto_agent';

      // 检查报告完成情况
      const { ok: reportsReady, missing } = await checkReportsApproved(params.id, currentStep.requiredReports);

      // 获取下一步信息
      const nextStep = getNextStep(steps, requirement.currentStep);

      // 获取历史流转
      const transitions = await prisma.workflowTransition.findMany({
        where: { requirementId: params.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      res.json({
        data: {
          requirementId: requirement.id,
          hasWorkflow: true,
          workflowName: requirement.workflow.name,
          workflowDisplayName: requirement.workflow.displayName,
          currentStep: {
            name: currentStep.name,
            displayName: currentStep.displayName,
            role: currentStep.role,
            requiredReports: currentStep.requiredReports,
            autoAdvance: currentStep.autoAdvance,
          },
          nextStep: nextStep ? { name: nextStep.name, displayName: nextStep.displayName } : null,
          canOperate,
          reportsReady,
          missingReports: missing,
          isLastStep: !nextStep,
          recentTransitions: transitions.map(t => ({
            fromStep: t.fromStep,
            toStep: t.toStep,
            action: t.action,
            actorName: t.actorName,
            actorRole: t.actorRole,
            comment: t.comment,
            createdAt: t.createdAt,
          })),
          allSteps: steps.map(s => ({
            name: s.name,
            displayName: s.displayName,
            role: s.role,
          })),
        },
      });
    }),
  );
}
