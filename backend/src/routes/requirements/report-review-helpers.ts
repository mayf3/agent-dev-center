import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { parseSteps } from './workflow-helpers.js';
import { resolveAssigneeForStep, getAssigneeName } from '../../lib/assignee-resolver.js';

export function computeRollbackTarget(
  reportType: string,
  currentStep: string | null,
  workflowSnapshot: unknown,
  workflowSteps: unknown,
): string | null {
  let targetStep: string | null = null;
  if (reportType === 'DEV_SELF_CHECK' || reportType === 'SECURITY_REVIEW') targetStep = 'dev_self_check';
  else if (reportType === 'TEST_REPORT') targetStep = 'testing';
  else if (reportType === 'CTO_REVIEW') targetStep = 'testing';
  else if (reportType === 'DEPLOY_CONFIRM') targetStep = 'cto_review';

  if (!targetStep || !currentStep) return targetStep;

  const src = workflowSnapshot ?? workflowSteps;
  if (!src) return targetStep;

  const steps = parseSteps(src);
  const currentIdx = steps.findIndex(s => s.name === currentStep);
  const targetIdx = steps.findIndex(s => s.name === targetStep);
  return targetIdx >= 0 && targetIdx < currentIdx
    ? targetStep
    : currentIdx > 0 ? steps[currentIdx - 1].name : targetStep;
}

export async function resolveReportRollbackAssignee(
  actualTarget: string,
  requirementId: string,
  workflowId: string | null | undefined,
  workflowSnapshot: unknown,
  workflowSteps: unknown,
  currentAssigneeId: string | null,
  currentAssigneeName: string | null,
): Promise<{ id: string | null; name: string | null }> {
  if (workflowId) {
    const src = (workflowSnapshot ?? workflowSteps) as Prisma.InputJsonValue | undefined;
    if (src) {
      const steps = parseSteps(src);
      const step = steps.find(s => s.name === actualTarget);
      if (step?.role) {
        const resolvedId = await resolveAssigneeForStep(step.role, currentAssigneeId);
        if (resolvedId) {
          const resolvedName = await getAssigneeName(resolvedId);
          return { id: resolvedId, name: resolvedName };
        }
      }
    }
  }

  const lastRevision = await prisma.requirementRevision.findFirst({
    where: { requirementId, assignee: { not: null }, status: { in: ['in_progress', 'testing'] } },
    orderBy: { createdAt: 'desc' }, select: { assignee: true },
  });
  if (lastRevision?.assignee) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ name: lastRevision.assignee }, { email: lastRevision.assignee }] },
      select: { id: true, name: true },
    });
    return user ? { id: user.id, name: user.name } : { id: currentAssigneeId, name: lastRevision.assignee };
  }

  if (currentAssigneeName) {
    return { id: currentAssigneeId, name: currentAssigneeName };
  }

  return { id: currentAssigneeId, name: currentAssigneeName };
}
