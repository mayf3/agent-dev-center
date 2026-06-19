import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { advanceStepSchema } from '../../schemas/workflow.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import {
  getWorkflowSteps,
  getWorkflowRawJson,
  getCurrentStep,
  getNextStep,
  mapUserRole,
  checkReportsApproved,
  getStepWipCount,
  extractRoleUserMap,
} from './workflow-helpers.js';
import {
  skipSecurityIfApplicable,
  shouldReleaseTestEnvLock,
  autoAdvanceTestEnvQueue,
} from './workflow-advance-helpers.js';
import { tryReplayAdvance, executeAdvanceTransition } from '../../lib/workflow-transition/index.js';
import { prisma } from '../../lib/prisma.js';

export function registerWorkflowAdvanceRoutes(router: import('express').Router): void {

  router.post(
    '/:id/workflow/advance',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = advanceStepSchema.parse({ body: req.body });

      const { execution } = body;
      const isAgentAccount = !!req.user!.agentId;

      if (isAgentAccount && !execution) {
        throw new HttpError(409, 'Agent accounts must provide execution proof for advance');
      }

      if (execution) {
        const replayed = await tryReplayAdvance({
          requirementId: params.id,
          actor: { id: req.user!.id, name: req.user!.name, role: req.user!.internalRole ?? req.user!.role, agentId: req.user!.agentId },
          execution: { leaseId: execution.leaseId, sessionId: execution.sessionId, idempotencyKey: execution.idempotencyKey, expectedStateVersion: execution.expectedStateVersion },
          requestedBranch: body.branch,
          comment: body.comment,
          fromStep: undefined,
          toStep: undefined,
        });
        if (replayed) {
          return res.json({
            success: true,
            replayed: true,
            data: {
              ...replayed,
              toStepDisplayName: replayed.toStepDisplayName ?? '',
            },
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

      if (currentStep.name === 'draft') {
        const isRequester = requirement.requesterId === req.user!.id;
        if (!isRequester && req.user!.role !== 'cto_agent') {
          throw new HttpError(403, '只有需求提出者可以提交草稿到 PM 审批');
        }
      } else {
        if (requirement.assigneeId && requirement.assigneeId !== req.user!.id && req.user!.role !== 'cto_agent') {
          throw new HttpError(403, `该任务当前分配给了「${requirement.assignee}」，你无法操作非自己名下的任务`);
        }
        const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
        if (!matchedRole && req.user!.role !== 'cto_agent') {
          throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
        }
      }

      const reqType = requirement.type;
      const isNonSecurityType = reqType !== 'SECURITY';
      const currentReports = isNonSecurityType
        ? currentStep.requiredReports.filter(r => r !== 'SECURITY_REVIEW')
        : currentStep.requiredReports;
      if (currentReports.length > 0) {
        const { ok, missing } = await checkReportsApproved(params.id, currentReports);
        if (!ok) {
          const reportLabels: Record<string, string> = {
            DEV_SELF_CHECK: '开发自检报告', MERGE_REPORT: '合并报告', TEST_REPORT: '测试报告',
            SECURITY_REVIEW: '安全检查报告', CTO_REVIEW: 'CTO验收报告', DEPLOY_CONFIRM: '部署确认报告',
          };
          throw new HttpError(400, `推进失败：当前步骤缺少已通过的报告 — ${missing.map(t => reportLabels[t] ?? t).join('、')}`);
        }
      }

      const effectiveBranch = body.branch ?? requirement.branch;
      if (currentStep.name === 'merge_to_main') {
        const req = await prisma.requirement.findUnique({
          where: { id: params.id }, select: { gitHash: true, branch: true, repoPath: true },
        });
        const errors: string[] = [];
        if (!req?.gitHash) errors.push('缺少 gitHash，请先提交代码并更新 gitHash');
        if (!effectiveBranch) errors.push('缺少 branch，请指定代码分支名');
        if (errors.length > 0) throw new HttpError(400, `merge_to_main 验证失败：\n${errors.join('\n')}`);
      }

      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;
      if (nextStep.autoAdvance) {
        const afterNext = getNextStep(steps, nextStep.name);
        if (afterNext) targetStep = afterNext;
      }

      const { targetStep: resolvedStep } = skipSecurityIfApplicable(targetStep, reqType, steps);
      targetStep = resolvedStep;

      const skippedAutoStep = targetStep.name !== nextStep.name ? nextStep.name : null;

      if (targetStep.wipLimit && targetStep.wipLimit > 0) {
        const currentWip = await getStepWipCount(targetStep.name, params.id);
        if (currentWip >= targetStep.wipLimit) {
          throw new HttpError(409, `步骤「${targetStep.displayName}」WIP 已达上限（${currentWip}/${targetStep.wipLimit}），请等待现有任务完成后重试`);
        }
      }

      const workflowRawJson = getWorkflowRawJson(requirement);
      const roleUserMap = workflowRawJson ? extractRoleUserMap(workflowRawJson) : undefined;
      let newAssigneeId: string | null;
      try {
        const hasRoleUserMap = roleUserMap && Object.keys(roleUserMap).length > 0;
        if (hasRoleUserMap || targetStep.assigneeMode) {
          newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId, {
            assigneeMode: targetStep.assigneeMode, roleUserMap,
            requirement: { id: requirement.id, requesterId: requirement.requesterId, assigneeId: requirement.assigneeId },
          });
        } else {
          newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, `assignee 解析失败: ${msg}`);
      }

      const newAssigneeName = await getAssigneeName(newAssigneeId);

      let lockAction: import('../../lib/workflow-transition/transition-types.js').LockAction = { type: 'none' as const };
      if (targetStep.name === 'test_env_deploy') {
        lockAction = { type: 'acquire' as const, title: requirement.title, branch: effectiveBranch };
      } else if (shouldReleaseTestEnvLock(requirement.currentStep, targetStep.name)) {
        lockAction = { type: 'release' as const };
      }

      const result = await executeAdvanceTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: targetStep.name,
        toStepDisplayName: targetStep.displayName,
        stateVersion: requirement.stateVersion,
        newAssigneeId,
        newAssigneeName,
        comment: body.comment,
        effectiveBranch: effectiveBranch,
        requestedBranch: body.branch,
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
        skippedAutoStep,
        finalStepName: steps[steps.length - 1]?.name ?? '',
      });

      res.json({
        success: true,
        replayed: result.replayed,
        data: {
          requirementId: result.requirementId,
          fromStep: result.fromStep,
          toStep: result.toStep,
          toStepDisplayName: result.toStepDisplayName ?? targetStep.displayName,
          newAssigneeId: result.newAssigneeId,
          newAssigneeName: result.newAssigneeName,
          isDone: result.isDone,
          newStateVersion: result.newStateVersion,
        },
      });

      if (result.lockReleased) autoAdvanceTestEnvQueue();
    }),
  );
}
