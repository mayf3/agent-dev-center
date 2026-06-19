import { Prisma } from '@prisma/client';
import { TRANSITION_EVENT_TYPE, SYSTEM_KEY_PREFIX } from './transition-types.js';

type TxClient = Prisma.TransactionClient;

export async function handleExpiredLease(
  tx: TxClient,
  leaseId: string,
  ownerUserId: string,
  txNow: Date,
): Promise<boolean> {
  const expiredCount = await tx.executionLease.updateMany({
    where: {
      id: leaseId,
      status: 'ACTIVE',
      expiresAt: { lte: txNow },
    },
    data: {
      status: 'EXPIRED',
      releaseReason: 'expired before transition',
      releasedAt: txNow,
    },
  });
  if (expiredCount.count === 1) {
    await tx.executionLeaseEvent.create({
      data: {
        leaseId,
        eventType: 'EXPIRED',
        idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-expired:${leaseId}`,
        actorId: ownerUserId,
        metadata: { reason: 'expired before transition' },
      },
    });
    return true;
  }
  return false;
}

export async function handleStaleLease(
  tx: TxClient,
  leaseId: string,
  actorId: string,
  txNow: Date,
): Promise<boolean> {
  const staleCount = await tx.executionLease.updateMany({
    where: {
      id: leaseId,
      status: 'ACTIVE',
    },
    data: {
      status: 'FAILED',
      releaseReason: 'lease step/version no longer matches requirement',
      releasedAt: txNow,
    },
  });
  if (staleCount.count === 1) {
    await tx.executionLeaseEvent.create({
      data: {
        leaseId,
        eventType: TRANSITION_EVENT_TYPE.INVALIDATED,
        idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-stale:${leaseId}`,
        actorId,
        metadata: { reason: 'lease step/version no longer matches requirement' },
      },
    });
    return true;
  }
  return false;
}

export async function invalidateActiveLease(
  tx: TxClient,
  requirementId: string,
  actorId: string,
  txNow: Date,
): Promise<boolean> {
  const activeLease = await tx.executionLease.findFirst({
    where: { requirementId, status: 'ACTIVE' },
    select: { id: true, ownerUserId: true },
  });
  if (!activeLease) return false;

  const result = await tx.executionLease.updateMany({
    where: {
      id: activeLease.id,
      status: 'ACTIVE',
    },
    data: {
      status: 'FAILED',
      releaseReason: 'human/manual state transition invalidated lease',
      releasedAt: txNow,
    },
  });
  if (result.count === 1) {
    await tx.executionLeaseEvent.create({
      data: {
        leaseId: activeLease.id,
        eventType: TRANSITION_EVENT_TYPE.INVALIDATED,
        idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-invalidated:${activeLease.id}`,
        actorId,
        metadata: { reason: 'human/manual state transition invalidated lease' },
      },
    });
    return true;
  }
  return false;
}

export async function acquireTestEnvLockInTx(
  tx: TxClient,
  requirementId: string,
  title: string,
  branch: string | null,
): Promise<void> {
  const existingLock = await tx.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (existingLock && existingLock.requirementId !== requirementId) {
    const { HttpError } = await import('../../utils/http-error.js');
    throw new HttpError(
      409,
      `测试环境已被占用：需求「${existingLock.requirementTitle || existingLock.requirementId}」`,
    );
  }
  await tx.testEnvLock.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', requirementId, requirementTitle: title, branch },
    update: { requirementId, requirementTitle: title, branch, acquiredAt: new Date() },
  });
}

export async function releaseTestEnvLockInTx(
  tx: TxClient,
  requirementId: string,
): Promise<boolean> {
  const existingLock = await tx.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (existingLock && existingLock.requirementId === requirementId) {
    await tx.testEnvLock.delete({ where: { id: 'singleton' } });
    return true;
  }
  return false;
}

function nullSafeAgent(agentId: string | null | undefined): string | null {
  return agentId ?? null;
}

export function buildLeaseTerminalPredicate(
  leaseId: string,
  requirementId: string,
  ownerUserId: string,
  ownerAgentId: string | null | undefined,
  sessionId: string,
  workflowStep: string,
  expectedStateVersion: number,
  txNow: Date,
): Record<string, unknown> {
  return {
    id: leaseId,
    requirementId,
    ownerUserId,
    ownerAgentId: nullSafeAgent(ownerAgentId),
    sessionId,
    status: 'ACTIVE',
    expiresAt: { gt: txNow },
    workflowStep,
    expectedStateVersion,
  };
}
