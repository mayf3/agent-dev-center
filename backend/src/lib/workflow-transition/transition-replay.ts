import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../../utils/http-error.js';
import type { ActorInfo, ExecutionProof, TransitionResult } from './transition-types.js';
import { TRANSITION_EVENT_TYPE } from './transition-types.js';

export interface ScopedAdvanceInput {
  requirementId: string;
  actor: ActorInfo;
  execution: ExecutionProof;
  requestedBranch: string | null | undefined;
  comment: string | undefined;
  fromStep?: string;
  toStep?: string;
}

export interface ScopedRejectInput {
  requirementId: string;
  actor: ActorInfo;
  execution: ExecutionProof;
  comment: string | undefined;
  fromStep?: string;
  toStep?: string;
  targetStep: string | undefined;
}

interface ReplayAdvanceMeta {
  fromStep: string;
  toStep: string;
  toStepDisplayName: string | null;
  expectedStateVersion: number;
  newStateVersion: number;
  newAssigneeId: string | null;
  newAssigneeName: string | null;
  comment: string | null;
  requestedBranch: string | null;
  effectiveBranch: string | null;
  lockReleased: boolean;
  isDone: boolean;
}

interface ReplayRejectMeta {
  fromStep: string;
  toStep: string;
  expectedStateVersion: number;
  newStateVersion: number;
  newAssigneeId: string | null;
  newAssigneeName: string | null;
  comment: string | null;
  targetStep: string | null;
  lockReleased: boolean;
  isDone: boolean;
}

function nullSafeOwnerAgent(agentId: string | null | undefined): string | null {
  return agentId ?? null;
}

function validateOwnerAgent(leaseOwnerAgentId: string | null | undefined, actorAgentId: string | null | undefined): void {
  if (nullSafeOwnerAgent(leaseOwnerAgentId) !== nullSafeOwnerAgent(actorAgentId)) {
    throw new HttpError(409, 'idempotencyKey used with different ownerAgentId');
  }
}

export async function tryReplayAdvance(input: ScopedAdvanceInput): Promise<TransitionResult | null> {
  const event = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey: input.execution.idempotencyKey },
    include: { lease: true },
  });
  if (!event) return null;
  return validateAndReplayAdvance(event, input);
}

function validateAndReplayAdvance(event: any, input: ScopedAdvanceInput): TransitionResult {
  const lease = event.lease;
  const meta: ReplayAdvanceMeta = event.metadata ?? {};

  if (event.eventType !== TRANSITION_EVENT_TYPE.ADVANCED) {
    throw new HttpError(409, 'idempotencyKey already used for a different operation type');
  }
  if (lease.requirementId !== input.requirementId) {
    throw new HttpError(409, 'idempotencyKey used for different requirement');
  }
  if (lease.id !== input.execution.leaseId) {
    throw new HttpError(409, 'idempotencyKey used for different lease');
  }
  if (lease.ownerUserId !== input.actor.id) {
    throw new HttpError(409, 'idempotencyKey used for different actor');
  }
  validateOwnerAgent(lease.ownerAgentId, input.actor.agentId);
  if (lease.sessionId !== input.execution.sessionId) {
    throw new HttpError(409, 'idempotencyKey used for different session');
  }
  if (meta.expectedStateVersion !== input.execution.expectedStateVersion) {
    throw new HttpError(409, 'idempotencyKey used with different expectedStateVersion');
  }
  if (input.fromStep && meta.fromStep && meta.fromStep !== input.fromStep) {
    throw new HttpError(409, 'idempotencyKey used with different fromStep');
  }
  if (input.toStep && meta.toStep && meta.toStep !== input.toStep) {
    throw new HttpError(409, 'idempotencyKey used with different target step');
  }
  if ((meta.requestedBranch ?? null) !== (input.requestedBranch ?? null)) {
    throw new HttpError(409, 'idempotencyKey used with different branch');
  }
  if ((meta.comment ?? null) !== (input.comment ?? null)) {
    throw new HttpError(409, 'idempotencyKey used with different comment');
  }

  return {
    requirementId: input.requirementId,
    fromStep: meta.fromStep ?? input.fromStep ?? '',
    toStep: meta.toStep,
    toStepDisplayName: meta.toStepDisplayName ?? '',
    newStateVersion: meta.newStateVersion ?? (lease.requirement?.stateVersion ?? 0) + 1,
    newAssigneeId: meta.newAssigneeId ?? null,
    newAssigneeName: meta.newAssigneeName ?? null,
    replayed: true,
    lockReleased: !!meta.lockReleased,
    isDone: !!meta.isDone,
  };
}

export async function tryReplayReject(input: ScopedRejectInput): Promise<TransitionResult | null> {
  const event = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey: input.execution.idempotencyKey },
    include: { lease: true },
  });
  if (!event) return null;
  return validateAndReplayReject(event, input);
}

function validateAndReplayReject(event: any, input: ScopedRejectInput): TransitionResult {
  const lease = event.lease;
  const meta: ReplayRejectMeta = event.metadata ?? {};

  if (event.eventType !== TRANSITION_EVENT_TYPE.REJECTED) {
    throw new HttpError(409, 'idempotencyKey already used for a different operation type');
  }
  if (lease.requirementId !== input.requirementId) {
    throw new HttpError(409, 'idempotencyKey used for different requirement');
  }
  if (lease.id !== input.execution.leaseId) {
    throw new HttpError(409, 'idempotencyKey used for different lease');
  }
  if (lease.ownerUserId !== input.actor.id) {
    throw new HttpError(409, 'idempotencyKey used for different actor');
  }
  validateOwnerAgent(lease.ownerAgentId, input.actor.agentId);
  if (lease.sessionId !== input.execution.sessionId) {
    throw new HttpError(409, 'idempotencyKey used for different session');
  }
  if (meta.expectedStateVersion !== input.execution.expectedStateVersion) {
    throw new HttpError(409, 'idempotencyKey used with different expectedStateVersion');
  }
  if (input.fromStep && meta.fromStep && meta.fromStep !== input.fromStep) {
    throw new HttpError(409, 'idempotencyKey used with different fromStep');
  }
  if (input.toStep && meta.toStep && meta.toStep !== input.toStep) {
    throw new HttpError(409, 'idempotencyKey used with different target step');
  }
  if ((meta.targetStep ?? null) !== (input.targetStep ?? null)) {
    throw new HttpError(409, 'idempotencyKey used with different targetStep');
  }
  if ((meta.comment ?? null) !== (input.comment ?? null)) {
    throw new HttpError(409, 'idempotencyKey used with different comment');
  }

  return {
    requirementId: input.requirementId,
    fromStep: meta.fromStep ?? input.fromStep,
    toStep: meta.toStep,
    newStateVersion: meta.newStateVersion ?? (lease.requirement?.stateVersion ?? 0) + 1,
    newAssigneeId: meta.newAssigneeId ?? null,
    newAssigneeName: meta.newAssigneeName ?? null,
    replayed: true,
    lockReleased: !!meta.lockReleased,
    isDone: false,
  };
}

export async function tryReplayAdvanceByKey(
  idempotencyKey: string,
  input: ScopedAdvanceInput,
): Promise<TransitionResult | null> {
  const event = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey },
    include: { lease: true },
  });
  if (!event) return null;
  return validateAndReplayAdvance(event, input);
}

export async function tryReplayRejectByKey(
  idempotencyKey: string,
  input: ScopedRejectInput,
): Promise<TransitionResult | null> {
  const event = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey },
    include: { lease: true },
  });
  if (!event) return null;
  return validateAndReplayReject(event, input);
}
