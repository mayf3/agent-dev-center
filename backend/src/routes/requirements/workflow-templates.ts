/**
 * Workflow Template Management Routes
 *
 * 模板列表、激活、WIP 管理、测试环境锁状态
 */
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { parseSteps } from './workflow-helpers.js';

export function registerWorkflowTemplateRoutes(router: import('express').Router): void {

  /**
   * GET /workflow/test-env-lock — 查看测试环境锁状态
   */
  router.get(
    '/workflow/test-env-lock',
    asyncHandler(async (_req, res) => {
      const lock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
      // 统计等待队列
      const queueCount = await prisma.requirement.count({
        where: { currentStep: 'test_env_deploy' },
      });
      res.json({
        locked: !!lock,
        lock: lock ? {
          requirementId: lock.requirementId,
          requirementTitle: lock.requirementTitle,
          branch: lock.branch,
          acquiredAt: lock.acquiredAt,
        } : null,
        queueLength: queueCount,
      });
    }),
  );

  /**
   * DELETE /workflow/test-env-lock — 强制释放测试环境锁（仅 admin/cto）
   * 用于：锁持有者已过 testing 阶段但卡在后续步骤（如 qa_review），导致死锁
   */
  router.delete(
    '/workflow/test-env-lock',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const lock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
      if (!lock) {
        res.json({ success: true, message: '锁不存在，无需释放' });
        return;
      }
      await prisma.testEnvLock.delete({ where: { id: 'singleton' } });
      console.log(`[test-env-lock] 🔓 管理员 ${req.user?.name} 强制释放了锁（原持有者: ${lock.requirementId?.slice(0, 8)} ${lock.requirementTitle?.slice(0, 30)})`);
      res.json({
        success: true,
        message: '测试环境锁已强制释放',
        releasedFrom: {
          requirementId: lock.requirementId,
          requirementTitle: lock.requirementTitle,
          acquiredAt: lock.acquiredAt,
        },
      });
    }),
  );

  /**
   * GET /workflow-templates — 列出所有工作流模板
   * 任何已登录用户可查看（方便前端展示和 CTO 分配）
   * 2026-06-04: 修改为返回所有模板（包括非活跃），以便诊断和修复
   */
  router.get(
    '/workflow-templates',
    asyncHandler(async (_req, res) => {
      const templates = await prisma.workflowTemplate.findMany({
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
          isActive: true,
          steps: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      res.json({
        success: true,
        data: templates.map(t => ({
          id: t.id,
          name: t.name,
          displayName: t.displayName,
          description: t.description,
          isActive: t.isActive,
          stepCount: (t.steps as any[]).length,
          steps: t.steps,
        })),
      });
    }),
  );

  /**
   * PATCH /workflow-templates/:id/activate — 激活指定工作流模板（admin only）
   * 2026-06-04: 用于修复无活跃模板的问题。同一时间只能有一个活跃模板。
   */
  router.patch(
    '/workflow-templates/:id/activate',
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;

      // Admin check
      if (req.user!.role !== 'admin' && req.user!.internalRole !== 'cto') {
        throw new HttpError(403, '需要管理员权限');
      }

      // Deactivate all templates
      await prisma.workflowTemplate.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      // Activate the specified template
      const template = await prisma.workflowTemplate.findUnique({
        where: { id },
      });
      if (!template) throw new HttpError(404, '模板不存在');

      const updated = await prisma.workflowTemplate.update({
        where: { id },
        data: { isActive: true },
      });

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_TEMPLATE_ACTIVATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: id,
          targetType: 'WorkflowTemplate',
          details: { templateName: updated.name, displayName: updated.displayName } as any,
        },
      });

      res.json({
        success: true,
        data: { id: updated.id, name: updated.name, displayName: updated.displayName, isActive: updated.isActive },
      });
    }),
  );

  /**
   * GET /workflow/wip-status — 查询各步骤 WIP 状态
   * 返回所有工作流模板中设置了 wipLimit 的步骤，以及当前排队数量
   */
  router.get(
    '/workflow/wip-status',
    asyncHandler(async (_req, res) => {
      const templates = await prisma.workflowTemplate.findMany({
        where: { isActive: true },
        select: { id: true, name: true, displayName: true, steps: true },
      });

      const result: Array<{
        templateId: string;
        templateName: string;
        templateDisplayName: string;
        steps: Array<{
          stepName: string;
          stepDisplayName: string;
          wipLimit: number;
          currentCount: number;
          isOverLimit: boolean;
          requirements: Array<{ id: string; title: string; priority: string }>;
        }>;
      }> = [];

      for (const template of templates) {
        const steps = parseSteps(template.steps);
        const wipSteps = steps.filter(s => s.wipLimit && s.wipLimit > 0);

        if (wipSteps.length === 0) continue;

        const stepStats = [];
        for (const step of wipSteps) {
          const requirements = await prisma.requirement.findMany({
            where: { currentStep: step.name },
            select: { id: true, title: true, priority: true },
            orderBy: { createdAt: 'asc' },
          });

          stepStats.push({
            stepName: step.name,
            stepDisplayName: step.displayName,
            wipLimit: step.wipLimit!,
            currentCount: requirements.length,
            isOverLimit: requirements.length >= step.wipLimit!,
            requirements: requirements.map(r => ({
              id: r.id,
              title: r.title,
              priority: r.priority,
            })),
          });
        }

        result.push({
          templateId: template.id,
          templateName: template.name,
          templateDisplayName: template.displayName,
          steps: stepStats,
        });
      }

      res.json({ success: true, data: result });
    }),
  );

  /**
   * PATCH /workflow-templates/:id/step-wip — 更新工作流步骤的 WIP 上限
   * admin/cto only
   * body: { stepName: string, wipLimit: number | null }
   */
  router.patch(
    '/workflow-templates/:id/step-wip',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const templateId = req.params.id as string;
      const { stepName, wipLimit } = req.body as { stepName?: string; wipLimit?: number | null };

      if (!stepName || typeof stepName !== 'string') {
        throw new HttpError(400, 'stepName 必填');
      }
      if (wipLimit !== null && wipLimit !== undefined && (!Number.isInteger(wipLimit) || wipLimit < 1)) {
        throw new HttpError(400, 'wipLimit 必须为正整数或 null（移除限制）');
      }

      const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new HttpError(404, '模板不存在');

      const steps = parseSteps(template.steps);
      const targetStep = steps.find(s => s.name === stepName);
      if (!targetStep) {
        throw new HttpError(400, `步骤「${stepName}」不存在，可用步骤：${steps.map(s => s.name).join(', ')}`);
      }

      // Update the step's wipLimit
      const updatedSteps = steps.map(s => {
        if (s.name === stepName) {
          return { ...s, wipLimit: wipLimit ?? undefined };
        }
        return s;
      });

      await prisma.workflowTemplate.update({
        where: { id: templateId },
        data: { steps: updatedSteps as any },
      });

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_STEP_WIP_UPDATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: templateId,
          targetType: 'WorkflowTemplate',
          details: { stepName, wipLimit, templateName: template.name } as any,
        },
      });

      res.json({
        success: true,
        data: {
          templateId,
          stepName,
          wipLimit: wipLimit ?? null,
          previousWipLimit: targetStep.wipLimit ?? null,
        },
      });
    }),
  );

  /**
   * PATCH /workflow-templates/:id/step-mode — 更新工作流步骤的 assigneeMode
   * admin/cto only
   * body: { stepName: string, assigneeMode: 'role-based' | 'creator' | 'fixed' }
   */
  router.patch(
    '/workflow-templates/:id/step-mode',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const templateId = req.params.id as string;
      const { stepName, assigneeMode } = req.body as { stepName?: string; assigneeMode?: string };

      if (!stepName || typeof stepName !== 'string') {
        throw new HttpError(400, 'stepName 必填');
      }
      if (!assigneeMode || !['role-based', 'creator', 'fixed'].includes(assigneeMode)) {
        throw new HttpError(400, 'assigneeMode 必须为 role-based / creator / fixed 之一');
      }

      const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new HttpError(404, '模板不存在');

      const steps = parseSteps(template.steps);
      const targetStep = steps.find(s => s.name === stepName);
      if (!targetStep) {
        throw new HttpError(400, `步骤「${stepName}」不存在，可用步骤：${steps.map(s => s.name).join(', ')}`);
      }

      // Update the step's assigneeMode
      const updatedSteps = steps.map(s => {
        if (s.name === stepName) {
          return { ...s, assigneeMode };
        }
        return s;
      });

      // Preserve roleUserMap in steps JSON
      const stepsData = { ...template.steps as any };
      // Merge updated steps array
      if (Array.isArray(stepsData)) {
        // roleUserMap is stored alongside the steps array in the JSON
        await prisma.workflowTemplate.update({
          where: { id: templateId },
          data: { steps: updatedSteps as any },
        });
      } else {
        // Complex JSON with roleUserMap at top level
        await prisma.workflowTemplate.update({
          where: { id: templateId },
          data: { steps: { ...stepsData, steps: updatedSteps } as any },
        });
      }

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_STEP_MODE_UPDATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: templateId,
          targetType: 'WorkflowTemplate',
          details: { stepName, assigneeMode, templateName: template.name } as any,
        },
      });

      res.json({
        success: true,
        data: {
          templateId,
          stepName,
          assigneeMode,
        },
      });
    }),
  );

  /**
   * PATCH /workflow-templates/:id/role-map — 更新工作流模板的 roleUserMap
   * admin/cto only
   * body: { roleUserMap: Record<string, string> } — role → userId 映射
   */
  router.patch(
    '/workflow-templates/:id/role-map',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const templateId = req.params.id as string;
      const { roleUserMap } = req.body as { roleUserMap?: Record<string, string> };

      if (!roleUserMap || typeof roleUserMap !== 'object' || Object.keys(roleUserMap).length === 0) {
        throw new HttpError(400, 'roleUserMap 必须为非空对象');
      }

      const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId } });
      if (!template) throw new HttpError(404, '模板不存在');

      // 从模板中获取当前 steps 数据
      const currentSteps = parseSteps(template.steps);

      // 将 roleUserMap 作为 steps JSON 的顶层字段（与 steps 数组并列存储）
      // Prisma 以 JSON 类型存储 steps，我们需要保留 steps 数组 + 添加 roleUserMap
      const updated = await prisma.workflowTemplate.update({
        where: { id: templateId },
        data: {
          steps: {
            steps: currentSteps,
            roleUserMap,
          } as any,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_TEMPLATE_ROLE_MAP_UPDATED',
          actorId: req.user!.id,
          actorName: req.user!.name,
          targetId: templateId,
          targetType: 'WorkflowTemplate',
          details: {
            templateName: template.name,
            roleUserMap,
          } as any,
        },
      });

      res.json({
        success: true,
        data: {
          templateId,
          roleUserMap,
        },
      });
    }),
  );
}
