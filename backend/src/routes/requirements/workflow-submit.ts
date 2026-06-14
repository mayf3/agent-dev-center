/**
 * Workflow Submit Route
 *
 * POST /:id/workflow/submit — 提交草稿到已提交待审批
 * 需求提出者将草稿提交，等待 PM 审批进入流水线
 */
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { submitStepSchema } from '../../schemas/workflow.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import {
  parseSteps,
  getCurrentStep,
  mapUserRole,
  logTransition,
} from './workflow-helpers.js';

export function registerWorkflowSubmitRoutes(router: import('express').Router): void {

  /**
   * POST /:id/workflow/submit — 提交草稿到已提交待审批
   * 只有需求提出者（或 CTO）可以提交
   */
  router.post(
    '/:id/workflow/submit',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = submitStepSchema.parse({ body: req.body });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');
      if (!requirement.currentStep) throw new HttpError(400, '该需求无当前步骤');

      // 只能在 draft 步骤提交
      if (requirement.currentStep !== 'draft') {
        throw new HttpError(400, `当前步骤为「${requirement.currentStep}」，只有草稿状态才能提交`);
      }

      const steps = parseSteps(requirement.workflow.steps);
      const currentStep = getCurrentStep(steps, requirement.currentStep);
      if (!currentStep) throw new HttpError(400, `当前步骤「${requirement.currentStep}」在工作流中不存在`);

      // 只有需求提出者或 CTO 可以提交
      const isRequester = requirement.requesterId === req.user!.id;
      if (!isRequester && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, '只有需求提出者可以提交草稿到已提交待审批');
      }

      // 必须有 gitHash
      if (!requirement.gitHash) {
        throw new HttpError(400, '提交失败：请先提交代码并填写 gitHash');
      }

      // 目标步骤：submitted
      const targetStep = steps.find(s => s.name === 'submitted');
      if (!targetStep) {
        throw new HttpError(400, '工作流中不存在「已提交待审批」步骤');
      }

      // 自动解析 assigneeId（PM 角色）
      const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: {
          currentStep: targetStep.name,
          assigneeId: newAssigneeId,
        },
      });

      const newAssigneeName = await getAssigneeName(newAssigneeId);

      await logTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: targetStep.name,
        action: 'advance',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        comment: body.comment,
      });

      res.json({
        success: true,
        data: {
          requirementId: updated.id,
          fromStep: requirement.currentStep,
          toStep: targetStep.name,
          toStepDisplayName: targetStep.displayName,
          newAssigneeId,
          newAssigneeName,
          isDone: false,
        },
      });
    }),
  );
}
