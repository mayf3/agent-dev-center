/**
 * Workflow Advance Route
 *
 * POST /:id/workflow/advance — advance to next workflow step.
 * Most complex route: role check + report check + security skip + WIP limit + test-env lock.
 */
import { prisma } from '../../lib/prisma.js';
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
  logTransition,
  extractRoleUserMap,
} from './workflow-helpers.js';
import {
  skipSecurityIfApplicable,
  acquireTestEnvLock,
  releaseTestEnvLock,
  shouldReleaseTestEnvLock,
  autoAdvanceTestEnvQueue,
} from './workflow-advance-helpers.js';

export function registerWorkflowAdvanceRoutes(router: import('express').Router): void {

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

      const steps = getWorkflowSteps(requirement);
      const currentStep = getCurrentStep(steps, requirement.currentStep);
      if (!currentStep) throw new HttpError(400, `当前步骤「${requirement.currentStep}」在工作流中不存在`);

      // --- Permission check ---
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

      // --- Report check ---
      const reqType = (requirement as any).type;
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

      // ── DEV_SELF_CHECK 报告质量门禁（软模式） ──
      // 2026-06-30: 新增 Grandfather clause — 在门禁上线前提交的报告跳过新关键词校验
      // 原因: 门禁上线后 62 条存量报告缺少 [正向测试]/[反向测试]/[边界测试] 关键词而全部卡死
      // 门禁上线时间: commit d3dcfb2 ~2026-06-29
      const QUALITY_GATE_DEPLOYED_AT = new Date('2026-06-29T00:00:00.000Z');
      if (currentStep.name === 'dev_self_check') {
        const selfCheckReport = await prisma.requirementReport.findFirst({
          where: { requirementId: params.id, reportType: 'DEV_SELF_CHECK', status: { in: ['pending', 'approved'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (selfCheckReport && selfCheckReport.content) {
          const c = selfCheckReport.content as Record<string, unknown>;
          const items = c.items;
          const summary = (c.summary?.toString() ?? '');
          const allText = Array.isArray(items) ? items.join(' ') : '';
          const issues: string[] = [];

          // Grandfather clause: 门禁上线前的报告跳过所有校验
          const isLegacy = selfCheckReport.createdAt < QUALITY_GATE_DEPLOYED_AT;
          if (isLegacy) {
            console.log(`[Grandfather] 存量报告 ${selfCheckReport.id} 跳过所有门禁检查（提交于 ${selfCheckReport.createdAt.toISOString()}）`);
          } else {
            // 门禁上线后的报告执行完整校验
            if (!items || !Array.isArray(items) || items.length < 8) {
              issues.push(`报告条目不足（${Array.isArray(items) ? items.length : 0}/8）`);
            }
            if (allText.length + summary.length < 800) issues.push('报告总字数不足 800');
            const codeRefs = Array.isArray(items) ? items.filter((i: unknown) => typeof i === 'string' && i.includes('[代码引用]')).length : 0;
            if (codeRefs < 2) issues.push(`代码引用不足（${codeRefs}/2）`);
            if (!allText.includes('gitHash=')) issues.push('缺少 gitHash 元数据');
            if (!allText.includes('分支=')) issues.push('缺少分支元数据');
            if (!allText.includes('workspace/project/')) issues.push('缺少仓库路径');
            if (!Array.isArray(items) || !items.some((i: unknown) => typeof i === 'string' && i.includes('[正向测试]'))) issues.push('缺少正向测试');
            if (!Array.isArray(items) || !items.some((i: unknown) => typeof i === 'string' && i.includes('[反向测试]'))) issues.push('缺少反向测试');
            if (!Array.isArray(items) || !items.some((i: unknown) => typeof i === 'string' && i.includes('[边界测试]'))) issues.push('缺少边界测试');
          }

          if (issues.length > 0) throw new HttpError(400, `DEV_SELF_CHECK 报告质量门禁：\n${issues.join('\n')}`);
        }
      }

      // --- merge_to_main validation ---
      if (currentStep.name === 'merge_to_main') {
        if (body.branch) {
          await prisma.requirement.update({ where: { id: params.id }, data: { branch: body.branch } });
        }
        const req = await prisma.requirement.findUnique({
          where: { id: params.id }, select: { gitHash: true, branch: true, repoPath: true },
        });
        const errors: string[] = [];
        if (!req?.gitHash) errors.push('缺少 gitHash，请先提交代码并更新 gitHash');
        if (!req?.branch) errors.push('缺少 branch，请指定代码分支名');
        if (errors.length > 0) throw new HttpError(400, `merge_to_main 验证失败：\n${errors.join('\n')}`);
      }

      // --- Determine target step (next + auto-advance + security skip) ---
      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;
      if (nextStep.autoAdvance) {
        const afterNext = getNextStep(steps, nextStep.name);
        if (afterNext) targetStep = afterNext;
      }

      const { targetStep: resolvedStep } = skipSecurityIfApplicable(targetStep, reqType, steps);
      targetStep = resolvedStep;

      // --- WIP limit check ---
      if (targetStep.wipLimit && targetStep.wipLimit > 0) {
        const currentWip = await getStepWipCount(targetStep.name, params.id);
        if (currentWip >= targetStep.wipLimit) {
          throw new HttpError(409, `步骤「${targetStep.displayName}」WIP 已达上限（${currentWip}/${targetStep.wipLimit}），请等待现有任务完成后重试`);
        }
      }

      // --- Test environment lock ---
      // 锁的语义：从部署测试环境到最终上线完成，测试环境只服务这一个任务
      // 保护范围 = test_env_deploy → deploying，离开保护范围时释放
      let lockAcquired = false;
      let lockReleased = false;

      if (targetStep.name === 'test_env_deploy') {
        await acquireTestEnvLock(params.id, requirement.title, requirement.branch);
        lockAcquired = true;
      }
      if (shouldReleaseTestEnvLock(currentStep.name, targetStep.name)) {
        lockReleased = await releaseTestEnvLock(params.id);
      }

      // --- Resolve assignee for target step (snapshot-first) ---
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
        // 锁已获取但后续失败 → 回滚锁，防止孤儿锁
        if (lockAcquired) {
          try { await releaseTestEnvLock(params.id); } catch { /* ignore rollback error */ }
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, `assignee 解析失败: ${msg}`);
      }

      // --- Persist step transition ---
      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: { currentStep: targetStep.name, assigneeId: newAssigneeId, rejectReason: null },
      });
      const newAssigneeName = await getAssigneeName(newAssigneeId);

      await logTransition({
        requirementId: params.id, fromStep: requirement.currentStep, toStep: targetStep.name,
        action: 'advance', actorId: req.user!.id, actorName: req.user!.name,
        actorRole: req.user!.internalRole ?? req.user!.role, comment: body.comment,
        metadata: { skippedAutoStep: targetStep.name !== nextStep.name ? nextStep.name : null },
      });

      res.json({
        success: true,
        data: {
          requirementId: updated.id, fromStep: requirement.currentStep, toStep: targetStep.name,
          toStepDisplayName: targetStep.displayName, newAssigneeId, newAssigneeName,
          isDone: targetStep.name === steps[steps.length - 1]?.name,
        },
      });

      // --- Auto-advance queue after lock release (snapshot-aware via helper) ---
      if (lockReleased) autoAdvanceTestEnvQueue();
    }),
  );
}
