/**
 * Workflow Engine Routes
 *
 * 基于模板的状态机：assign-workflow → advance → reject → myStep
 * 系统级强制约束：角色匹配 + 报告审批 + 审计日志
 */
import { z } from 'zod';
import { requireRoles } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import {
  assignWorkflowSchema,
  advanceStepSchema,
  rejectStepSchema,
} from '../../schemas/workflow.js';
import { canReadRequirement } from './utils.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';

// ── Types ────────────────────────────────────────────────

interface WorkflowStep {
  name: string;
  displayName: string;
  role: string;
  requiredReports: string[];
  autoAdvance: boolean;
  wipLimit?: number; // WIP 上限：该步骤同时处理的需求数量上限（undefined = 无限制）
}

// ── Helpers ──────────────────────────────────────────────

/** Map user internalRole to workflow step role */
function mapUserRole(internalRole: string | null | undefined, role: string): string | null {
  if (!internalRole) return null;
  const mapping: Record<string, string[]> = {
    cto: ['cto', 'admin'],
    admin: ['cto', 'admin'],
    backend_developer: ['backend_developer'],
    frontend_developer: ['frontend_developer'],
    mobile_developer: ['mobile_developer'],
    miniapp_developer: ['miniapp_developer'],
    game_developer: ['game_developer'],
    // developer: deprecated — 各具体角色用自己的名称
    tester: ['tester'],
    security: ['security'],
    ops: ['ops'],
    pm: ['pm', 'requester'],
    qa: ['qa'],
  };
  const allowed = mapping[internalRole] || [];
  return allowed.includes(role) ? role : null;
}

/** Parse steps from JSONB */
function parseSteps(stepsJson: unknown): WorkflowStep[] {
  const steps = z.array(z.object({
    name: z.string(),
    displayName: z.string(),
    role: z.string(),
    requiredReports: z.array(z.string()),
    autoAdvance: z.boolean().default(false),
    wipLimit: z.number().int().positive().optional(),
  })).parse(stepsJson);
  return steps;
}

/** Get current step definition from workflow */
function getCurrentStep(steps: WorkflowStep[], stepName: string): WorkflowStep | undefined {
  return steps.find(s => s.name === stepName);
}

/** Get next step (or null if at end) */
function getNextStep(steps: WorkflowStep[], currentStepName: string): WorkflowStep | null {
  const idx = steps.findIndex(s => s.name === currentStepName);
  if (idx === -1 || idx >= steps.length - 1) return null;
  return steps[idx + 1];
}

/** Get previous step (or null if at start) */
function getPreviousStep(steps: WorkflowStep[], currentStepName: string): WorkflowStep | null {
  const idx = steps.findIndex(s => s.name === currentStepName);
  if (idx <= 0) return null;
  return steps[idx - 1];
}

/** Check if all required reports are approved */
async function checkReportsApproved(requirementId: string, requiredReports: string[]): Promise<{ ok: boolean; missing: string[] }> {
  if (requiredReports.length === 0) return { ok: true, missing: [] };

  const approvedReports = await prisma.requirementReport.findMany({
    where: {
      requirementId,
      reportType: { in: requiredReports as any },
      status: 'approved',  // 2026-06-10: 只认 approved，pending 不算通过（防止报告提交=审批通过）
    },
    select: { reportType: true },
  });

  const approvedTypes = new Set(approvedReports.map(r => r.reportType));
  const missing = requiredReports.filter(t => !approvedTypes.has(t as any));

  return { ok: missing.length === 0, missing };
}

/** Check WIP limit for a step — returns current count of requirements sitting at that step */
async function getStepWipCount(stepName: string, excludeRequirementId?: string): Promise<number> {
  const where: any = { currentStep: stepName };
  if (excludeRequirementId) {
    where.id = { not: excludeRequirementId };
  }
  return prisma.requirement.count({ where });
}

/** Write audit transition log */
async function logTransition(params: {
  requirementId: string;
  fromStep: string;
  toStep: string;
  action: string;
  actorId: string | undefined;
  actorName: string;
  actorRole: string;
  comment?: string;
  metadata?: any;
}) {
  return prisma.workflowTransition.create({
    data: {
      requirementId: params.requirementId,
      fromStep: params.fromStep,
      toStep: params.toStep,
      action: params.action,
      actorId: params.actorId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      comment: params.comment,
      metadata: params.metadata ?? undefined,
    },
  });
}

