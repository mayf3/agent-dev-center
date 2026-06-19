import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { invalidateActiveLease } from './transition-utils.js';

export interface AssignTransitionInput {
  requirementId: string;
  fromStep: string | null;
  toStep: string;
  toStepDisplayName: string;
  expectedStateVersion: number;
  workflowId: string;
  workflowName: string;
  workflowDisplayName: string;
  workflowSnapshot: Prisma.InputJsonValue;
  assigneeId: string | null;
  actorId: string;
  actorName: string;
  actorRole: string;
  startStep?: string | null;
  steps: Array<{ name: string; displayName: string; role: string; requiredReports?: string[] }>;
}

export interface AssignTransitionResult {
  stateVersion: number;
  workflowId: string;
  workflowName: string;
  workflowDisplayName: string;
  currentStep: string;
  currentStepDisplayName: string;
  steps: Array<{ name: string; displayName: string; role: string; requiredReports?: string[] }>;
}

export async function executeAssignTransition(
  input: AssignTransitionInput,
): Promise<AssignTransitionResult> {
  return prisma.$transaction(async (tx) => {
    const txPrisma = tx as Prisma.TransactionClient;
    const fromMatch = input.fromStep === null
      ? { currentStep: null }
      : { currentStep: input.fromStep };
    const updateCount = await txPrisma.requirement.updateMany({
      where: { id: input.requirementId, ...fromMatch, stateVersion: input.expectedStateVersion },
      data: {
        workflowId: input.workflowId,
        workflowSnapshot: input.workflowSnapshot,
        currentStep: input.toStep,
        assigneeId: input.assigneeId,
        stateVersion: { increment: 1 },
      },
    });
    if (updateCount.count === 0) {
      const stillExists = await txPrisma.requirement.findUnique({
        where: { id: input.requirementId }, select: { id: true },
      });
      if (!stillExists) throw new HttpError(404, 'requirement not found');
      throw new HttpError(409, 'concurrent modification: requirement state changed');
    }

    await txPrisma.workflowTransition.create({
      data: {
        requirementId: input.requirementId,
        fromStep: input.fromStep ?? '',
        toStep: input.toStep,
        action: 'assign-workflow',
        actorId: input.actorId,
        actorName: input.actorName,
        actorRole: input.actorRole,
        metadata: { workflowName: input.workflowName, templateId: input.workflowId, startStep: input.startStep ?? null },
      },
    });

    await invalidateActiveLease(txPrisma, input.requirementId, input.actorId, new Date());

    const newStateVersion = input.expectedStateVersion + 1;

    return {
      stateVersion: newStateVersion,
      workflowId: input.workflowId,
      workflowName: input.workflowName,
      workflowDisplayName: input.workflowDisplayName,
      currentStep: input.toStep,
      currentStepDisplayName: input.toStepDisplayName,
      steps: input.steps,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
