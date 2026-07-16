/**
 * Workflow Assign Service (Kernel Phase 2A)
 *
 * Atomically assigns a workflow to a requirement:
 *  - Reads the current requirement + template inside a transaction
 *  - Deep-copies the template steps as workflowSnapshot
 *  - Increments stateVersion via CAS
 *  - Writes workflowId, workflowSnapshot, currentStep, assigneeId together
 *
 * This guarantees that generic PATCH /:id cannot bypass snapshot creation,
 * and that two concurrent assigns for the same requirement cannot both succeed.
 */
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { parseSteps, getWorkflowSteps, extractRoleUserMap } from './workflow-helpers.js';
import { resolveAssigneeForStep } from '../../lib/assignee-resolver.js';

export interface AssignWorkflowResult {
  requirementId: string;
  workflowId: string;
  workflowSnapshot: unknown;
  currentStep: string;
  assigneeId: string | null;
  stateVersion: number;
  templateSteps: unknown;
}

export interface AssignWorkflowAtomicOpts {
  /** Hook called right before CAS, after all reads + assignee resolution.
   *  Used by tests to synchronize concurrent assignment attempts. */
  beforeCas?: () => Promise<void>;
  /** Optional Prisma client override for tests (KERNEL_TEST_DATABASE_URL). */
  prisma?: typeof import('../../lib/prisma.js').prisma;
}

/**
 * Perform an atomic workflow assignment inside a Prisma interactive transaction.
 *
 * @param requirementId - The requirement to assign.
 * @param workflowName  - The workflow template name.
 * @param startStep     - Optional step name to start at (default = first step).
 * @param opts          - Optional hooks for testability.
 * @returns The assigned result, including the frozen snapshot.
 */
export async function assignWorkflowAtomic(
  requirementId: string,
  workflowName: string,
  startStep?: string,
  opts?: AssignWorkflowAtomicOpts,
): Promise<AssignWorkflowResult> {
  const client = opts?.prisma ?? prisma;
  // Run the entire operation inside a transaction for atomicity
  return client.$transaction(async (tx) => {
    // 1. Read the requirement inside the transaction (with stateVersion)
    const requirement = await tx.requirement.findUnique({
      where: { id: requirementId },
      select: {
        id: true,
        workflowId: true,
        workflowSnapshot: true,
        currentStep: true,
        assigneeId: true,
        requesterId: true,
        stateVersion: true,
      },
    });
    if (!requirement) throw new HttpError(404, '需求不存在');

    // 2. Enforce "assign once" – do not silently overwrite
    if (requirement.workflowId) {
      throw new HttpError(409, '该需求已有工作流，请勿重复分配');
    }

    // 3. Read the template (inside tx so template is not swapped mid-flight)
    const template = await tx.workflowTemplate.findFirst({
      where: { name: workflowName, isActive: true },
      select: { id: true, steps: true, displayName: true },
    });
    if (!template) {
      throw new HttpError(404, `工作流模板「${workflowName}」不存在或已停用`);
    }

    // 4. Validate template structure (must be consumable by snapshot helpers)
    const steps = getWorkflowSteps(template.steps as any);
    if (steps.length === 0) {
      throw new HttpError(400, '工作流模板无有效步骤');
    }

    // 5. Deep clone the raw steps JSON as the immutable snapshot
    const workflowSnapshot: unknown = JSON.parse(JSON.stringify(template.steps));

    // 6. Determine starting step
    let targetStepName: string;
    if (startStep) {
      const found = steps.find(s => s.name === startStep);
      if (!found) {
        throw new HttpError(400, `工作流中不存在步骤「${startStep}」`);
      }
      targetStepName = startStep;
    } else {
      targetStepName = steps[0].name;
    }

    // 7. Resolve assignee from the snapshot, not the live template
    const rawJson = template.steps;
    const roleUserMap: Record<string, string> | undefined = extractRoleUserMap(rawJson as any);
    const stepRole = steps.find(s => s.name === targetStepName)?.role;

    let assigneeId: string | null = null;
    if (stepRole === 'requester' && requirement.requesterId) {
      // Draft step: assign to requester
      assigneeId = requirement.requesterId;
    } else if (stepRole && roleUserMap?.[stepRole]) {
      // Use roleUserMap from snapshot
      assigneeId = roleUserMap[stepRole];
    } else if (stepRole) {
      // Standard role resolution (from the snapshot, not live template)
      // Kernel Phase 2A fixup: use tx client so assignee resolution is inside the transaction
      assigneeId = await resolveAssigneeForStep(stepRole, requirement.assigneeId, tx as any);
    }

    // Test hook: barrier point right before CAS
    if (opts?.beforeCas) {
      await opts.beforeCas();
    }

    // 8. CAS: compare-and-swap using current stateVersion
    const expectedStateVersion = requirement.stateVersion;
    const newStateVersion = expectedStateVersion + 1;

    const updateResult = await tx.requirement.updateMany({
      where: {
        id: requirementId,
        stateVersion: expectedStateVersion,
      },
      data: {
        workflowId: template.id,
        workflowSnapshot: workflowSnapshot as any,
        currentStep: targetStepName,
        assigneeId,
        stateVersion: newStateVersion,
      },
    });

    if (updateResult.count === 0) {
      throw new HttpError(409, '并发冲突：该需求已被其他请求更新，请重试');
    }

    return {
      requirementId,
      workflowId: template.id,
      workflowSnapshot,
      currentStep: targetStepName,
      assigneeId,
      stateVersion: newStateVersion,
      templateSteps: template.steps,
    };
  });
}