// ── Route Registration ───────────────────────────────────

export function registerWorkflowRoutes(router: import('express').Router): void {

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

      // 支持可选的 startStep 参数，用于迁移现有数据
      let targetStep;
      if (body.startStep) {
        targetStep = steps.find(s => s.name === body.startStep);
        if (!targetStep) {
          throw new HttpError(400, `工作流中不存在步骤「${body.startStep}」，可用步骤：${steps.map(s => s.name).join(', ')}`);
        }
      } else {
        targetStep = steps[0];
      }
      const updateData: any = {
        workflowId: template.id,
        currentStep: targetStep.name,
      };

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
   * POST /:id/workflow/advance — 推进到下一步
   * 只有当前步骤对应角色才能操作
   */
  router.post(
    '/:id/workflow/advance',
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { body } = advanceStepSchema.parse({ body: req.body });

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

      // 角色校验（系统级强制约束）
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      if (!matchedRole && req.user!.role !== 'admin' && req.user!.role !== 'cto_agent') {
        throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
      }

      // 当前步骤的报告校验（离开当前步骤也需要通过该步骤要求的报告）
      // 2026-06-10：非 SECURITY 类型需求过滤掉 SECURITY_REVIEW（因为安全步骤被跳过了）
      const reqType = (requirement as any).type;
      const isNonSecurityType = reqType !== 'SECURITY';
      const currentReports = (isNonSecurityType)
        ? currentStep.requiredReports.filter(r => r !== 'SECURITY_REVIEW')
        : currentStep.requiredReports;
      if (currentReports.length > 0) {
        const { ok, missing } = await checkReportsApproved(params.id, currentReports);
        if (!ok) {
          const reportLabels: Record<string, string> = {
            DEV_SELF_CHECK: '开发自检报告',
            MERGE_REPORT: '合并报告',
            TEST_REPORT: '测试报告',
            SECURITY_REVIEW: '安全检查报告',
            CTO_REVIEW: 'CTO验收报告',
            DEPLOY_CONFIRM: '部署确认报告',
          };
          const labels = missing.map(t => reportLabels[t] ?? t).join('、');
          throw new HttpError(400, `推进失败：当前步骤缺少已通过的报告 — ${labels}`);
        }
      }

      // 7d7620e9: merge_to_main 步骤的自动验证
      if (currentStep.name === 'merge_to_main') {
        const req = await prisma.requirement.findUnique({
          where: { id: params.id },
          select: { gitHash: true, branch: true, repoPath: true },
        });
        const errors: string[] = [];
        if (!req?.gitHash) errors.push('缺少 gitHash，请先提交代码并更新 gitHash');
        if (!req?.branch) errors.push('缺少 branch，请指定代码分支名');
        if (errors.length > 0) {
          throw new HttpError(400, `merge_to_main 验证失败：\n${errors.join('\n')}`);
        }
      }

      // 找下一步
      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;

      // 如果下一步是 auto，自动再推进一步
      if (nextStep.autoAdvance) {
        const afterNext = getNextStep(steps, nextStep.name);
        if (afterNext) {
          targetStep = afterNext;
        }
      }

      // 2026-06-10 v3: 按需求 type 跳过 security_review + qa_review_security
      // FEATURE/BUGFIX/INFRA/POSTMORTEM 类型不需要安全审查，跳过两个步骤
      // 只有 SECURITY 类型才走安全审查
      let securitySkipped = false;
      const skippedSteps: string[] = [];
      if (targetStep.name === 'security_review') {
        const reqType = (requirement as any).type;
        const securityTypes = ['SECURITY'];
        if (!securityTypes.includes(reqType)) {
          // 跳过 security_review
          skippedSteps.push(targetStep.name);
          let afterSkip = getNextStep(steps, targetStep.name);
          // v3: 同时跳过 qa_review_security（如果紧随其后）
          if (afterSkip && afterSkip.name === 'qa_review_security') {
            skippedSteps.push(afterSkip.name);
            afterSkip = getNextStep(steps, afterSkip.name);
          }
          if (afterSkip) {
            targetStep = afterSkip;
            securitySkipped = true;
          }
        }
      }

      // WIP 上限检查：如果目标步骤设置了 wipLimit，检查当前该步骤的 WIP 数量
      if (targetStep.wipLimit && targetStep.wipLimit > 0) {
        const currentWip = await getStepWipCount(targetStep.name, params.id);
        if (currentWip >= targetStep.wipLimit) {
          throw new HttpError(409, `步骤「${targetStep.displayName}」WIP 已达上限（${currentWip}/${targetStep.wipLimit}），请等待现有任务完成后重试`);
        }
      }

      // ── 测试环境锁（mutex）：同时只有一个需求占用测试环境 ──
      // 进入 test_env_deploy 时加锁，进入 deploying 时释放
      let lockReleased = false;
      if (targetStep.name === 'test_env_deploy') {
        const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
        if (existingLock && existingLock.requirementId !== params.id) {
          throw new HttpError(
            409,
            `测试环境已被占用：需求「${existingLock.requirementTitle || existingLock.requirementId}」（锁定于 ${existingLock.acquiredAt.toISOString().replace('T', ' ').slice(0, 16)}），请等待其部署完成后重试`,
          );
        }
        // 加锁
        await prisma.testEnvLock.upsert({
          where: { id: 'singleton' },
          create: { id: 'singleton', requirementId: params.id, requirementTitle: requirement.title, branch: requirement.branch },
          update: { requirementId: params.id, requirementTitle: requirement.title, branch: requirement.branch, acquiredAt: new Date() },
        });
      }
      // 离开 deploying（正式部署）时释放锁，并自动推进队列中下一条
      if (currentStep.name === 'deploying') {
        const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
        if (existingLock) {
          await prisma.testEnvLock.delete({ where: { id: 'singleton' } });
          lockReleased = true;
        }
      }

      // 自动解析下一步骤的 assigneeId
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
        metadata: { skippedAutoStep: targetStep.name !== nextStep.name ? nextStep.name : null },
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
          isDone: targetStep.name === steps[steps.length - 1]?.name,
        },
      });

      // ── 锁释放后：自动推进队列中下一条等待 test_env_deploy 的需求 ──
      // 异步执行，不阻塞当前响应
      if (lockReleased) {
        void (async () => {
          try {
            // 找最早进入 test_env_deploy 的需求（FIFO）
            const next = await prisma.requirement.findFirst({
              where: { currentStep: 'test_env_deploy' },
              orderBy: { updatedAt: 'asc' },
            });
            if (!next) return;
            // 验证它的工作流包含 test_env_deploy
            const wf = next.workflowId
              ? await prisma.workflowTemplate.findUnique({ where: { id: next.workflowId } })
              : null;
            if (!wf) return;
            const wfSteps = (wf.steps as any[]) || [];
            const hasStep = wfSteps.some((s: any) => s.name === 'test_env_deploy');
            if (!hasStep) return;
            // 加锁给下一条
            await prisma.testEnvLock.upsert({
              where: { id: 'singleton' },
              create: { id: 'singleton', requirementId: next.id, requirementTitle: next.title, branch: next.branch },
              update: { requirementId: next.id, requirementTitle: next.title, branch: next.branch, acquiredAt: new Date() },
            });
            console.log(`[test-env-lock] 🔓 锁已释放，自动分配给下一个需求: ${next.id.slice(0, 8)} (${next.title?.slice(0, 30)})`);
          } catch (err) {
            console.error('[test-env-lock] 自动推进失败:', err);
          }
        })();
      }
    }),
  );

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

      // 角色校验
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      if (!matchedRole && req.user!.role !== 'admin' && req.user!.role !== 'cto_agent') {
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
        // 默认：回退一步
        const prevStep = getPreviousStep(steps, requirement.currentStep);
        targetStepName = prevStep ? prevStep.name : steps[0]?.name ?? 'dev_self_check';
        targetStepDef = prevStep ?? steps[0];
      }

      // 自动解析回退步骤的 assigneeId
      const newAssigneeId = targetStepDef
        ? await resolveAssigneeForStep(targetStepDef.role, requirement.assigneeId)
        : requirement.assigneeId;

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
}
