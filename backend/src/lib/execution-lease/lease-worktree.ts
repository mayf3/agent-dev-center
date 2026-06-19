import { PrismaClient } from '@prisma/client';
import { HttpError } from '../../utils/http-error.js';
import { LEASE_INCLUDE, LeaseWithDetails, EVENT_TYPE, WorktreeBody, SYSTEM_KEY_PREFIX, validateGitBranch, isAbsolutePath } from './lease-constants.js';

export async function updateLeaseWorktree(
  prisma: PrismaClient,
  requirementId: string,
  leaseId: string,
  ownerUserId: string,
  body: WorktreeBody,
): Promise<LeaseWithDetails> {
  if (body.idempotencyKey.startsWith(SYSTEM_KEY_PREFIX)) {
    throw new HttpError(400, 'idempotencyKey cannot start with system:');
  }

  const existingEvent = await prisma.executionLeaseEvent.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    include: { lease: { include: LEASE_INCLUDE } },
  });
  if (existingEvent) {
    return validateAndReplayWorktree(existingEvent, requirementId, leaseId, ownerUserId, body);
  }

  if (!isAbsolutePath(body.worktreePath)) {
    throw new HttpError(400, 'worktreePath must be an absolute path');
  }

  const txResult = await prisma.$transaction<LeaseWithDetails | { __expired: true; reason: string }>(async (tx) => {
    const txNow = new Date();
    const lease = await (tx as any).executionLease.findUnique({
      where: { id: leaseId },
      include: LEASE_INCLUDE,
    });

    if (!lease) throw new HttpError(404, 'execution lease not found');
    if (lease.requirementId !== requirementId) throw new HttpError(409, 'lease does not belong to this requirement');
    if (lease.ownerUserId !== ownerUserId) throw new HttpError(403, 'only the lease owner can update worktree');
    if (lease.sessionId !== body.sessionId) throw new HttpError(403, 'session mismatch');
    if (body.worktreePath === lease.requirement.repoPath) {
      throw new HttpError(400, 'worktreePath must differ from requirement repoPath');
    }
    validateGitBranch(body.gitBranch, requirementId);

    if (lease.status !== 'ACTIVE') throw new HttpError(409, 'lease is not active');

    if (lease.expiresAt <= txNow) {
      const expiredCount = await (tx as any).executionLease.updateMany({
        where: {
          id: leaseId,
          status: 'ACTIVE',
          expiresAt: { lte: txNow },
        },
        data: {
          status: 'EXPIRED',
          releaseReason: 'expired before worktree update',
          releasedAt: txNow,
        },
      });
      if (expiredCount.count === 1) {
        await (tx as any).executionLeaseEvent.create({
          data: {
            leaseId,
            eventType: EVENT_TYPE.EXPIRED,
            idempotencyKey: `${SYSTEM_KEY_PREFIX}lease-expired:${leaseId}`,
            actorId: ownerUserId,
            metadata: { reason: 'expired before worktree update' },
          },
        });
      }
      return { __expired: true, reason: 'lease has expired' };
    }

    const result = await (tx as any).executionLease.updateMany({
      where: {
        id: leaseId,
        requirementId,
        ownerUserId,
        sessionId: body.sessionId,
        status: 'ACTIVE',
        expiresAt: { gt: txNow },
        worktreePath: null,
        gitBranch: null,
      },
      data: {
        worktreePath: body.worktreePath,
        gitBranch: body.gitBranch,
        heartbeatAt: txNow,
      },
    });

    if (result.count === 0) {
      const current = await (tx as any).executionLease.findUnique({
        where: { id: leaseId },
        select: { worktreePath: true, gitBranch: true },
      });
      if (current && (current.worktreePath !== null || current.gitBranch !== null)) {
        throw new HttpError(409, 'lease already has a bound worktree');
      }
      throw new HttpError(409, 'lease cannot be updated due to concurrent modification');
    }

    const updated = await (tx as any).executionLease.findUnique({
      where: { id: leaseId },
      include: LEASE_INCLUDE,
    });

    await (tx as any).executionLeaseEvent.create({
      data: {
        leaseId,
        eventType: EVENT_TYPE.WORKTREE_BOUND,
        idempotencyKey: body.idempotencyKey,
        actorId: ownerUserId,
        metadata: { worktreePath: body.worktreePath, gitBranch: body.gitBranch },
      },
    });

    return updated as LeaseWithDetails;
  });

  if ('__expired' in txResult) {
    throw new HttpError(409, txResult.reason);
  }

  return txResult;
}

function validateAndReplayWorktree(
  existingEvent: any,
  requirementId: string,
  leaseId: string,
  ownerUserId: string,
  body: { sessionId: string; worktreePath: string; gitBranch: string },
): LeaseWithDetails {
  const lease = existingEvent.lease;
  const meta = existingEvent.metadata ?? {};
  if (existingEvent.eventType !== EVENT_TYPE.WORKTREE_BOUND) {
    throw new HttpError(409, 'idempotencyKey already used for a different operation');
  }
  if (lease.requirementId !== requirementId) throw new HttpError(409, 'idempotencyKey used for different requirement');
  if (lease.id !== leaseId) throw new HttpError(409, 'idempotencyKey used for different lease');
  if (lease.ownerUserId !== ownerUserId) throw new HttpError(409, 'idempotencyKey used for different actor');
  if (lease.sessionId !== body.sessionId) throw new HttpError(409, 'idempotencyKey used for different session');
  if (meta.worktreePath !== body.worktreePath) throw new HttpError(409, 'idempotencyKey used with different worktreePath');
  if (meta.gitBranch !== body.gitBranch) throw new HttpError(409, 'idempotencyKey used with different gitBranch');
  return lease as LeaseWithDetails;
}
