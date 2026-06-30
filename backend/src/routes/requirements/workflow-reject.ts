/**
 * Workflow Reject Route
 *
 * POST /:id/workflow/reject — 回退到上一步
 *
 * Execution split into two phases:
 *   Phase 1 — reads, calculations, validations (NO database writes)
 *   Phase 2 — side effects (lock release, update, transition, response)
 *
 * 2026-06-16: 从测试环境保护范围（test_env_deploy → deploying）reject 时释放锁。
 * 避免孤儿锁导致所有后续任务卡在 qa_review。
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { rejectStepSchema } from '../../schemas/workflow.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import {
  getWorkflowRoutingContext,
  getCurrentStep,
  getPreviousStep,
  mapUserRole,
  WorkflowStep,
} from './workflow-helpers.js';
import {
  releaseTestEnvLock,
  shouldReleaseTestEnvLock,
  TestEnvLockOwnership,
} from './workflow-advance-helpers.js';
import { casUpdateRequirement, txCreateTransition, txReadRequirement } from './workflow-cas-helper.js';
import { createFeedbackEvent } from './feedback-events.js';

export function registerWorkflowRejectRoutes(router: import('express').Router): void {

  /**
   * POST /:id/workflow/reject — 回退到上一步
   */
  router.post(
    '/:id/workflow/reject',
    asyncHandler(async (req, res) => {
      // ── Phase 1: 纯读取、计算、校验（无数据库写入） ──────────

      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = rejectStepSchema.parse({ body: req.body });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        include: { workflow: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (!requirement.workflow) throw new HttpError(400, '该需求未分配工作流');
      if (!requirement.currentStep) throw new HttpError(400, '该需求无当前步骤');

      const ctx = getWorkflowRoutingContext(requirement);
      const steps = ctx.steps;
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

      // ── 计算 effectiveRequesterId（draft 路径） ──
      // 必须在 resolveAssigneeForStep 之前完成，因为 resolver 可能需要 requesterId
      let effectiveRequesterId: string | null | undefined = requirement.requesterId;
      let requesterIdNeedsBackfill = false;

      // Fix 2 (e97eb46b): 回退到 draft 时 assignee 设为需求提出者
      // — 纯计算 effectiveRequesterId，不提前写入数据库
      if (targetStepName === 'draft') {
        if (!effectiveRequesterId && requirement.requester) {
          const requesterUser = await prisma.user.findFirst({
            where: { name: requirement.requester },
            select: { id: true, name: true }
          });
          if (!requesterUser?.id) {
            throw new HttpError(400, '目标步骤负责人配置无效');
          }
          effectiveRequesterId = requesterUser.id;
          requesterIdNeedsBackfill = true;
        } else if (!effectiveRequesterId) {
          throw new HttpError(400, '目标步骤负责人配置无效');
        }
      }

      // 构造传给 resolver 的只读 context（已计算的 requesterId）
      const resolverRequirement = {
        id: requirement.id,
        requesterId: effectiveRequesterId,
        assigneeId: requirement.assigneeId,
      };

      // ── 解析回退步骤的 assigneeId ──
      let newAssigneeId: string | null;
      if (targetStepDef) {
        try {
          newAssigneeId = await resolveAssigneeForStep(targetStepDef.role, requirement.assigneeId, {
            assigneeMode: targetStepDef.assigneeMode ?? 'role-based',
            roleUserMap: ctx.roleUserMap,
            requirement: resolverRequirement,
          });
        } catch {
          throw new HttpError(400, '目标步骤负责人配置无效');
        }
      } else {
        newAssigneeId = requirement.assigneeId;
      }

      // draft 路径：assignee 强制为 effectiveRequesterId（resolver 已知 requesterId，但 draft 固定回 requester）
      if (targetStepName === 'draft') {
        newAssigneeId = effectiveRequesterId;
      }

      // ── 验证 mapped ID 和用户存在性（fail-closed） ──
      let newAssigneeName: string | null;
      if (newAssigneeId !== null) {
        const uuidCheck = z.string().uuid().safeParse(newAssigneeId);
        if (!uuidCheck.success) {
          throw new HttpError(400, '目标步骤负责人配置无效');
        }
        try {
          newAssigneeName = await getAssigneeName(newAssigneeId);
        } catch {
          throw new HttpError(400, '目标步骤负责人配置无效');
        }
        if (!newAssigneeName) {
          throw new HttpError(400, '目标步骤负责人配置无效');
        }
      } else {
        newAssigneeName = null;
      }

      // ── Phase 1 完成：所有校验通过 ────────────────────────────

	      // ── Phase 2: 写副作用（CAS事务保证一致） ──────────────

	      const updated = await prisma.$transaction(async (tx) => {
	        // 从测试环境保护范围 reject → 释放锁
	        try {
	          if (shouldReleaseTestEnvLock(requirement.currentStep ?? '', targetStepName)) {
	            const currentLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
	            if (currentLock?.lockToken) {
	              await releaseTestEnvLock({
	                lockId: 'singleton',
	                lockToken: currentLock.lockToken,
	                acquiredForRequirement: currentLock.requirementId,
	              });
	            }
	          }
	        } catch (err) {
	          console.error(`[test-env-lock] reject lock release failed for ${params.id.slice(0, 8)}:`, err);
	        }

	        // 读取事务内最新 Requirement（获得 stateVersion）
	        const currentReq = await txReadRequirement(tx as any, params.id);

	        // 构建 update 数据
	        const updateData: Record<string, unknown> = {
	          currentStep: targetStepName,
	          assigneeId: newAssigneeId,
	          assignee: newAssigneeName,
	        };
	        if (requesterIdNeedsBackfill && effectiveRequesterId) {
	          updateData.requesterId = effectiveRequesterId;
	        }

	        // CAS 更新 + stateVersion 递增
	        const updatedReq = await casUpdateRequirement(
	          tx as any,
	          params.id,
	          currentReq.stateVersion ?? 0,
	          updateData,
	        );

	        // transition 原子写入
	        await txCreateTransition(tx as any, {
	          requirement: { connect: { id: params.id } },
	          fromStep: requirement.currentStep,
	          toStep: targetStepName,
	          action: 'reject',
	          actorId: req.user!.id,
	          actorName: req.user!.name,
	          actorRole: req.user!.internalRole ?? req.user!.role,
	          comment: body.comment,
	        } as Prisma.WorkflowTransitionCreateInput);

	        return updatedReq;
	      });

	      createFeedbackEvent({
        requirementId: params.id,
        fromStep: requirement.currentStep ?? '',
        toStep: targetStepName,
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        reason: body.comment,
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
