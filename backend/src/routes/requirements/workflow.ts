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
}

// ── Helpers ──────────────────────────────────────────────

/** Map user internalRole to workflow step role */
function mapUserRole(internalRole: string | null | undefined, role: string): string | null {
  if (!internalRole) return null;
  const mapping: Record<string, string[]> = {
    cto: ['cto', 'admin'],
    admin: ['cto', 'admin'],
    developer: ['developer'],
    tester: ['tester'],
    security: ['security'],
    ops: ['ops'],
    pm: ['pm', 'requester'],
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
/** 检查需求是否有指定类型的报告（已提交/已通过），按 mode 区分：
 * - 'submitted': 报告存在即可（pending 或 approved，排除 rejected）
 * - 'approved':  报告必须已通过（status=approved）
 */
async function checkReports(requirementId: string, requiredReports: string[], mode: 'submitted' | 'approved' = 'approved'): Promise<{ ok: boolean; missing: string[] }> {
  if (requiredReports.length === 0) return { ok: true, missing: [] };

  const statusFilter = mode === 'approved' ? 'approved' : undefined;

  const existingReports = await prisma.requirementReport.findMany({
    where: {
      requirementId,
      reportType: { in: requiredReports as any },
      ...(statusFilter ? { status: statusFilter as any } : { status: { not: 'rejected' as any } }),
    },
    select: { reportType: true },
  });

  const existingTypes = new Set(existingReports.map(r => r.reportType));
  const missing = requiredReports.filter(t => !existingTypes.has(t as any));

  return { ok: missing.length === 0, missing };
}

/** 兼容旧名称 */
const checkReportsApproved = (id: string, reports: string[]) => checkReports(id, reports, 'approved');

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

      // 找下一步
      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;

      // 连续跳过 autoAdvance 步骤：如果下一步标记为 autoAdvance，
      // 继续往下找直到遇到需要人工操作的步骤
      while (targetStep.autoAdvance) {
        const afterNext = getNextStep(steps, targetStep.name);
        if (afterNext) {
          targetStep = afterNext;
        } else {
          break;
        }
      }

      // 2026-06-04 铁律 #24 实现：按需求 type 跳过 security_review
      // FEATURE/BUGFIX/INFRA/POSTMORTEM 类型不需要安全审查，直接跳过
      // 只有 SECURITY 和安全相关需求才走安全审查
      //
      // 2026-06-06 修复：跳过步骤 ≠ 跳过报告检查
      // 跳过 security_review 时，仍然需要检查 security_review.requiredReports（TEST_REPORT）
      // 只是不需要 SECURITY_REVIEW 报告（因为安全工程师没参与）
      let skippedSecurityReports: string[] = [];
      if (targetStep.name === 'security_review') {
        const reqType = (requirement as any).type;
        const securityTypes = ['SECURITY'];
        if (!securityTypes.includes(reqType)) {
          // 记录被跳过步骤的 requiredReports（这些仍需检查）
          skippedSecurityReports = targetStep.requiredReports;
          // 跳过 security_review，直接到下一步
          const afterSecurity = getNextStep(steps, targetStep.name);
          if (afterSecurity) {
            targetStep = afterSecurity;
          }
        }
      }

      // 报告校验
      // 2026-06-06 修复：检查目标步骤的 requiredReports，而非当前步骤的
      // 2026-06-06 修复3：跳过 security_review 步骤但保留 TEST_REPORT 检查
      // 2026-06-06 修复4：部署确认报告（TEST_DEPLOY_CONFIRM/DEPLOY_CONFIRM）只需 submitted 模式
      //   — Ops 自确认部署完成即可推进，不需要 CTO 审批
      //   — CTO 审批在 cto_review/deploying 阶段统一进行
      let targetRequiredReports = [...skippedSecurityReports, ...targetStep.requiredReports];
      targetRequiredReports = targetRequiredReports.filter(r => r !== 'SECURITY_REVIEW');
      // 部署确认报告只需提交就可，不需要审批
      const deployReports = ['TEST_DEPLOY_CONFIRM', 'DEPLOY_CONFIRM'];
      const needsApproval = targetRequiredReports.filter(r => !deployReports.includes(r));
      const needsSubmitted = targetRequiredReports.filter(r => deployReports.includes(r));
      const { ok: okApproved, missing: missingApproved } = await checkReports(params.id, needsApproval, 'approved');
      const { ok: okSubmitted, missing: missingSubmitted } = await checkReports(params.id, needsSubmitted, 'submitted');
      const ok = okApproved && okSubmitted;
      const missing = [...missingApproved, ...missingSubmitted];
      if (!ok) {
        const reportLabels: Record<string, string> = {
          DEV_SELF_CHECK: '开发自检报告',
          TEST_REPORT: '测试报告',
          SECURITY_REVIEW: '安全检查报告',
          CTO_REVIEW: 'CTO验收报告',
          TEST_DEPLOY_CONFIRM: '测试部署确认报告',
          DEPLOY_CONFIRM: '部署确认报告',
        };
        const labels = missing.map(t => reportLabels[t] ?? t).join('、');
        throw new HttpError(400, `推进失败：缺少已通过的报告 — ${labels}`);
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
          actorName: req.user!.name || req.user!.email,
          targetId: id,
          targetType: 'WorkflowTemplate',
          details: { templateName: updated.name, displayName: updated.displayName },
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
}
