import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { rejectStepSchema } from '../../schemas/workflow.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import {
  getWorkflowSteps,
  getCurrentStep,
  getPreviousStep,
  mapUserRole,
  WorkflowStep,
} from './workflow-helpers.js';
import {
  shouldReleaseTestEnvLock,
} from './workflow-advance-helpers.js';
import { tryReplayReject, executeRejectTransition } from '../../lib/workflow-transition/index.js';
import { prisma } from '../../lib/prisma.js';

export function registerWorkflowRejectRoutes(router: import('express').Router): void {

  router.post(
    '/:id/workflow/reject',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = rejectStepSchema.parse({ body: req.body });

      const { execution } = body;
      const isAgentAccount = !!req.user!.agentId;

      if (isAgentAccount && !execution) {
        throw new HttpError(409, 'Agent accounts must provide execution proof for reject');
      }

      if (execution) {
        const replayed = await tryReplayReject({
          requirementId: params.id,
          actor: { id: req.user!.id, name: req.user!.name, role: req.user!.internalRole ?? req.user!.role, agentId: req.user!.agentId },
          execution: { leaseId: execution.leaseId, sessionId: execution.sessionId, idempotencyKey: execution.idempotencyKey, expectedStateVersion: execution.expectedStateVersion },
          comment: body.comment,
          fromStep: undefined,
          toStep: undefined,
          targetStep: body.targetStep,
        });
        if (replayed) {
          return res.json({
            success: true,
            replayed: true,
            data: replayed,
          });
        }
      }

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');
      if (!requirement.currentStep) throw new HttpError(400, '该需求无当前步骤');

      const steps = getWorkflowSteps(requirement);
      const currentStep = getCurrentStep(steps, requirement.currentStep);
      if (!currentStep) throw new HttpError(400, `当前步骤「${requirement.currentStep}」在工作流中不存在`);

      if (requirement.assigneeId && requirement.assigneeId !== req.user!.id && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `该任务当前分配给了「${requirement.assignee}」，你无法回退非自己名下的任务`);
      }

      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      if (!matchedRole && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色才能回退`);
      }

      let targetStepName: string;
      let targetStepDef: WorkflowStep | undefined;

      if (body.targetStep) {
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
        const REJECT_TO_DEV = ['test_env_deploy', 'qa_review', 'security_review', 'cto_review', 'merge_to_main', 'deploying', 'qa_review_deploy', 'done'];
        if (REJECT_TO_DEV.includes(currentStep.name ?? '')) {
          const devStep = steps.find(s => s.name === 'dev_self_check');
          targetStepName = devStep?.name ?? 'dev_self_check';
          targetStepDef = devStep ?? undefined;
        } else {
          const prevStep = getPreviousStep(steps, requirement.currentStep);
          targetStepName = prevStep ? prevStep.name : steps[0]?.name ?? 'dev_self_check';
          targetStepDef = prevStep ?? steps[0];
        }
      }

      let newAssigneeId: string | null;
      try {
        newAssigneeId = targetStepDef
          ? await resolveAssigneeForStep(targetStepDef.role, requirement.assigneeId)
          : requirement.assigneeId;
      } catch {
        newAssigneeId = requirement.assigneeId;
      }

      let requesterIdToWrite: string | null | undefined = undefined;
      if (targetStepName === 'draft') {
        if (requirement.requesterId) {
          newAssigneeId = requirement.requesterId;
        } else if (requirement.requester) {
          const requesterUser = await prisma.user.findFirst({
            where: { name: requirement.requester },
            select: { id: true, name: true }
          });
          if (requesterUser) {
            newAssigneeId = requesterUser.id;
            requesterIdToWrite = requesterUser.id;
          } else {
            throw new HttpError(400,
              `需求「${requirement.title}」的 requester「${requirement.requester}」在用户表中不存在，无法回退到 draft`
            );
          }
        } else {
          throw new HttpError(400,
            `需求「${requirement.title}」缺少 requester 信息（requesterId 和 requester 均为空），无法回退到 draft`
          );
        }
      }

      const newAssigneeName = await getAssigneeName(newAssigneeId);

      let lockAction: import('../../lib/workflow-transition/transition-types.js').LockAction = { type: 'none' as const };
      try {
        if (shouldReleaseTestEnvLock(requirement.currentStep, targetStepName)) {
          lockAction = { type: 'release' as const };
        }
      } catch {
        // lock release failure should not prevent reject
      }

      const result = await executeRejectTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: targetStepName,
        stateVersion: requirement.stateVersion,
        newAssigneeId,
        newAssigneeName,
        comment: body.comment,
        targetStep: body.targetStep,
        actor: {
          id: req.user!.id,
          name: req.user!.name,
          role: req.user!.internalRole ?? req.user!.role,
          agentId: req.user!.agentId,
        },
        execution: execution ? {
          leaseId: execution.leaseId,
          sessionId: execution.sessionId,
          idempotencyKey: execution.idempotencyKey,
          expectedStateVersion: execution.expectedStateVersion,
        } : undefined,
        lockAction,
        requesterId: requesterIdToWrite,
      });

      res.json({
        success: true,
        replayed: result.replayed,
        data: {
          requirementId: result.requirementId,
          fromStep: result.fromStep,
          toStep: result.toStep,
          newAssigneeId: result.newAssigneeId,
          newAssigneeName: result.newAssigneeName,
          comment: body.comment,
          newStateVersion: result.newStateVersion,
        },
      });
    }),
  );
}
