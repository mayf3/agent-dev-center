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
 * Minimal database client interface for test-env lock operations.
 * Defines only the methods that acquireTestEnvLock / releaseTestEnvLock need,
 * so tests can inject independent PrismaClient instances.
 */
export interface LockDbClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  testEnvLock: {
    findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

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
 * Atomic single-statement INSERT ... ON CONFLICT ... WHERE pattern:
 *   - No existing row → INSERT returns 1 row (lock acquired)
 *   - Existing row but stale (past TTL) → conditional UPDATE returns 1 row (taken over)
 *   - Existing row still valid → WHERE clause fails, UPDATE returns 0 rows → 409 conflict
 *
 * Uses raw PostgreSQL via $queryRawUnsafe to guarantee database-level atomicity.
 * Two concurrent requests for an empty/stale lock: exactly one succeeds.
 */
export async function acquireTestEnvLock(
  requirementId: string, title: string, branch: string | null,
  opts?: { db?: LockDbClient; now?: Date },
): Promise<TestEnvLockOwnership> {
  const db = opts?.db ?? prisma;
  const lockToken = crypto.randomUUID();
  const timestamp = opts?.now ?? new Date();
  const ttlDate = new Date(timestamp.getTime() - TEST_ENV_LOCK_TTL_MS);

  // Single atomic SQL: insert or take over if stale.
  // SAFETY: All dynamic values ($1..$7) use independent positional parameter binding.
  // The SQL structure (table names, column names) is entirely static.
  // No user-controlled value enters the SQL string via concatenation.
  // UUIDs, title, branch, timestamps are all parameterized.
  const rows: Array<{ id: string; requirementId: string; lockToken: string }> = await db.$queryRawUnsafe(
    `INSERT INTO "test_env_lock" ("id", "requirementId", "requirementTitle", "branch", "acquiredAt", "lockToken")
     VALUES ($1, $2::uuid, $3, $4, $5, $6::uuid)
     ON CONFLICT ("id") DO UPDATE
       SET "requirementId" = EXCLUDED."requirementId",
           "requirementTitle" = EXCLUDED."requirementTitle",
           "branch" = EXCLUDED."branch",
           "acquiredAt" = EXCLUDED."acquiredAt",
           "lockToken" = EXCLUDED."lockToken"
     WHERE "test_env_lock"."acquiredAt" < $7
     RETURNING "id", "requirementId", "lockToken"`,
    'singleton', requirementId, title, branch, timestamp, lockToken, ttlDate,
  );

  if (rows.length === 0) {
    // Lock exists and is still valid — read current details for a helpful error
    const existing = await db.testEnvLock.findUnique({ where: { id: 'singleton' } }) as Record<string, unknown> | null;
    throw new HttpError(
      409,
      `测试环境已被占用：需求「${(existing?.requirementTitle as string) || (existing?.requirementId as string) || '未知'}」（锁定于 ${String((existing?.acquiredAt as Date)?.toISOString()?.replace('T', ' ').slice(0, 16) || '未知')}），请等待其部署完成后重试`,
    );
  }

  return { lockId: rows[0].id, lockToken: rows[0].lockToken, acquiredForRequirement: rows[0].requirementId };
}

/**
 * Release test environment lock using atomic compare-and-delete.
 *
 * Only deletes if the row still carries OUR exact id + requirementId + lockToken triplet.
 * count === 1 → released (our lock)
 * count === 0 → lock already gone or replaced (idempotent)
 *
 * The requirementId check prevents cross-generation release:
 * - A holds L1 (token T1), B takes over with T2, A's delayed release cannot delete B's lock
 *   because requirementId matches but T1 ≠ T2 → no rows match the triplet
 */
export async function releaseTestEnvLock(
  ownership: TestEnvLockOwnership,
  opts?: { db?: LockDbClient },
): Promise<boolean> {
  const db = opts?.db ?? prisma;
  const { count } = await db.testEnvLock.deleteMany({
    where: {
      id: ownership.lockId,
      requirementId: ownership.acquiredForRequirement,
      lockToken: ownership.lockToken,
    },
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
 *
 * Atomic transaction contract (Section IV of ADC-Task-Loop-CAS):
 *   1. Select candidate at pending_deploy
 *   2. Atomically acquire singleton lock via acquireTestEnvLock
 *   3. CAS-advance requirement: pending_deploy → test_env_deploy
 *   4. Commit (or rollback everything if any step fails)
 *
 * Runs asynchronously without blocking the response.  Never uses raw
 * prisma.testEnvLock.upsert — all production lock acquisition goes
 * through the unified acquireTestEnvLock helper.
 */
export function autoAdvanceTestEnvQueue(): void {
  void autoAdvanceCandidates();
}

/**
 * Async body of autoAdvanceTestEnvQueue, exported for integration tests.
 *
 * Accepts optional db override for test injection (e.g. KERNEL_TEST_DATABASE_URL).
 * Production callers omit db → uses default prisma singleton.
 *
 * Returns an object with candidate and ownership info on success,
 * or null if no candidate is available or lock is busy.
 */
export async function autoAdvanceCandidates(opts?: { db?: LockDbClient }): Promise<{
  candidateId: string;
  ownership: TestEnvLockOwnership;
} | null> {
  const client = opts?.db ?? prisma;
  try {
    const next = await (client as any).requirement.findFirst({
      where: { currentStep: 'pending_deploy' },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, title: true, branch: true, workflowSnapshot: true, workflow: { select: { steps: true } } },
    });
    if (!next) return null;

    const rawJson = getWorkflowRawJson(next);
    if (!rawJson) return null;
    const steps = parseSteps(rawJson);
    if (!steps.some(s => s.name === 'test_env_deploy')) return null;

    // ── Atomic transaction: lock + CAS advance ──────────────
    const result = await (client as any).$transaction(async (tx: any) => {
      // 1. Atomically acquire (or take over) the singleton lock
      //    Throws HttpError(409) if a valid lock exists → whole tx rolls back.
      //    Because acquireTestEnvLock uses INSERT ... ON CONFLICT ... WHERE,
      //    the lock row is locked/created inside this transaction.
      const ownership = await acquireTestEnvLock(
        next.id,
        next.title,
        next.branch,
        { db: tx as any, now: new Date() },
      );

      // 2. CAS-advance: only update if still at pending_deploy
      const advanced = await tx.requirement.updateMany({
        where: { id: next.id, currentStep: 'pending_deploy' },
        data: { currentStep: 'test_env_deploy', updatedAt: new Date() },
      });

      if (advanced.count !== 1) {
        throw new Error(
          `auto-advance CAS conflict: requirement ${next.id.slice(0, 8)} no longer at pending_deploy`,
        );
      }

      console.log(`[test-env-lock] Queue auto-advance: ${next.id.slice(0, 8)} (${next.title?.slice(0, 30)}) → test_env_deploy with token ${ownership.lockToken.slice(0, 8)}…`);
      return { candidateId: next.id, ownership };
    });

    return result;
  } catch (err) {
    // HttpError(409) from acquireTestEnvLock = lock busy, not a failure
    if (err instanceof HttpError && err.statusCode === 409) {
      console.log(`[test-env-lock] Queue auto-advance skipped: lock busy — ${err.message.slice(0, 60)}`);
      return null;
    }
    console.error('[test-env-lock] Auto-advance queue failed:', err);
    throw err;
  }
}
