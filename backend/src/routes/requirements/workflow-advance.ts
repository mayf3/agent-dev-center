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
import { assertDomainReadAccess } from './utils.js';
import {
  getWorkflowSteps,
  getWorkflowRawJson,
  getCurrentStep,
  getNextStep,
  mapUserRole,
  resolveWorkflowAuthorization,
  checkReportsApproved,
  logTransition,
  extractRoleUserMap,
} from './workflow-helpers.js';
import {
  skipSecurityIfApplicable,
  acquireTestEnvLock,
  releaseTestEnvLock,
  shouldReleaseTestEnvLock,
  autoAdvanceTestEnvQueue,
  TestEnvLockOwnership,
} from './workflow-advance-helpers.js';
import { casUpdateRequirement, txCreateTransition, txReadRequirement } from './workflow-cas-helper.js';
import { recordRequirementEvent, buildWorkflowEvent } from '../../services/requirement-event-ledger-service.js';
import { RequirementEventType } from '../../lib/requirement-event-types.js';
import { recordGuardrailBlocked } from '../../lib/record-guardrail-event.js';

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
      assertDomainReadAccess(req.user!, requirement);
      if (!requirement.workflow && !requirement.workflowSnapshot) {
        throw new HttpError(400, '该需求未分配工作流');
      }
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
        const authorization = resolveWorkflowAuthorization(req.user!, requirement, currentStep.role);

        if (authorization.mode === 'instance') {
          if (!authorization.authorized) {
            recordGuardrailBlocked({
              requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
              reasonCode: 'ROLE_MISMATCH', reasonText: `实例模式授权失败：步骤「${currentStep.displayName}」需分配用户`,
              fromStep: requirement.currentStep, source: 'workflow-advance',
            });
            throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要分配给您才能操作`);
          }
          // 实例模式下：roleUserMap 精确授权，不再检查 assignee 或 mapUserRole，
          // 也不允许 cto_agent 绕过
        } else {
          // Legacy 模式：保留原有 assignee + mapUserRole + cto_agent 合同
          if (requirement.assigneeId && requirement.assigneeId !== req.user!.id && req.user!.role !== 'cto_agent') {
            recordGuardrailBlocked({
              requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
              reasonCode: 'ROLE_MISMATCH', reasonText: `该任务分配给了「${requirement.assignee}」，非当前用户`,
              fromStep: requirement.currentStep, source: 'workflow-advance',
            });
            throw new HttpError(403, `该任务当前分配给了「${requirement.assignee}」，你无法操作非自己名下的任务`);
          }
          const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
          if (!matchedRole && req.user!.role !== 'cto_agent') {
            recordGuardrailBlocked({
              requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
              reasonCode: 'ROLE_MISMATCH', reasonText: `需要「${currentStep.role}」角色，当前为「${req.user!.internalRole ?? req.user!.role}」`,
              fromStep: requirement.currentStep, source: 'workflow-advance',
            });
            throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
          }
        }
      }

      // --- Report check ---
      // 严格校验当前步骤的 requiredReports：离开前必须全部满足
      // 1) 模板定义的 currentStep.requiredReports 逐一检查
      // 2) 安全类型过滤：非 SECURITY 需求跳过 SECURITY_REVIEW 检查
      // 3) 补充硬约束：dev_self_check 步骤始终要求 DEV_SELF_CHECK 报告（模板备份）
      const reqType = (requirement as any).type;
      const isNonSecurityType = reqType !== 'SECURITY';
      const currentReports = isNonSecurityType
        ? currentStep.requiredReports.filter(r => r !== 'SECURITY_REVIEW')
        : currentStep.requiredReports;
      // 补充防护：dev_self_check 始终需要 DEV_SELF_CHECK 报告
      // 即使 workflow 模板的 requiredReports 中未包含也不放过
      if (currentStep.name === 'dev_self_check' && !currentReports.includes('DEV_SELF_CHECK')) {
        currentReports.push('DEV_SELF_CHECK');
      }
      if (currentReports.length > 0) {
        const { ok, missing } = await checkReportsApproved(params.id, currentReports);
        if (!ok) {
          const reportLabels: Record<string, string> = {
            DEV_SELF_CHECK: '开发自检报告', MERGE_REPORT: '合并报告', TEST_REPORT: '测试报告',
            SECURITY_REVIEW: '安全检查报告', CTO_REVIEW: 'CTO验收报告', DEPLOY_CONFIRM: '部署确认报告',
          };
          recordGuardrailBlocked({
            requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
            reasonCode: 'REPORT_NOT_APPROVED', reasonText: `缺少报告：${missing.map(t => reportLabels[t] ?? t).join('、')}`,
            fromStep: requirement.currentStep, source: 'workflow-advance',
          });
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

          if (issues.length > 0) {
            recordGuardrailBlocked({
              requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
              reasonCode: 'VALIDATION_FAILED', reasonText: `DEV_SELF_CHECK 质量门禁：${issues.join('; ')}`,
              fromStep: requirement.currentStep, source: 'workflow-advance',
            });
            throw new HttpError(400, `DEV_SELF_CHECK 报告质量门禁：\n${issues.join('\n')}`);
          }
        }
      }

      // --- merge_to_main validation ---
      if (currentStep.name === 'merge_to_main') {
        if (body.branch) {
          await prisma.requirement.update({ where: { id: params.id }, data: { branch: body.branch } });
        }
        const mergeReq = await prisma.requirement.findUnique({
          where: { id: params.id }, select: { gitHash: true, branch: true, repoPath: true },
        });
        const errors: string[] = [];
        if (!mergeReq?.gitHash) errors.push('缺少 gitHash，请先提交代码并更新 gitHash');
        if (!mergeReq?.branch) errors.push('缺少 branch，请指定代码分支名');
        if (errors.length > 0) {
          recordGuardrailBlocked({
            requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
            reasonCode: 'DEPLOY_FIELD_MISSING', reasonText: `merge_to_main 必填字段：${errors.join('; ')}`,
            fromStep: requirement.currentStep, source: 'workflow-advance',
          });
          throw new HttpError(400, `merge_to_main 验证失败：\n${errors.join('\n')}`);
        }
      }

      // --- Determine target step (next + auto-advance + security skip) ---
      const nextStep = getNextStep(steps, requirement.currentStep);
      if (!nextStep) throw new HttpError(400, '已在工作流最后一步，无法继续推进');

      let targetStep = nextStep;
      if (nextStep.autoAdvance) {
        const afterNext = getNextStep(steps, nextStep.name);
        if (afterNext) targetStep = afterNext;
      }

      const { targetStep: resolvedStep, skippedSteps } = skipSecurityIfApplicable(targetStep, reqType, steps);
      targetStep = resolvedStep;

      // --- Target step report check ---
      // 进入目标步骤必须满足该步骤的 requiredReports（防止跳过报告审批）
      // 排除目标步骤自身产生的报告（如 DEV_SELF_CHECK 由 dev_self_check 产生），
      // 这种报告应在步骤内完成，不是进入步骤的前置条件。
      // 如果安全步骤被跳过，自动过滤 SECURITY_REVIEW 要求。
      // 注意：当前步骤的 requiredReports 已在前面单独检查（Report check 段），
      // 确保离开任何步骤前其必填报告已提交。
      const STEP_OWNS_REPORT: Record<string, string[]> = {
        dev_self_check: ['DEV_SELF_CHECK'],
        arch_design: ['ARCH_DESIGN'],
        arch_review: ['ARCH_REVIEW'],
        testing: ['TEST_REPORT'],
        security_review: ['SECURITY_REVIEW'],
        cto_review: ['CTO_REVIEW'],
        merge_to_main: ['MERGE_REPORT'],
        deploying: ['DEPLOY_CONFIRM'],
      };
      // 补充防护：永远不因空报告列表而跳过校验
      // 如果 targetReports 为空但仍需检查当前步骤的报告，由 Report check 段保障
      const stepSelfReports = STEP_OWNS_REPORT[targetStep.name] || [];
      const targetReports = (skippedSteps.includes('security_review')
        ? targetStep.requiredReports.filter(r => r !== 'SECURITY_REVIEW')
        : [...targetStep.requiredReports]
      ).filter(r => !stepSelfReports.includes(r));
      if (targetReports.length > 0 && currentStep.name !== targetStep.name) {
        const { ok: targetOk, missing: targetMissing } = await checkReportsApproved(params.id, targetReports);
        if (!targetOk) {
          const reportLabels: Record<string, string> = {
            DEV_SELF_CHECK: '开发自检报告', MERGE_REPORT: '合并报告', TEST_REPORT: '测试报告',
            SECURITY_REVIEW: '安全检查报告', CTO_REVIEW: 'CTO验收报告', DEPLOY_CONFIRM: '部署确认报告',
          };
          recordGuardrailBlocked({
            requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
            reasonCode: 'REPORT_NOT_APPROVED', reasonText: `进入「${targetStep.displayName}」缺少报告：${targetMissing.map(t => reportLabels[t] ?? t).join('、')}`,
            fromStep: requirement.currentStep, source: 'workflow-advance',
          });
          throw new HttpError(400, `推进失败：进入「${targetStep.displayName}」需要已通过的报告 — ${targetMissing.map(t => reportLabels[t] ?? t).join('、')}`);
        }
      }

      // --- Test environment lock ---
      let lockOwnership: TestEnvLockOwnership | null = null;
      let lockReleased = false;

      if (targetStep.name === 'test_env_deploy') {
        lockOwnership = await acquireTestEnvLock(params.id, requirement.title, requirement.branch);
      }
      if (shouldReleaseTestEnvLock(currentStep.name, targetStep.name)) {
        if (lockOwnership) {
          lockReleased = await releaseTestEnvLock(lockOwnership);
        } else {
          const currentLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
          if (currentLock && currentLock.lockToken) {
            lockReleased = await releaseTestEnvLock({
              lockId: 'singleton', lockToken: currentLock.lockToken,
              acquiredForRequirement: currentLock.requirementId,
            });
          }
        }
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
		        if (lockOwnership) {
		          try { await releaseTestEnvLock(lockOwnership); } catch (releaseError) {
		            console.error('[test-env-lock]', JSON.stringify({
		              event: 'test_env_lock_release_failed',
		              lockId: lockOwnership.lockId,
		              requirementId: lockOwnership.acquiredForRequirement,
		              lockToken: lockOwnership.lockToken,
		              error: releaseError instanceof Error ? releaseError.message : String(releaseError),
		            }));
		          }
		        }
	        const msg = err instanceof Error ? err.message : String(err);
	        throw new HttpError(400, `assignee 解析失败: ${msg}`);
	      }

      // --- Persist step transition (CAS + transaction) ---
      let updated;
      try {
        updated = await prisma.$transaction(async (tx: any) => {
          const currentReq = await txReadRequirement(tx, params.id);
          const newAssigneeName = await getAssigneeName(newAssigneeId);
          const updatedReq = await casUpdateRequirement(tx, params.id, currentReq.stateVersion ?? 0, {
            currentStep: targetStep.name, assigneeId: newAssigneeId, rejectReason: null,
          });
          const transition = await txCreateTransition(tx, {
            requirement: { connect: { id: params.id } },
            fromStep: requirement.currentStep, toStep: targetStep.name,
            action: 'advance', actorId: req.user!.id, actorName: req.user!.name,
            actorRole: req.user!.internalRole ?? req.user!.role, comment: body.comment,
            metadata: { skippedAutoStep: targetStep.name !== nextStep.name ? nextStep.name : null },
          });
          // Record WORKFLOW_ADVANCED ledger event within the same transaction
          await recordRequirementEvent(tx, buildWorkflowEvent(RequirementEventType.WORKFLOW_ADVANCED, {
            requirementId: params.id,
            fromStep: requirement.currentStep,
            toStep: targetStep.name,
            fromAssigneeId: requirement.assigneeId,
            toAssigneeId: newAssigneeId,
            actorId: req.user!.id,
            actorName: req.user!.name,
            actorType: 'human',
            relatedTransitionId: transition.id,
            stateVersionBefore: currentReq.stateVersion ?? 0,
            stateVersionAfter: updatedReq.stateVersion ?? 0,
          }));
          return { updatedReq, newAssigneeName };
        });
      } catch (err) {
        // Record STATE_CONFLICT guardrail on CAS failure
        recordGuardrailBlocked({
          requirementId: params.id, actorId: req.user!.id, actorName: req.user!.name,
          reasonCode: 'STATE_CONFLICT', reasonText: `CAS 并发冲突，stateVersion 不匹配`,
          fromStep: requirement.currentStep, source: 'workflow-advance',
        });
        if (lockOwnership) {
	          try { await releaseTestEnvLock(lockOwnership); } catch (releaseError) {
	            console.error('[test-env-lock]', JSON.stringify({
	              event: 'test_env_lock_release_failed',
	              lockId: lockOwnership.lockId,
	              requirementId: lockOwnership.acquiredForRequirement,
	              lockToken: lockOwnership.lockToken,
	              error: releaseError instanceof Error ? releaseError.message : String(releaseError),
	            }));
	          }
	        }
	        throw err;
	      }

      const { updatedReq, newAssigneeName } = updated;

      res.json({
        success: true,
        data: {
          requirementId: updatedReq.id, fromStep: requirement.currentStep, toStep: targetStep.name,
          toStepDisplayName: targetStep.displayName, newAssigneeId, newAssigneeName,
          isDone: targetStep.name === steps[steps.length - 1]?.name,
        },
      });

      // --- Auto-advance queue after lock release (snapshot-aware via helper) ---
      if (lockReleased) autoAdvanceTestEnvQueue();
    }),
  );
}
