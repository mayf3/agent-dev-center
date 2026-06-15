/**
 * Workflow Assign & Lifecycle Routes
 *
 * 分配工作流 + 放弃/重新激活
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { assignWorkflowSchema } from '../../schemas/workflow.js';
import { parseSteps, getCurrentStep, logTransition, mapUserRole, extractRoleUserMap } from './workflow-helpers.js';
import { resolveAssigneeForStep } from '../../lib/assignee-resolver.js';

export function registerWorkflowAssignRoutes(router: import('express').Router): void {

  /**
   * POST /:id/workflow/assign — 分配工作流
   * 仅 admin/cto
   */
  router.post(
    '/:id/workflow/assign',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = assignWorkflowSchema.parse({ body: req.body });

      const requirement = await prisma.requirement.findUnique({ where: { id: params.id } });
      if (!requirement) throw new HttpError(404, '需求不存在');

      const template = await prisma.workflowTemplate.findFirst({
        where: { name: body.workflowName, isActive: true },
      });
      if (!template) throw new HttpError(404, `工作流模板「${body.workflowName}」不存在或已停用`);

      const steps = parseSteps(template.steps);
      if (steps.length === 0) throw new HttpError(400, '工作流模板无有效步骤');

      // 校验：禁止使用泛角色 'developer'（必须用 backend_developer 等具体角色）
      const genericDevSteps = steps.filter(s => s.role === 'developer');
      if (genericDevSteps.length > 0) {
        throw new HttpError(400, `工作流模板「${body.workflowName}」使用了已废弃的泛角色 'developer'（步骤：${genericDevSteps.map(s => s.name).join(', ')}），请改用具体角色模板如 backend-dev / frontend-dev`);
      }

      // 支持可选的 startStep 参数，用于迁移现有数据
      let targetStep;
      if (body.startStep) {
        targetStep = steps.find(s => s.name === body.startStep);
        if (!targetStep) {
          throw new HttpError(400, `工作流中不存在步骤「${body.startStep}」，可用步骤：${steps.map(s => s.name).join(', ')}`);
        }
      } else {
        // 默认第一步（2026-06-13：去掉 draft 自动跳过逻辑）
        targetStep = steps[0];
      }
      const updateData: any = {
        workflowId: template.id,
        currentStep: targetStep.name,
      };

      // draft 步骤：assignee 设为需求提出者（requester 需要提交草稿到 PM 审批）
      if (targetStep.name === 'draft' && requirement.requesterId) {
        updateData.assigneeId = requirement.requesterId;
      } else if (targetStep.role === 'requester' && requirement.requesterId) {
        // requester 角色步骤：assignee 设为需求提出者
        updateData.assigneeId = requirement.requesterId;
      } else {
        // 非 draft/requester 步骤：自动解析 assigneeId（使用 assignee-resolver）
        const roleUserMap = extractRoleUserMap(template.steps);
        try {
          const resolvedId = await resolveAssigneeForStep(
            targetStep.role,
            requirement.assigneeId,
            {
              assigneeMode: (targetStep as any).assigneeMode,
              roleUserMap,
              requirement: {
                id: requirement.id,
                requesterId: requirement.requesterId,
                assigneeId: requirement.assigneeId,
              },
            },
          );
          updateData.assigneeId = resolvedId;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new HttpError(400, `assignee 自动解析失败: ${msg}`);
        }
      }

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: updateData,
      });

      await logTransition({
        requirementId: params.id,
        fromStep: 'approved',
        toStep: targetStep.name,
        action: 'assign-workflow',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.role,
        metadata: { workflowName: template.name, templateId: template.id, startStep: body.startStep },
      });

      res.json({
        success: true,
        data: {
          requirementId: updated.id,
          workflowId: template.id,
          workflowName: template.name,
          workflowDisplayName: template.displayName,
          currentStep: targetStep.name,
          currentStepDisplayName: targetStep.displayName,
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
   * 被驳回的需求可以标记为放弃，不再出现在活跃列表
   * 权限：admin 或 requester（需求提出者）
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
   * 放弃的需求可以重新激活为草稿，修改后再提交
   * 权限：admin 或 requester
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
