import { PrismaClient, Prisma } from '@prisma/client';
import { HttpError } from '../../utils/http-error.js';
import { LEASE_INCLUDE, LeaseWithDetails, LeaseEventWithDetails, EVENT_TYPE, ReleaseBody, SYSTEM_KEY_PREFIX } from './lease-constants.js';

export async function releaseExecutionLease(
  prisma: PrismaClient,
  requirementId: string,
  leaseId: string,
  ownerUserId: string,
  ownerAgentId: string | null | undefined,
  body: ReleaseBody,
): Promise<LeaseWithDetails> {
  if (body.idempotencyKey.startsWith(SYSTEM_KEY_PREFIX)) throw new HttpError(400, 'idempotencyKey cannot start with system:');

  const existingEvent = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    include: { lease: { include: LEASE_INCLUDE } },
  });
  if (existingEvent) {
    return validateAndReplayRelease(existingEvent, requirementId, leaseId, ownerUserId, ownerAgentId, body);
  }

  const targetStatus = body.outcome === 'SUCCEEDED' ? 'RELEASED' : 'FAILED';
  const eventType = body.outcome === 'SUCCEEDED' ? EVENT_TYPE.RELEASED
    : body.outcome === 'FAILED' ? EVENT_TYPE.FAILED : EVENT_TYPE.ABANDONED;

  const txResult = await prisma.$transaction<LeaseWithDetails | { __expired: true; reason: string }>(async (tx) => {
    const txPrisma = tx as Prisma.TransactionClient;
    const txNow = new Date();
    const result = await txPrisma.executionLease.updateMany({
      where: {
        id: leaseId, requirementId, ownerUserId,
        ownerAgentId: ownerAgentId ?? null,
        sessionId: body.sessionId,
        status: 'ACTIVE', expiresAt: { gt: txNow },
      },
      data: { status: targetStatus, releasedAt: txNow, releaseReason: body.reason ?? body.outcome },
    });

    if (result.count === 0) {
      const lease = await txPrisma.executionLease.findUnique({
        where: { id: leaseId },
        select: { id: true, requirementId: true, ownerUserId: true, ownerAgentId: true, sessionId: true, status: true, expiresAt: true },
      });
      if (!lease) throw new HttpError(404, 'execution lease not found');
      if (lease.requirementId !== requirementId) throw new HttpError(409, 'lease does not belong to this requirement');
      if (lease.ownerUserId !== ownerUserId) throw new HttpError(403, 'only the lease owner can release');
      if ((lease.ownerAgentId ?? null) !== (ownerAgentId ?? null)) throw new HttpError(403, 'lease owned by different agent');
      if (lease.sessionId !== body.sessionId) throw new HttpError(403, 'session mismatch');
      if (lease.status !== 'ACTIVE') throw new HttpError(409, `lease is already in terminal state: ${lease.status}`);

      if (lease.expiresAt <= txNow) {
        const expiredCount = await txPrisma.executionLease.updateMany({
          where: { id: leaseId, status: 'ACTIVE', expiresAt: { lte: txNow } },
          data: { status: 'EXPIRED', releaseReason: 'expired before release', releasedAt: txNow },
        });
        if (expiredCount.count === 1) {
          await txPrisma.executionLeaseEvent.create({
            data: { leaseId, eventType: EVENT_TYPE.EXPIRED,
              idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-expired:${leaseId}`,
              actorId: ownerUserId,
              metadata: { reason: 'expired before release' },
            },
          });
        }
        return { __expired: true, reason: 'lease has expired and cannot be released' };
      }
      throw new HttpError(409, 'lease cannot be released');
    }

    const updated = await txPrisma.executionLease.findUnique({
      where: { id: leaseId }, include: LEASE_INCLUDE,
    });

    await txPrisma.executionLeaseEvent.create({
      data: { leaseId, eventType, idempotencyKey: body.idempotencyKey, actorId: ownerUserId,
        metadata: { outcome: body.outcome, reason: body.reason ?? null },
      },
    });

    return updated as LeaseWithDetails;
  });

  if ('__expired' in txResult) throw new HttpError(409, txResult.reason);
  return txResult;
}

function validateAndReplayRelease(
  existingEvent: LeaseEventWithDetails,
  requirementId: string,
  leaseId: string,
  ownerUserId: string,
  ownerAgentId: string | null | undefined,
  body: { sessionId: string; outcome: string; reason?: string },
): LeaseWithDetails {
  const lease = existingEvent.lease;
  const meta = (existingEvent.metadata ?? {}) as Record<string, unknown>;
  if (existingEvent.eventType !== EVENT_TYPE.RELEASED &&
      existingEvent.eventType !== EVENT_TYPE.FAILED &&
      existingEvent.eventType !== EVENT_TYPE.ABANDONED) {
    throw new HttpError(409, 'idempotencyKey already used for a different operation');
  }
  if (lease.requirementId !== requirementId) throw new HttpError(409, 'idempotencyKey used for different requirement');
  if (lease.id !== leaseId) throw new HttpError(409, 'idempotencyKey used for different lease');
  if (lease.ownerUserId !== ownerUserId) throw new HttpError(409, 'idempotencyKey used for different actor');
  if ((lease.ownerAgentId ?? null) !== (ownerAgentId ?? null)) throw new HttpError(409, 'idempotencyKey used with different ownerAgentId');
  if (lease.sessionId !== body.sessionId) throw new HttpError(409, 'idempotencyKey used for different session');
  if (meta.outcome !== body.outcome) throw new HttpError(409, 'idempotencyKey used with different outcome');
  if ((meta.reason ?? null) !== (body.reason ?? null)) throw new HttpError(409, 'idempotencyKey used with different reason');
  return lease as LeaseWithDetails;
}
