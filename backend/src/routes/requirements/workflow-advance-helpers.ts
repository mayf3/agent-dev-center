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

/**
 * Test environment lock ownership identity.
 *
 * Each successful acquisition records a unique acquiredAt timestamp in the DB.
 * The caller keeps this timestamp as proof of "this generation" of the lock.
 * releaseTestEnvLock uses atomic deleteMany with the exact acquiredAt to
 * implement compare-and-delete at the database level — no application-level
 * read-then-compare.
 */
export type TestEnvLockOwnership = {
  lockId: string;
  acquisitionToken: Date;
  acquiredForRequirement: string;
};

/**
 * Acquire test environment lock when entering test_env_deploy.
 * Throws 409 if another requirement already holds the lock.
 *
 * Returns TestEnvLockOwnership containing the DB-persisted acquiredAt
 * timestamp.  This timestamp acts as a generation marker: only our exact
 * generation can be deleted by release.  If another request later reacquires
 * the lock, acquiredAt differs and the old token can no longer match.
 */
export async function acquireTestEnvLock(requirementId: string, title: string, branch: string | null): Promise<TestEnvLockOwnership> {
  const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (existingLock && existingLock.requirementId !== requirementId) {
    throw new HttpError(
      409,
      `测试环境已被占用：需求「${existingLock.requirementTitle || existingLock.requirementId}」（锁定于 ${existingLock.acquiredAt.toISOString().replace('T', ' ').slice(0, 16)}），请等待其部署完成后重试`,
    );
  }
  const acquisitionToken = new Date();
  await prisma.testEnvLock.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', requirementId, requirementTitle: title, branch, acquiredAt: acquisitionToken },
    update: { requirementId, requirementTitle: title, branch, acquiredAt: acquisitionToken },
  });
  return { lockId: 'singleton', acquisitionToken, acquiredForRequirement: requirementId };
}

/**
 * Release test environment lock using atomic compare-and-delete.
 *
 * deleteMany({ where: { id, acquiredAt } }) succeeds only if the row
 * still carries OUR exact acquisitionToken.  If another generation has
 * replaced the lock, acquiredAt differs and the delete matches 0 rows.
 *
 * Returns true when the lock was deleted (count = 1).
 * Returns false when the lock was already gone or has a newer generation
 * (count = 0) — idempotent for the caller.
 *
 * Errors during release are logged via console.error.  The caller is
 * responsible for re-throwing or preserving the original business error.
 */
export async function releaseTestEnvLock(ownership: TestEnvLockOwnership): Promise<boolean> {
  const { count } = await prisma.testEnvLock.deleteMany({
    where: {
      id: ownership.lockId,
      acquiredAt: ownership.acquisitionToken,
    },
  });
  if (count === 0) {
    console.warn(
      `[test-env-lock] SKIP release (count=0): lock generation changed for ${ownership.lockId} (expected requirement ${ownership.acquiredForRequirement?.slice(0, 8)})`,
    );
  }
  return count === 1;
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

      await prisma.testEnvLock.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', requirementId: next.id, requirementTitle: next.title, branch: next.branch },
        update: { requirementId: next.id, requirementTitle: next.title, branch: next.branch, acquiredAt: new Date() },
      });
      console.log(`[test-env-lock] Lock released, auto-assigned to: ${next.id.slice(0, 8)} (${next.title?.slice(0, 30)})`);
    } catch (err) {
      console.error('[test-env-lock] Auto-advance failed:', err);
    }
  })();
}
