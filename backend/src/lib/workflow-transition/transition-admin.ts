import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { invalidateActiveLease } from './transition-utils.js';

export interface AdminTransitionInput {
  requirementId: string;
  fromStep: string | null;
  toStep: string;
  expectedStateVersion: number;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  comment?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  rejectReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdminTransitionResult {
  requirementId: string;
  fromStep: string | null;
  toStep: string;
  newStateVersion: number;
  newAssigneeId: string | null;
}

export async function applyAdminTransitionInTx(
  txPrisma: Prisma.TransactionClient,
  input: AdminTransitionInput,
  txNow: Date,
): Promise<AdminTransitionResult> {
  const requirement = await txPrisma.requirement.findUnique({
    where: { id: input.requirementId },
    select: { id: true, currentStep: true, stateVersion: true, assigneeId: true },
  });
  if (!requirement) throw new HttpError(404, 'requirement not found');

  const fromMatch = input.fromStep === null
    ? { currentStep: null }
    : { currentStep: input.fromStep };
  const updateResult = await txPrisma.requirement.updateMany({
    where: { id: input.requirementId, ...fromMatch, stateVersion: input.expectedStateVersion },
    data: {
      currentStep: input.toStep,
      stateVersion: { increment: 1 },
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId, assignee: input.assigneeName ?? null } : {}),
      ...(input.rejectReason !== undefined ? { rejectReason: input.rejectReason } : {}),
    },
  });
  if (updateResult.count === 0) {
    const stillExists = await txPrisma.requirement.findUnique({
      where: { id: input.requirementId }, select: { id: true },
    });
    if (!stillExists) throw new HttpError(404, 'requirement not found');
    throw new HttpError(409, 'concurrent modification: requirement state changed');
  }

  const newStateVersion = input.expectedStateVersion + 1;

  await txPrisma.workflowTransition.create({
    data: {
      requirementId: input.requirementId,
      fromStep: input.fromStep ?? '',
      toStep: input.toStep,
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      comment: input.comment ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  await invalidateActiveLease(txPrisma, input.requirementId, input.actorId, txNow);

  return {
    requirementId: input.requirementId,
    fromStep: input.fromStep,
    toStep: input.toStep,
    newStateVersion,
    newAssigneeId: input.assigneeId ?? requirement.assigneeId,
  };
}

export async function executeAdminTransition(
  input: AdminTransitionInput,
): Promise<AdminTransitionResult> {
  return prisma.$transaction(async (tx) => {
    const txPrisma = tx as Prisma.TransactionClient;
    return applyAdminTransitionInTx(txPrisma, input, new Date());
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
