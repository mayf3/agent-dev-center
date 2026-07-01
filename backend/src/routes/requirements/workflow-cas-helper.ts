/**
 * Workflow CAS (Compare-And-Swap) Helper
 *
 * Shared transactional primitives for atomic requirement state transitions.
 */
import { HttpError } from '../../utils/http-error.js';
import type { PrismaTransactionClient } from './types.js';

export const REQUIREMENT_TRANSITION_SELECT = {
  id: true, currentStep: true, assigneeId: true, assignee: true,
  stateVersion: true, status: true, rejectReason: true,
  requesterId: true, requester: true, workflowId: true, workflowSnapshot: true,
} as const;

export async function txReadRequirement(
  tx: PrismaTransactionClient, id: string,
) {
  const req = await tx.requirement.findUnique({ where: { id }, select: REQUIREMENT_TRANSITION_SELECT });
  if (!req) throw new HttpError(404, '需求不存在');
  return req;
}

export async function casUpdateRequirement(
  tx: PrismaTransactionClient, id: string,
  expectedStateVersion: number, data: Record<string, unknown>,
) {
  const { count } = await tx.requirement.updateMany({
    where: { id, stateVersion: expectedStateVersion },
    data: { ...data, stateVersion: expectedStateVersion + 1 } as any,
  });
  if (count === 0) throw new HttpError(409, '冲突：该需求已被其他操作修改，请重新读取后重试');
  const updated = await tx.requirement.findUnique({ where: { id }, select: REQUIREMENT_TRANSITION_SELECT });
  return updated!;
}

export async function txCreateTransition(
  tx: PrismaTransactionClient,
  data: Record<string, unknown>,
) {
  return tx.workflowTransition.create({ data } as any);
}
