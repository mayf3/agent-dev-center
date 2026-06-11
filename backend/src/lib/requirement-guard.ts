/**
 * Requirement Guard — Prisma extension that prevents drift at the DB level.
 *
 * When `currentStep` changes on a requirement that has a `workflowId`,
 * this guard automatically resolves the correct `assigneeId`/`assignee`
 * using `resolveAssigneeForStep`. This ensures drift is impossible
 * even if someone bypasses the API layer and writes to the DB directly
 * through Prisma.
 *
 * It does NOT block the write — it just corrects the assignee.
 */

import { Prisma } from '@prisma/client';
import { resolveAssigneeForStep, getAssigneeName } from './assignee-resolver.js';

// Cache workflow steps in-memory (refreshed every 5 minutes)
const workflowCache = new Map<string, { steps: any[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function getWorkflowSteps(prisma: any, workflowId: string): Promise<any[]> {
  const cached = workflowCache.get(workflowId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.steps;
  }
  const wf = await prisma.workflowTemplate.findUnique({
    where: { id: workflowId },
    select: { steps: true },
  });
  const steps = (wf?.steps as any[]) ?? [];
  workflowCache.set(workflowId, { steps, fetchedAt: Date.now() });
  return steps;
}

/**
 * Apply the requirement guard as a Prisma $extends extension.
 * Usage: prisma.$extends(requirementGuardExtension())
 */
export function requirementGuardExtension() {
  return Prisma.defineExtension({
    name: 'requirementGuard',
    query: {
      requirement: {
        async update({ args, query, model }) {
          const data = args.data as any;
          // Only intercept when currentStep is being changed
          if (data?.currentStep === undefined && data?.currentStep?.set === undefined) {
            return query(args);
          }

          // Get current state to find workflowId
          const existing = await (model as any).findUnique({
            where: args.where,
            select: { id: true, workflowId: true, currentStep: true, assigneeId: true },
          });
          if (!existing?.workflowId) {
            return query(args); // No workflow = no guard needed
          }

          const newStep = data.currentStep?.set ?? data.currentStep;
          if (newStep === existing.currentStep) {
            return query(args); // No change = no guard needed
          }

          // Look up the target step's role from the workflow
          const steps = await getWorkflowSteps((model as any), existing.workflowId);
          const targetStep = steps.find((s: any) => s.name === newStep);

          if (targetStep?.role) {
            const resolvedId = await resolveAssigneeForStep(targetStep.role, existing.assigneeId);
            if (resolvedId) {
              const resolvedName = await getAssigneeName(resolvedId);
              // Inject resolved assignee into the update
              data.assigneeId = resolvedId;
              data.assignee = resolvedName;
            }
          }

          return query(args);
        },
      },
    },
  });
}
