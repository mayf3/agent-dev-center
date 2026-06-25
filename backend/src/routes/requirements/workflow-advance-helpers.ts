/**
 * Workflow Advance Helpers
 *
 * Extracted from workflow-advance.ts to keep file under 200 lines.
 * Handles: test-env lock acquire/release, security step skipping, queue auto-advance.
 *
 * 2026-06-16: 锁保护范围从硬编码 testing/deploying 改为完整的受保护步骤集合。
 * 锁的语义：从部署测试环境到最终上线完成，测试环境只服务这一个任务。
 * 受保护步骤离开即释放锁（无论 advance 还是 reject）。
 */
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { getNextStep, parseSteps, getWorkflowRawJson, type WorkflowStep } from './workflow-helpers.js';

/**
 * 测试环境锁保护范围
 * 
 * 一个任务从部署测试环境（test_env_deploy）到最终上线完成（done），
 * 其代码一直存在于测试环境中。在此期间，其他任务不应覆盖测试环境。
 * 
 * 锁在此范围内的任何步骤被获取后，直到离开此范围才释放。
 * 离开方式包括：正常 advance 到 done、或被 reject 回更早步骤。
 */
export const TEST_ENV_PROTECTED_STEPS = new Set([
  'test_env_deploy',
  'testing',
  'security_review',
  'qa_pre_release',
  'cto_review',
  'merge_to_main',
  'deploying',
]);

/**
 * 判断是否应该释放测试环境锁
 * 当前步骤在保护范围内，且目标步骤不在保护范围内 → 释放
 */
export function shouldReleaseTestEnvLock(currentStepName: string, targetStepName: string): boolean {
  return TEST_ENV_PROTECTED_STEPS.has(currentStepName) && !TEST_ENV_PROTECTED_STEPS.has(targetStepName);
}

/**
 * Skip security_review (and qa_review_security) for non-SECURITY requirement types.
 * Returns the target step after potential skipping.
 */
export function skipSecurityIfApplicable(
  targetStep: WorkflowStep,
  requirementType: string | undefined,
  steps: WorkflowStep[],
): { targetStep: WorkflowStep; skippedSteps: string[] } {
  const skippedSteps: string[] = [];
  let step = targetStep;

  if (step.name === 'security_review') {
    const securityTypes = ['SECURITY'];
    if (!securityTypes.includes(requirementType ?? '')) {
      skippedSteps.push(step.name);
      let afterSkip = getNextStep(steps, step.name);
      if (afterSkip && afterSkip.name === 'qa_review_security') {
        skippedSteps.push(afterSkip.name);
        afterSkip = getNextStep(steps, afterSkip.name);
      }
      if (afterSkip) {
        step = afterSkip;
      }
    }
  }

  return { targetStep: step, skippedSteps };
}

/** TTL: 测试环境锁默认 2 小时后过期 */
const TEST_ENV_LOCK_TTL_MS = 2 * 60 * 60 * 1000;

/** 判断锁是否过期 */
function isLockExpired(lock: { expiresAt: Date }): boolean {
  return new Date() > lock.expiresAt;
}

/**
 * Acquire test environment lock when entering test_env_deploy.
 * Throws 409 if another requirement holds the lock (unless expired).
 * Returns the requirement ID for rollback tracking.
 */
export async function acquireTestEnvLock(requirementId: string, title: string, branch: string | null): Promise<string> {
  const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (existingLock && existingLock.requirementId !== requirementId) {
    // 检查是否过期
    if (isLockExpired(existingLock)) {
      console.log(`[test-env-lock] Lock expired, auto-releasing from: ${existingLock.requirementId.slice(0, 8)}`);
      await prisma.testEnvLock.delete({ where: { id: 'singleton' } });
    } else {
      throw new HttpError(
        409,
        `测试环境已被占用：需求「${existingLock.requirementTitle || existingLock.requirementId}」（锁定于 ${existingLock.acquiredAt.toISOString().replace('T', ' ').slice(0, 16)}，` +
        `过期于 ${existingLock.expiresAt.toISOString().replace('T', ' ').slice(0, 16)}），请等待其部署完成后重试`,
      );
    }
  }
  const expiresAt = new Date(Date.now() + TEST_ENV_LOCK_TTL_MS);
  await prisma.testEnvLock.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', requirementId, requirementTitle: title, branch, expiresAt },
    update: { requirementId, requirementTitle: title, branch, acquiredAt: new Date(), expiresAt },
  });
  return requirementId;
}

/**
 * Release test environment lock when leaving the protected zone.
 * Returns true if lock was released.
 */
export async function releaseTestEnvLock(requirementId: string): Promise<boolean> {
  const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (existingLock && existingLock.requirementId === requirementId) {
    await prisma.testEnvLock.delete({ where: { id: 'singleton' } });
    return true;
  }
  return false;
}

/**
 * After lock release, auto-assign lock to next waiting requirement (FIFO).
 * Runs asynchronously without blocking the response.
 */
export function autoAdvanceTestEnvQueue(): void {
  void (async () => {
    try {
      const next = await prisma.requirement.findFirst({
        where: { currentStep: 'test_env_deploy' },
        orderBy: { updatedAt: 'asc' },
        select: { id: true, title: true, branch: true, workflowSnapshot: true, workflow: { select: { steps: true } } },
      });
      if (!next) return;

      const rawJson = getWorkflowRawJson(next);
      if (!rawJson) return;

      const steps = parseSteps(rawJson);
      const hasStep = steps.some(s => s.name === 'test_env_deploy');
      if (!hasStep) return;

      const expiresAt = new Date(Date.now() + TEST_ENV_LOCK_TTL_MS);
      await prisma.testEnvLock.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', requirementId: next.id, requirementTitle: next.title, branch: next.branch, expiresAt },
        update: { requirementId: next.id, requirementTitle: next.title, branch: next.branch, acquiredAt: new Date(), expiresAt },
      });
      console.log(`[test-env-lock] Lock released, auto-assigned to: ${next.id.slice(0, 8)} (${next.title?.slice(0, 30)})`);
    } catch (err) {
      console.error('[test-env-lock] Auto-advance failed:', err);
    }
  })();
}
