/**
 * Workflow CAS (Compare-And-Swap) Helper
 *
 * Shared transactional primitives for atomic requirement state transitions.
 * All three callers (advance, reject, report rejection) must use these helpers
 * to guarantee:
 *
 *   1. stateVersion CAS — no last-write-wins
 *   2. requirement update + transition.create are in the same transaction
 *   3. partial writes are impossible
 *   4. CAS failure → HTTP 409, no transition written
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import type { PrismaTransactionClient } from './types.js';

export const REQUIREMENT_TRANSITION_SELECT = {
  id: true,
  currentStep: true,
  assigneeId: true,
  assignee: true,
  stateVersion: true,
  status: true,
  rejectReason: true,
  requesterId: true,
  requester: true,
  workflowId: true,
  workflowSnapshot: true,
} satisfies Prisma.RequirementSelect;

/**
 * Read the current requirement row inside a transaction.
 * Use this instead of a stale out-of-tx read when the read
 * feeds into the CAS write below.
 */
export async function txReadRequirement(
  tx: Omit<PrismaTransactionClient, '$transaction'>,
  id: string,
) {
  const req = await tx.requirement.findUnique({
    where: { id },
    select: REQUIREMENT_TRANSITION_SELECT,
  });
  if (!req) throw new HttpError(404, '需求不存在');
  return req;
}

/**
 * CAS-based requirement update inside a transaction.
 *
 * Only succeeds if the current row still has `expectedStateVersion`.
 * On success, increments stateVersion by 1.
 *
 * Returns the updated row (via findUnique after updateMany).
 * Throws HttpError(409) on CAS failure.
 */
export async function casUpdateRequirement(
  tx: Omit<PrismaTransactionClient, '$transaction'>,
  id: string,
  expectedStateVersion: number,
  data: Record<string, unknown>,
) {
  // Use updateMany with WHERE condition for atomic CAS
  const { count } = await tx.requirement.updateMany({
    where: { id, stateVersion: expectedStateVersion },
    data: {
      ...data,
      stateVersion: expectedStateVersion + 1,
    } as any,
  });

  if (count === 0) {
    throw new HttpError(409, '冲突：该需求已被其他操作修改，请重新读取后重试');
  }

  // Return the updated row
  const updated = await tx.requirement.findUnique({
    where: { id },
    select: REQUIREMENT_TRANSITION_SELECT,
  });
  return updated!;
}

/**
 * Create a workflow transition inside a transaction.
 * This is the single source of truth for transition creation.
 */
export async function txCreateTransition(
  tx: Omit<PrismaTransactionClient, '$transaction'>,
  data: Prisma.WorkflowTransitionCreateInput,
) {
  return tx.workflowTransition.create({ data });
}

/**
 * Composite: CAS-update requirement + create transition atomically.
 *
 * Steps:
 *   1. Read requirement (obtains current stateVersion)
 *   2. CAS-update with provided `updateData`
 *   3. Create transition
 *
 * All three steps share the same Prisma transaction client `tx`.
 */
export async function txTransitionRequirement(
  tx: Omit<PrismaTransactionClient, '$transaction'>,
  id: string,
  expectedStateVersion: number,
  updateData: Prisma.RequirementUpdateInput,
  transitionData: Omit<Prisma.WorkflowTransitionCreateInput, 'requirement'> & {
    requirementId: string;
  },
) {
  // 1. CAS update
  const updated = await casUpdateRequirement(tx, id, expectedStateVersion, updateData);

  // 2. Create transition
  await txCreateTransition(tx, {
    ...transitionData,
    requirement: { connect: { id: transitionData.requirementId } },
  } as Prisma.WorkflowTransitionCreateInput);

  return updated;
}
