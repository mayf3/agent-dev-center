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
 * Lock ownership identity.
 * Each call to acquire generates a unique UUID token stored in the DB.
 * Release uses atomic compare-and-delete with this token.
 */
export type TestEnvLockOwnership = {
  lockId: string;
  lockToken: string;
  acquiredForRequirement: string;
};

/**
 * TTL for test env lock: 4 hours by default.
 * A lock whose acquiredAt is more than TTL ago is considered stale
 * and can be atomically taken over by another request.
 */
export const TEST_ENV_LOCK_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Acquire test environment lock when entering test_env_deploy.
 *
 * Atomic INSERT-or-conditional-UPDATE pattern:
 *   1. Try INSERT — if no existing row, this succeeds and we hold the lock.
 *   2. If INSERT fails (row already exists), try UPDATE with expiry check.
 *   3. If existing lock is still valid (within TTL), fail with 409.
 *   4. If existing lock is stale (past TTL), atomically take over.
 *
 * Uses Prisma $transaction with NOW() check to ensure atomicity without
 * application-level TOCTOU.
 */
export async function acquireTestEnvLock(
  requirementId: string, title: string, branch: string | null,
  now?: Date,
): Promise<TestEnvLockOwnership> {
  const lockToken = crypto.randomUUID();
  const timestamp = now ?? new Date();
  const ttlDate = new Date(timestamp.getTime() - TEST_ENV_LOCK_TTL_MS);

  return prisma.$transaction(async (tx: any) => {
    // Read current lock state
    const existing = await tx.testEnvLock.findUnique({ where: { id: 'singleton' } });

    if (existing) {
      // Lock exists; check if it's stale
      if (existing.acquiredAt >= ttlDate) {
        // Lock is still valid — fail
        throw new HttpError(
          409,
          `测试环境已被占用：需求「${existing.requirementTitle || existing.requirementId}」（锁定于 ${existing.acquiredAt.toISOString().replace('T', ' ').slice(0, 16)}），请等待其部署完成后重试`,
        );
      }
      // Stale lock — atomically take over
      await tx.testEnvLock.update({
        where: { id: 'singleton' },
        data: { requirementId, requirementTitle: title, branch, lockToken, acquiredAt: timestamp },
      });
    } else {
      // No existing lock — insert
      await tx.testEnvLock.create({
        data: { id: 'singleton', requirementId, requirementTitle: title, branch, lockToken, acquiredAt: timestamp },
      });
    }

    return { lockId: 'singleton', lockToken, acquiredForRequirement: requirementId };
  });
}

/**
 * Release test environment lock using atomic compare-and-delete.
 *
 * Only deletes if the row still carries OUR exact id + lockToken pair.
 * count === 1 → released (our lock)
 * count === 0 → lock already gone or replaced (idempotent)
 */
export async function releaseTestEnvLock(ownership: TestEnvLockOwnership): Promise<boolean> {
  const { count } = await prisma.testEnvLock.deleteMany({
    where: { id: ownership.lockId, lockToken: ownership.lockToken },
  });
  if (count === 0) {
    console.warn(
      `[test-env-lock] SKIP release (count=0): token ${ownership.lockToken.slice(0, 8)}… for requirement ${ownership.acquiredForRequirement.slice(0, 8)}`,
    );
  }
  return count === 1;
}

/**
 * After lock release, auto-assign lock to next waiting requirement (FIFO).
 * Runs asynchronously without blocking the response.
 * Uses a fresh UUID lockToken for the new assignment.
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
      if (!steps.some(s => s.name === 'test_env_deploy')) return;

      const newToken = crypto.randomUUID();
      await prisma.testEnvLock.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', requirementId: next.id, requirementTitle: next.title, branch: next.branch, lockToken: newToken, acquiredAt: new Date() },
        update: { requirementId: next.id, requirementTitle: next.title, branch: next.branch, lockToken: newToken, acquiredAt: new Date() },
      });
      console.log(`[test-env-lock] Auto-assigned to: ${next.id.slice(0, 8)} with token ${newToken.slice(0, 8)}…`);
    } catch (err) {
      console.error('[test-env-lock] Auto-advance failed:', err);
    }
  })();
}
