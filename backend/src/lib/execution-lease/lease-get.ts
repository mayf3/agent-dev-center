import { PrismaClient } from '@prisma/client';
import { LEASE_INCLUDE, LeaseWithDetails } from './lease-constants.js';
import { lazyExpireActiveLeasesStandalone } from './lease-lazy-expire.js';

export interface LeaseQueryResult {
  active: {
    leaseId: string;
    status: string;
    workflowStep: string;
    expectedStateVersion: number;
    ownerUserId: string;
    acquiredAt: Date;
    expiresAt: Date;
  } | null;
  history: Array<{
    id: string;
    status: string;
    acquiredAt: Date;
    releasedAt: Date | null;
    releaseReason: string | null;
    ownerUserId: string;
  }>;
}

export async function getExecutionLease(prisma: PrismaClient, requirementId: string): Promise<LeaseQueryResult> {
  await lazyExpireActiveLeasesStandalone(prisma, requirementId);

  const active = await prisma.executionLease.findFirst({
    where: { requirementId, status: 'ACTIVE' },
    include: LEASE_INCLUDE,
    orderBy: { acquiredAt: 'desc' },
  });

  const history = await prisma.executionLease.findMany({
    where: { requirementId, status: { not: 'ACTIVE' } },
    select: {
      id: true,
      status: true,
      acquiredAt: true,
      releasedAt: true,
      releaseReason: true,
      ownerUserId: true,
    },
    orderBy: { acquiredAt: 'desc' },
    take: 20,
  });

  return {
    active: active ? {
      leaseId: active.id,
      status: active.status,
      workflowStep: active.workflowStep,
      expectedStateVersion: active.expectedStateVersion,
      ownerUserId: active.ownerUserId,
      acquiredAt: active.acquiredAt,
      expiresAt: active.expiresAt,
    } : null,
    history,
  };
}
