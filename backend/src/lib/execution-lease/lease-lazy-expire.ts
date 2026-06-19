import { PrismaClient, Prisma } from '@prisma/client';
import { EVENT_TYPE, SYSTEM_KEY_PREFIX } from './lease-constants.js';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function lazyExpireActiveLeases(
  requirementId: string,
  tx: TxClient,
  actorId: string,
): Promise<void> {
  const now = new Date();
  const expiredCandidates = await tx.executionLease.findMany({
    where: {
      requirementId,
      status: 'ACTIVE',
      expiresAt: { lte: now },
    },
    select: { id: true, claimKey: true },
  });

  for (const lease of expiredCandidates) {
    const result = await tx.executionLease.updateMany({
      where: {
        id: lease.id,
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
        releaseReason: 'expired',
        releasedAt: now,
      },
    });
    if (result.count === 1) {
      await tx.executionLeaseEvent.create({
        data: {
          leaseId: lease.id,
          eventType: EVENT_TYPE.EXPIRED,
          idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-expired:${lease.id}`,
          actorId,
          metadata: { reason: 'lazy expiration', claimKey: lease.claimKey },
        },
      });
    }
  }
}

export async function lazyExpireActiveLeasesStandalone(
  prisma: PrismaClient,
  requirementId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const txNow = new Date();
    const expiredCandidates = await tx.executionLease.findMany({
      where: {
        requirementId,
        status: 'ACTIVE',
        expiresAt: { lte: txNow },
      },
      select: { id: true, claimKey: true },
    });

    for (const lease of expiredCandidates) {
      const result = await tx.executionLease.updateMany({
        where: {
          id: lease.id,
          status: 'ACTIVE',
          expiresAt: { lte: txNow },
        },
        data: {
          status: 'EXPIRED',
          releaseReason: 'expired',
          releasedAt: txNow,
        },
      });
      if (result.count === 1) {
        await tx.executionLeaseEvent.create({
          data: {
            leaseId: lease.id,
            eventType: EVENT_TYPE.EXPIRED,
            idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-expired:${lease.id}`,
            actorId: null,
            metadata: { reason: 'lazy expiration', claimKey: lease.claimKey },
          },
        });
      }
    }
  });
}
