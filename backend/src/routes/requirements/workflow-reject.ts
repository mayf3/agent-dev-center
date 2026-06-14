/**
 * Workflow Reject Route
 *
 * POST /:id/workflow/reject — 回退到上一步
 */
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { rejectStepSchema } from '../../schemas/workflow.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import {
  parseSteps,
  getCurrentStep,
  getPreviousStep,
  mapUserRole,
  logTransition,
  WorkflowStep,
} from './workflow-helpers.js';

export function registerWorkflowRejectRoutes(router: import('express').Router): void {

  /**
   * POST /:id/workflow/reject — 回退到上一步
   */
  router.post(
    '/:id/workflow/reject',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = rejectStepSchema.parse({ body: req.body });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');
      if (!requirement.currentStep) throw new HttpError(400, '该需求无当前步骤');

      const steps = parseSteps(requirement.workflow.steps);
      const currentStep = getCurrentStep(steps, requirement.currentStep);
      if (!currentStep) throw new HttpError(400, `当前步骤「${requirement.currentStep}」在工作流中不存在`);

      // assigneeId 校验：非 assignee 不能操作（CTO 可以代操作）
      if (requirement.assigneeId && requirement.assigneeId !== req.user!.id && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `该任务当前分配给了「${requirement.assignee}」，你无法回退非自己名下的任务`);
      }

      // 角色校验
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      if (!matchedRole && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色才能回退`);
      }

      // 确定回退目标步骤
      let targetStepName: string;
      let targetStepDef: WorkflowStep | undefined;

      if (body.targetStep) {
        // 方案A：支持指定回退到任意前序步骤
        const target = steps.find(s => s.name === body.targetStep);
        if (!target) {
          throw new HttpError(400, `步骤「${body.targetStep}」在工作流中不存在`);
        }
        const currentIndex = steps.findIndex(s => s.name === requirement.currentStep);
        const targetIndex = steps.findIndex(s => s.name === body.targetStep);
        if (targetIndex >= currentIndex) {
          throw new HttpError(400, `回退目标步骤「${target.displayName}」必须在当前步骤「${currentStep.displayName}」之前`);
        }
        targetStepName = target.name;
        targetStepDef = target;
      } else {
        // PM reject → always go to draft
        if (currentStep.name === 'submitted' || currentStep.name === 'pm_review') {
          const draftStep = steps.find(s => s.name === 'draft');
          targetStepName = draftStep?.name ?? 'draft';
          targetStepDef = draftStep;
        } else {
          // 智能回退：有些步骤驳回一步不能到真正需要修改的人
          const REJECT_TO_DEV = ['security_review', 'cto_review', 'merge_to_main', 'deploying', 'qa_review_deploy', 'done'];
          if (REJECT_TO_DEV.includes(currentStep.name ?? '')) {
            const devStep = steps.find(s => s.name === 'dev_self_check');
            targetStepName = devStep?.name ?? 'dev_self_check';
            targetStepDef = devStep ?? undefined;
          } else {
            // 默认：回退一步
            const prevStep = getPreviousStep(steps, requirement.currentStep);
            targetStepName = prevStep ? prevStep.name : steps[0]?.name ?? 'dev_self_check';
            targetStepDef = prevStep ?? steps[0];
          }
        }
      }

      // 自动解析回退步骤的 assigneeId
      let newAssigneeId = targetStepDef
        ? await resolveAssigneeForStep(targetStepDef.role, requirement.assigneeId)
        : requirement.assigneeId;

      // 回退到 draft 时 assignee 设为需求提出者（requester 需要修改后重新提交）
      if (targetStepName === 'draft' && requirement.requesterId) {
        newAssigneeId = requirement.requesterId;
      }

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: {
          currentStep: targetStepName,
          assigneeId: newAssigneeId,
        },
      });

      const newAssigneeName = await getAssigneeName(newAssigneeId);

      await logTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: targetStepName,
        action: 'reject',
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
          toStep: targetStepName,
          newAssigneeId,
          newAssigneeName,
          comment: body.comment,
        },
      });
    }),
  );
}
