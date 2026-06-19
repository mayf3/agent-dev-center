import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../../utils/http-error.js';
import type { ExecutionProof, ActorInfo, TransitionResult, LockAction, TransitionSentinel } from './transition-types.js';
import { TRANSITION_EVENT_TYPE, isExpiredSentinel, isStaleSentinel } from './transition-types.js';
import { handleExpiredLease, handleStaleLease, invalidateActiveLease, releaseTestEnvLockInTx, buildLeaseTerminalPredicate } from './transition-utils.js';
import { tryReplayRejectByKey } from './transition-replay.js';

interface RejectParams {
  requirementId: string; fromStep: string; toStep: string;
  stateVersion: number; newAssigneeId: string | null; newAssigneeName: string | null;
  comment: string; targetStep?: string; actor: ActorInfo;
  execution?: ExecutionProof; lockAction: LockAction; requesterId?: string | null;
}

export async function executeRejectTransition(params: RejectParams): Promise<TransitionResult> {
  if (params.execution) {
    const replayed = await tryReplayRejectByKey(params.execution.idempotencyKey, {
      requirementId: params.requirementId,
      actor: params.actor,
      execution: params.execution,
      comment: params.comment,
      fromStep: params.fromStep,
      toStep: params.toStep,
      targetStep: params.targetStep,
    });
    if (replayed) return replayed;
  }

  let result: unknown;
  try {
    result = await prisma.$transaction<TransitionResult | TransitionSentinel>(async (tx) => {
    const txNow = new Date();
    const txPrisma = tx as Prisma.TransactionClient;
    const requirement = await txPrisma.requirement.findUnique({
      where: { id: params.requirementId },
      select: { id: true, currentStep: true, stateVersion: true, assigneeId: true },
    });
    if (!requirement) throw new HttpError(404, 'requirement not found');
    let leaseIdFromDb: string | null = null;
    let leaseOwnerAgentId: string | null | undefined = null;
    let leaseExpectedStateVersion = 0;
    if (params.execution) {
      const leaseRow = await txPrisma.executionLease.findUnique({
        where: { id: params.execution.leaseId },
        select: { id: true, requirementId: true, ownerUserId: true, ownerAgentId: true,
          sessionId: true, status: true, expiresAt: true, workflowStep: true, expectedStateVersion: true },
      });
      if (!leaseRow) throw new HttpError(404, 'execution lease not found');
      if (leaseRow.requirementId !== params.requirementId) throw new HttpError(409, 'lease not for this req');
      if (leaseRow.ownerUserId !== params.actor.id) throw new HttpError(409, 'lease owned by different user');
      if ((leaseRow.ownerAgentId ?? null) !== (params.actor.agentId ?? null)) throw new HttpError(409, 'lease owned by different agent');
      if (leaseRow.sessionId !== params.execution.sessionId) throw new HttpError(409, 'session mismatch');
      if (params.execution.expectedStateVersion !== leaseRow.expectedStateVersion) throw new HttpError(409, 'proof expectedStateVersion does not match lease');
      if (leaseRow.status !== 'ACTIVE') throw new HttpError(409, `lease not active: ${leaseRow.status}`);
      if (leaseRow.expiresAt <= txNow) {
        const expired = await handleExpiredLease(txPrisma, leaseRow.id, params.actor.id, txNow);
        if (expired) return { __expired: true, reason: 'execution lease has expired' };
      }
      if (requirement.stateVersion !== leaseRow.expectedStateVersion) {
        if (await handleStaleLease(txPrisma, leaseRow.id, params.actor.id, txNow))
          return { __stale: true, reason: 'requirement stateVersion drifted from lease' };
        throw new HttpError(409, 'requirement stateVersion does not match lease expectedStateVersion');
      }
      if (requirement.currentStep !== leaseRow.workflowStep) {
        if (await handleStaleLease(txPrisma, leaseRow.id, params.actor.id, txNow))
          return { __stale: true, reason: 'requirement currentStep drifted from lease' };
        throw new HttpError(409, 'requirement currentStep does not match lease workflowStep');
      }
      if (requirement.assigneeId !== params.actor.id) {
        if (await handleStaleLease(txPrisma, leaseRow.id, params.actor.id, txNow))
          return { __stale: true, reason: 'requirement assignee drifted from lease' };
        throw new HttpError(409, 'requirement assignee does not match actor');
      }
      if (requirement.currentStep !== params.fromStep) throw new HttpError(409, 'currentStep mismatch');
      if (requirement.stateVersion !== params.stateVersion) throw new HttpError(409, 'stateVersion mismatch');
      leaseIdFromDb = leaseRow.id;
      leaseOwnerAgentId = leaseRow.ownerAgentId;
      leaseExpectedStateVersion = leaseRow.expectedStateVersion;
    } else {
      if (requirement.currentStep !== params.fromStep) throw new HttpError(409, 'currentStep mismatch');
      if (requirement.stateVersion !== params.stateVersion) throw new HttpError(409, 'stateVersion mismatch');
    }

    const updateData: Record<string, unknown> = {
      currentStep: params.toStep,
      assigneeId: params.newAssigneeId,
      stateVersion: { increment: 1 },
    };
    if (params.requesterId !== undefined) {
      updateData.requesterId = params.requesterId;
    }

    const updateResult = await txPrisma.requirement.updateMany({
      where: { id: params.requirementId, currentStep: params.fromStep, stateVersion: params.stateVersion },
      data: updateData,
    });
    if (updateResult.count === 0) throw new HttpError(409, 'concurrent modification: requirement state changed');
    const updatedRequirement = await txPrisma.requirement.findUnique({
      where: { id: params.requirementId },
      select: { stateVersion: true },
    });
    const newStateVersion = updatedRequirement?.stateVersion ?? params.stateVersion + 1;

    await txPrisma.workflowTransition.create({
      data: {
        requirementId: params.requirementId,
        fromStep: params.fromStep,
        toStep: params.toStep,
        action: 'reject',
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        comment: params.comment,
        metadata: { targetStep: params.targetStep ?? null },
      },
    });

    let lockReleased = false;
    if (params.lockAction.type === 'release') {
      lockReleased = await releaseTestEnvLockInTx(txPrisma, params.requirementId);
    }

    if (params.execution && leaseIdFromDb) {
      const terminalPredicate = buildLeaseTerminalPredicate(
        leaseIdFromDb, params.requirementId, params.actor.id,
        leaseOwnerAgentId, params.execution.sessionId,
        params.fromStep, leaseExpectedStateVersion, txNow,
      );
      const termResult = await txPrisma.executionLease.updateMany({
        where: terminalPredicate,
        data: { status: 'FAILED', releasedAt: txNow, releaseReason: 'reject transition completed' },
      });
      if (termResult.count !== 1) {
        throw new HttpError(409, 'lease terminalization failed: lease state changed');
      }
      await txPrisma.executionLeaseEvent.create({
        data: {
          leaseId: leaseIdFromDb,
          eventType: TRANSITION_EVENT_TYPE.REJECTED,
          idempotencyKey: (params.execution as ExecutionProof).idempotencyKey,
          actorId: params.actor.id,
          metadata: {
            fromStep: params.fromStep,
            toStep: params.toStep,
            expectedStateVersion: params.execution.expectedStateVersion,
            newStateVersion,
            newAssigneeId: params.newAssigneeId,
            newAssigneeName: params.newAssigneeName,
            comment: params.comment,
            targetStep: params.targetStep ?? null,
            lockReleased,
            isDone: false,
          },
        },
      });
    } else {
      await invalidateActiveLease(txPrisma, params.requirementId, params.actor.id, txNow);
    }

    return {
      requirementId: params.requirementId,
      fromStep: params.fromStep,
      toStep: params.toStep,
      newStateVersion,
      newAssigneeId: params.newAssigneeId,
      newAssigneeName: params.newAssigneeName,
      replayed: false,
      lockReleased,
      isDone: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (isExpiredSentinel(result)) throw new HttpError(409, result.reason);
  if (isStaleSentinel(result)) throw new HttpError(409, result.reason);

  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === 'P2002') {
      if (params.execution) {
        const replayed = await tryReplayRejectByKey(params.execution.idempotencyKey, {
          requirementId: params.requirementId,
          actor: params.actor,
          execution: params.execution,
          comment: params.comment,
          fromStep: params.fromStep,
          toStep: params.toStep,
          targetStep: params.targetStep,
        });
        if (replayed) return replayed;
      }
      throw new HttpError(409, 'concurrent conflict, please retry');
    }
    if (prismaErr.code === 'P2034') {
      if (params.execution) {
        const replayed = await tryReplayRejectByKey(params.execution.idempotencyKey, {
          requirementId: params.requirementId,
          actor: params.actor,
          execution: params.execution,
          comment: params.comment,
          fromStep: params.fromStep,
          toStep: params.toStep,
          targetStep: params.targetStep,
        });
        if (replayed) return replayed;
      }
      throw new HttpError(409, 'serialization conflict, please retry');
    }
    if (err instanceof HttpError) throw err;
    throw err;
  }

  return result as TransitionResult;
}
