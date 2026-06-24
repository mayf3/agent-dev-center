/**
 * Workflow Assign & Lifecycle Routes
 *
 * 分配工作流 + 放弃/重新激活
 *
 * Kernel Phase 2A: assign 使用原子 snapshot 服务。
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { assignWorkflowSchema } from '../../schemas/workflow.js';
import { logTransition, getWorkflowSteps } from './workflow-helpers.js';
import { assignWorkflowAtomic } from './workflow-assign-service.js';

export function registerWorkflowAssignRoutes(router: import('express').Router): void {

  /**
   * POST /:id/workflow/assign — 原子分配工作流
   * 仅 admin/cto
   *
   * Kernel Phase 2A:
   *  - 使用 assignWorkflowAtomic 在同一事务中写入
   *    workflowId + workflowSnapshot + currentStep + assigneeId + stateVersion
   *  - snapshot 是不可变深拷贝
   *  - CAS 保证并发安全
   */
  router.post(
    '/:id/workflow/assign',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = assignWorkflowSchema.parse({ body: req.body });

      // 原子分配
      const result = await assignWorkflowAtomic(params.id, body.workflowName, body.startStep);

      // 校验通用角色 'developer'（在 snapshot 上检查）
      const steps = getWorkflowSteps(result.workflowSnapshot);
      const genericDevSteps = steps.filter(s => s.role === 'developer');
      if (genericDevSteps.length > 0) {
        throw new HttpError(400, `工作流模板「${body.workflowName}」使用了已废弃的泛角色 'developer'（步骤：${genericDevSteps.map(s => s.name).join(', ')}），请改用具体角色模板如 backend-dev / frontend-dev`);
      }

      const currentStepDef = steps.find(s => s.name === result.currentStep);

      await logTransition({
        requirementId: result.requirementId,
        fromStep: 'approved',
        toStep: result.currentStep,
        action: 'assign-workflow',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        metadata: { workflowName: body.workflowName, templateId: result.workflowId, startStep: body.startStep },
      });

      res.json({
        success: true,
        data: {
          requirementId: result.requirementId,
          workflowId: result.workflowId,
          workflowName: body.workflowName,
          currentStep: result.currentStep,
          currentStepDisplayName: currentStepDef?.displayName ?? result.currentStep,
          stateVersion: result.stateVersion,
          steps: steps.map(s => ({
            name: s.name,
            displayName: s.displayName,
            role: s.role,
            requiredReports: s.requiredReports,
          })),
        },
      });
    }),
  );

  /**
   * POST /:id/workflow/abandon — 放弃需求（rejected → abandoned）
   */
  router.post(
    '/:id/workflow/abandon',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { id: true, currentStep: true, requesterId: true, assigneeId: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');

      const user = req.user!;
      const isOwner = requirement.requesterId === user.id;
      const isAssignee = requirement.assigneeId === user.id;
      const isAdmin = user.role === 'admin' || user.role === 'cto_agent';
      if (!isOwner && !isAssignee && !isAdmin) {
        throw new HttpError(403, '只有需求提出者、当前执行人或管理员可以放弃需求');
      }

      const abandonableSteps = ['rejected', 'draft', 'pm_review', 'dev_self_check', 'qa_review', 'testing'];
      if (!abandonableSteps.includes(requirement.currentStep ?? '')) {
        throw new HttpError(400, `当前步骤「${requirement.currentStep}」不允许放弃，只能放弃处于 ${abandonableSteps.join('/')} 的需求`);
      }

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: {
          currentStep: 'abandoned',
          assigneeId: null,
        },
      });

      await logTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep ?? '',
        toStep: 'abandoned',
        action: 'abandon',
        actorId: user.id,
        actorName: user.name,
        actorRole: user.internalRole ?? user.role,
        comment: req.body?.comment,
      });

      res.json({
        success: true,
        data: {
          requirementId: updated.id,
          fromStep: requirement.currentStep,
          toStep: 'abandoned',
        },
      });
    }),
  );

  /**
   * POST /:id/workflow/to-draft — 重新激活需求（abandoned → draft）
   */
  router.post(
    '/:id/workflow/to-draft',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });

      const requirement = await prisma.requirement.findUnique({
        where: { id: params.id },
        select: { id: true, currentStep: true, requesterId: true, assigneeId: true },
      });
      if (!requirement) throw new HttpError(404, '需求不存在');
      if (requirement.currentStep !== 'abandoned') {
        throw new HttpError(400, '只有 abandoned 状态的需求可以重新激活为草稿');
      }

      const user = req.user!;
      const isOwner = requirement.requesterId === user.id;
      const isAssignee = requirement.assigneeId === user.id;
      const isAdmin = user.role === 'admin' || user.role === 'cto_agent';
      if (!isOwner && !isAssignee && !isAdmin) {
        throw new HttpError(403, '只有需求提出者、当前执行人或管理员可以重新激活需求');
      }

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: {
          currentStep: 'draft',
          assigneeId: null,
        },
      });

      await logTransition({
        requirementId: params.id,
        fromStep: 'abandoned',
        toStep: 'draft',
        action: 'reactivate',
        actorId: user.id,
        actorName: user.name,
        actorRole: user.internalRole ?? user.role,
        comment: req.body?.comment,
      });

      res.json({
        success: true,
        data: {
          requirementId: updated.id,
          fromStep: 'abandoned',
          toStep: 'draft',
        },
      });
    }),
  );
}
