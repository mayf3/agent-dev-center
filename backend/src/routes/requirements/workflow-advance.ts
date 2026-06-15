/**
 * Workflow Advance Route
 *
 * POST /:id/workflow/advance — 推进到下一步
 * 最复杂的路由：角色校验 + 报告校验 + 安全步骤跳过 + WIP限制 + 测试环境锁
 */
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { advanceStepSchema } from '../../schemas/workflow.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';
import {
  parseSteps,
  getCurrentStep,
  getNextStep,
  mapUserRole,
  checkReportsApproved,
  getStepWipCount,
  logTransition,
  extractRoleUserMap,
} from './workflow-helpers.js';

export function registerWorkflowAdvanceRoutes(router: import('express').Router): void {

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

      // 特殊处理：draft 步骤允许需求提出者 advance（无论 internalRole）
      if (currentStep.name === 'draft') {
        const isRequester = requirement.requesterId === req.user!.id;
        if (!isRequester && req.user!.role !== 'cto_agent') {
          throw new HttpError(403, '只有需求提出者可以提交草稿到 PM 审批');
        }
        // 通过，跳过角色校验
      } else {
        // assigneeId 校验：非 assignee 不能操作（CTO 可以代操作）
        if (requirement.assigneeId && requirement.assigneeId !== req.user!.id && req.user!.role !== 'cto_agent') {
          throw new HttpError(403, `该任务当前分配给了「${requirement.assignee}」，你无法操作非自己名下的任务`);
        }
        // 角色校验（系统级强制约束）
        const matchedRole = mapUserRole(req.user!.internalRole, currentStep.role);
        if (!matchedRole && req.user!.role !== 'cto_agent') {
          throw new HttpError(403, `当前步骤「${currentStep.displayName}」需要「${currentStep.role}」角色，你的角色是「${req.user!.internalRole ?? req.user!.role}」`);
        }
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
        // 如果 advance body 包含 branch，先保存到需求记录
        if (body.branch) {
          await prisma.requirement.update({
            where: { id: params.id },
            data: { branch: body.branch },
          });
        }
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
      // 离开 testing 或 deploying 时释放测试环境锁
      // 2026-06-15 修复: 之前只在 deploying 释放，导致卡在 qa_review 的需求锁死测试环境
      if (currentStep.name === 'testing' || currentStep.name === 'deploying') {
        const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
        if (existingLock && existingLock.requirementId === params.id) {
          await prisma.testEnvLock.delete({ where: { id: 'singleton' } });
          lockReleased = true;
        }
      }

      // 从模板中提取 roleUserMap（兼容新旧格式）
      const roleUserMap = extractRoleUserMap(requirement.workflow.steps);

      // 自动解析下一步骤的 assigneeId
      let newAssigneeId: string | null;
      try {
        const hasRoleUserMap = roleUserMap && Object.keys(roleUserMap).length > 0;
        if (hasRoleUserMap || targetStep.assigneeMode) {
          // v2: 使用 assigneeMode + roleUserMap
          newAssigneeId = await resolveAssigneeForStep(
            targetStep.role,
            requirement.assigneeId,
            {
              assigneeMode: targetStep.assigneeMode,
              roleUserMap,
              requirement: {
                id: requirement.id,
                requesterId: requirement.requesterId,
                assigneeId: requirement.assigneeId,
              },
            },
          );
        } else {
          // 旧逻辑：无 roleUserMap 时不传 options
          newAssigneeId = await resolveAssigneeForStep(targetStep.role, requirement.assigneeId);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, `assignee 解析失败: ${msg}`);
      }

      const updated = await prisma.requirement.update({
        where: { id: params.id },
        data: {
          currentStep: targetStep.name,
          assigneeId: newAssigneeId,
          rejectReason: null,  // 审批通过时清空驳回原因（防止残留导致误判）
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
}
