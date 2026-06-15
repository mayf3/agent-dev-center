/**
 * Workflow Advance Helpers
 *
 * Extracted from workflow-advance.ts to keep file under 200 lines.
 * Handles: test-env lock acquire/release, security step skipping, queue auto-advance.
 */
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { getNextStep, parseSteps, type WorkflowStep } from './workflow-helpers.js';

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
 * Acquire test environment lock when entering test_env_deploy.
 * Throws 409 if another requirement holds the lock.
 */
export async function acquireTestEnvLock(requirementId: string, title: string, branch: string | null): Promise<void> {
  const existingLock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (existingLock && existingLock.requirementId !== requirementId) {
    throw new HttpError(
      409,
      `测试环境已被占用：需求「${existingLock.requirementTitle || existingLock.requirementId}」（锁定于 ${existingLock.acquiredAt.toISOString().replace('T', ' ').slice(0, 16)}），请等待其部署完成后重试`,
    );
  }
  await prisma.testEnvLock.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', requirementId, requirementTitle: title, branch },
    update: { requirementId, requirementTitle: title, branch, acquiredAt: new Date() },
  });
}

/**
 * Release test environment lock when leaving testing or deploying step.
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
      });
      if (!next) return;

      const wf = next.workflowId
        ? await prisma.workflowTemplate.findUnique({ where: { id: next.workflowId } })
        : null;
      if (!wf) return;

      const wfSteps = parseSteps(wf.steps);
      const hasStep = wfSteps.some((s) => s.name === 'test_env_deploy');
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
