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
} from './workflow-helpers.js';
import { recordRequirementEvent, buildWorkflowEvent } from '../../services/requirement-event-ledger-service.js';
import { RequirementEventType } from '../../lib/requirement-event-types.js';
import { RequirementReasonCode } from '../../lib/requirement-reason-codes.js';
import { recordGuardrailBlocked } from '../../lib/record-guardrail-event.js';
import { txReadRequirement, txCreateTransition, REQUIREMENT_TRANSITION_SELECT } from './workflow-cas-helper.js';

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
        recordGuardrailBlocked({
          requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
          reasonCode: RequirementReasonCode.DEPLOY_FIELD_MISSING,
          reasonText: '缺少 gitHash',
          fromStep: requirement.currentStep,
          source: 'workflow-submit.githash-check',
          metadata: { missingFields: ['gitHash'] },
        });
        throw new HttpError(400, '提交失败：请先提交代码并填写 gitHash');
      }

      // 目标步骤：submitted
      const targetStep = steps.find(s => s.name === 'submitted');
      if (!targetStep) {
        throw new HttpError(400, '工作流中不存在「已提交待审批」步骤');
      }

      // 自动解析 assigneeId（PM 角色）
      const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);

      // ── 事务：业务更新 + Transition + Ledger 一同写入 ──
      const { updated, transition } = await prisma.$transaction(async (tx: any) => {
        const beforeReq = await txReadRequirement(tx, params.id);

        const updated = await tx.requirement.update({
          where: { id: params.id },
          data: {
            currentStep: targetStep.name,
            assigneeId: newAssigneeId,
          },
          select: REQUIREMENT_TRANSITION_SELECT,
        });

        const transition = await txCreateTransition(tx, {
          requirement: { connect: { id: params.id } },
          fromStep: requirement.currentStep,
          toStep: targetStep.name,
          action: 'advance',
          actorId: req.user!.id,
          actorName: req.user!.name,
          actorRole: req.user!.internalRole ?? req.user!.role,
          comment: body.comment,
        });

        await recordRequirementEvent(tx, buildWorkflowEvent(RequirementEventType.DRAFT_SUBMITTED, {
          requirementId: params.id,
          fromStep: requirement.currentStep, toStep: targetStep.name,
          fromAssigneeId: requirement.assigneeId, toAssigneeId: newAssigneeId,
          actorId: req.user!.id, actorName: req.user!.name,
          reasonText: body.comment,
          stateVersionBefore: beforeReq.stateVersion ?? 0,
          stateVersionAfter: updated.stateVersion ?? 0,
          relatedTransitionId: transition.id,
        }));

        return { updated, transition };
      });

      const newAssigneeName = await getAssigneeName(newAssigneeId);

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
