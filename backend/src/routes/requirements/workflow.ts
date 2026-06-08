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
    qa: ['qa'],
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
      // 2026-06-08 铁律：禁止跳过 pm_review。startStep 只能用于回退到合法步骤（需求已有工作流且被 reject 回退时）
      let targetStep;
      if (body.startStep) {
        // 如果需求从未有过工作流（新需求），禁止用 startStep 跳过第一步
        if (!requirement.workflowId) {
          throw new HttpError(400, `新需求必须从工作流第一步开始（pm_review），不允许用 startStep 跳过。`);
        }
        targetStep = steps.find(s => s.name === body.startStep);
        if (!targetStep) {
          throw new HttpError(400, `工作流中不存在步骤「${body.startStep}」，可用步骤：${steps.map(s => s.name).join(', ')}`);
        }
        // 禁止用 startStep 跳到 done 或跳过 pm_review
        if (targetStep.name === 'done') {
          throw new HttpError(400, `禁止通过 startStep 直接跳到 done（违反铁律 #28）`);
        }
      } else {
        targetStep = steps[0];
      }
      const updateData: any = {
        workflowId: template.id,
        currentStep: targetStep.name,
      };

      // 自动解析目标步骤的 assignee（修复：assign-workflow 不设置 assignee 的 bug）
      const resolvedAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);
      if (resolvedAssigneeId) {
        updateData.assigneeId = resolvedAssigneeId;
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
      // 35c9cea2: 移除 admin/cto 豁免，所有用户只能 advance 自己角色对应的步骤
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      if (!matchedRole) {
        throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
      }

      // 0e0ea5f8: advance 时强制校验 gitHash 非空（无代码不推进）
      if (!requirement.gitHash) {
        throw new HttpError(400, '推进失败：需求未设置 gitHash，请先更新代码提交哈希');
      }

      // 找下一步
      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;

      // 2026-06-06 连续跳过 autoAdvance 步骤
      // 仅当当前步骤本身是 autoAdvance 时才跳过（如开发者提交报告后自动跳 QA 审查）
      // 如果是从上一步推进来的（如 PM 评审 → 开发自检），停在 dev_self_check 不跳过
      // 否则 dev_self_check 被跳过 → 开发者没机会提交 DEV_SELF_CHECK → 报告检查死锁
      if (currentStep.autoAdvance) {
        while (targetStep.autoAdvance) {
          const afterNext = getNextStep(steps, targetStep.name);
          if (afterNext) {
            targetStep = afterNext;
          } else {
            break;
          }
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

      // 67b50767: 部署队列锁 — advance 到 test_env_deploy 时检查同 repoPath 是否已有需求在部署
      if (targetStep.name === 'test_env_deploy') {
        const reqRepoPath = (requirement as any).repoPath;
        if (reqRepoPath) {
          const conflicting = await prisma.requirement.findFirst({
            where: {
              id: { not: params.id },
              repoPath: reqRepoPath,
              currentStep: { in: ['test_env_deploy', 'deploying'] },
            },
            select: { id: true, title: true, currentStep: true },
          });
          if (conflicting) {
            throw new HttpError(409, `部署队列锁：代码路径「${reqRepoPath}」已有需求「${conflicting.title}」(${conflicting.id.slice(0, 8)}) 处于 ${conflicting.currentStep} 状态，请等待其完成后再推进`);
          }
        }
        // repoPath 为空时跳过锁检查（向后兼容）
      }

      // 报告校验
      // 2026-06-06 修复：检查目标步骤的 requiredReports，而非当前步骤的
      // 2026-06-06 修复3：跳过 security_review 步骤但保留 TEST_REPORT 检查
      // 2026-06-06 修复4：部署确认报告（TEST_DEPLOY_CONFIRM/DEPLOY_CONFIRM）只需 submitted 模式
      //   — Ops 自确认部署完成即可推进，不需要 CTO 审批
      //   — CTO 审批在 cto_review/deploying 阶段统一进行
      // 2026-06-06 修复5：autoAdvance 时目标步骤的报告用 submitted 模式
      //   — 例如开发者提交 DEV_SELF_CHECK 后 autoAdvance 到 qa_review
      //   — DEV_SELF_CHECK 刚提交是 pending，QA 会在 qa_review 阶段审批
      //   — 如果要求 approved，autoAdvance 永远卡住
      let targetRequiredReports = [...skippedSecurityReports, ...targetStep.requiredReports];
      targetRequiredReports = targetRequiredReports.filter(r => r !== 'SECURITY_REVIEW');
      // 部署确认报告和 CTO 自审报告只需提交就可，不需要审批
      const autoSubmittedReports = ['TEST_DEPLOY_CONFIRM', 'DEPLOY_CONFIRM', 'CTO_REVIEW'];
      // autoAdvance 时，目标步骤的报告也只需 submitted（提交即过，等接手的人来审批）
      // 跳过 security 时的 TEST_REPORT 也只需 submitted（CTO 在 cto_review 统一审）
      const submittedReports = [
        ...autoSubmittedReports,
        ...(currentStep.autoAdvance ? targetRequiredReports : []),
        ...skippedSecurityReports,
      ];
      const needsApproval = targetRequiredReports.filter(r => !submittedReports.includes(r));
      const needsSubmitted = targetRequiredReports.filter(r => submittedReports.includes(r));
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
      // 35c9cea2: 移除 admin/cto 豁免
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      if (!matchedRole) {
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
   * POST /:id/workflow/force-advance — 管理员强制推进（35c9cea2）
   * 仅 admin/cto，需要 force=true + reason 参数
   * 所有操作记录审计日志
   */
  router.post(
    '/:id/workflow/force-advance',
    requireRoles('admin', 'cto_agent'),
    asyncHandler(async (req, res) => {
      const { params } = requirementIdSchema.parse({ params: req.params });
      const { force, reason } = z.object({
        force: z.literal(true),
        reason: z.string().trim().min(5, '必须提供强制推进原因（至少5字）'),
      }).parse(req.body);

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

      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;

      // 跳过 autoAdvance
      if (currentStep.autoAdvance) {
        while (targetStep.autoAdvance) {
          const afterNext = getNextStep(steps, targetStep.name);
          if (afterNext) { targetStep = afterNext; } else { break; }
        }
      }

      // 跳过 security_review（同 advance 逻辑）
      if (targetStep.name === 'security_review') {
        const reqType = (requirement as any).type;
        if (reqType !== 'SECURITY') {
          const afterSecurity = getNextStep(steps, targetStep.name);
          if (afterSecurity) { targetStep = afterSecurity; }
        }
      }

      const newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);
      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: { currentStep: targetStep.name, assigneeId: newAssigneeId },
      });
      const newAssigneeName = await getAssigneeName(newAssigneeId);

      // 审计日志：强制推进必须记录
      await logTransition({
        requirementId: params.id,
        fromStep: requirement.currentStep,
        toStep: targetStep.name,
        action: 'force-advance',
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role,
        comment: `[FORCE] ${reason}`,
        metadata: { force: true, reason, skippedRole: currentStep.role },
      });

      // 额外审计日志到 AuditLog 表
      await prisma.auditLog.create({
        data: {
          action: 'WORKFLOW_FORCE_ADVANCE',
          actorId: req.user!.id,
          actorName: req.user!.name || req.user!.email,
          targetId: params.id,
          targetType: 'Requirement',
          details: { fromStep: requirement.currentStep, toStep: targetStep.name, reason },
        },
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
          forced: true,
          reason,
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

      // 检查当前用户是否可以操作（35c9cea2: admin/cto 不能代操作）
      const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
      const canOperate = !!matchedRole;

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
